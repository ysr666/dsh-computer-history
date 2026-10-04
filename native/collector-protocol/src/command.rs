//! Host-to-collector commands, parsed from the newline-delimited JSON written to stdin.
//!
//! This lives beside the message layer because both collectors read the same stdin: the Windows and the
//! Linux collector must agree about a line, and the only way to guarantee that is for one function to
//! decide. The Linux collector used to scan for the substring `"configure"`, which acked `revision 0` for
//! a `pause` whose note happened to contain that word (found by an adversarial re-run of the serde
//! migration; verified by driving the real binary).
//!
//! The host's shapes (`src/host/collector/manager.ts`):
//!
//! ```jsonc
//! {"v":1,"type":"configure","revision":N,"policy":{"mode":"include-only",
//!  "allowedBundleIds":[...],"blockedBundleIds":[...],"protectedBundleIds":[...],
//!  "protectedPathPatterns":[...]}}
//! {"v":1,"type":"pause"}   {"v":1,"type":"resume"}   {"v":1,"type":"shutdown"}
//! ```
//!
//! `None` means "not a command this collector knows", and every way of being unintelligible ends there:
//! unknown fields and unknown `type` values are ignored, a value of the wrong shape fails the line rather
//! than half-applying it, and nothing here is fatal. That behaviour is the contract, frozen in
//! `.debug/serde-migration/01-inbound-tolerance.md` and its tests.
//!
//! `v` is deliberately absent from the envelope: the host sends it by convention and this parser has never
//! looked at it, which `the_version_field_is_never_required_or_checked` pins.
//!
//! The envelope keeps `revision` and `policy` **untyped on purpose**. Typing them made a `pause` line
//! unparseable when it carried a junk `revision`, which the hand-written parser never did - and, worse,
//! `Option<Policy>` accepts a JSON *array* positionally, so `"policy":[]` silently replaced the live policy
//! with an empty one instead of being refused. Both were found by an adversarial re-run of the rewrite and
//! are pinned by `a_non_object_policy_is_refused_rather_than_reinterpreted` and
//! `a_simple_command_ignores_junk_it_does_not_need`.

use serde::Deserialize;
use serde_json::Value;

/// The include-only policy the host sends with `configure`.
///
/// An array the host did not send is empty, and a member that is not a string is dropped, rather than
/// failing the whole line - the behaviour the hand-written parser had, pinned by
/// `policy_arrays_tolerate_missing_fields_and_non_string_members`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    #[serde(deserialize_with = "string_array")]
    pub allowed_bundle_ids: Vec<String>,
    #[serde(deserialize_with = "string_array")]
    pub blocked_bundle_ids: Vec<String>,
    #[serde(deserialize_with = "string_array")]
    pub protected_bundle_ids: Vec<String>,
    #[serde(deserialize_with = "string_array")]
    pub protected_path_patterns: Vec<String>,
}

/// Keep the strings out of an array, drop everything else, and treat a value that is not an array as an
/// empty one. Failing here would discard a whole command because of one unusable member.
fn string_array<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        Some(Value::Array(items)) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    })
}

/// The command envelope. Unknown fields are ignored by construction: a field that is not named here has
/// nowhere to land. Duplicate fields are refused by serde, which for a duplicate `type` ends in the same
/// place the hand-written parser ended (no command acted on) for the shapes the host can produce.
#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    message_type: Option<String>,
    revision: Option<Value>,
    policy: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Configure { revision: u64, policy: Policy },
    Pause,
    Resume,
    Shutdown,
}

/// A configure is applied or refused as a whole. A policy that is not a JSON object is refused rather
/// than reinterpreted: serde would happily read `[]` as a struct with every field missing, which turns a
/// malformed line into "capture nothing" while looking like a successful configuration.
fn policy_of(value: Option<Value>) -> Option<Policy> {
    let value = value?;
    if !value.is_object() {
        return None;
    }
    serde_json::from_value(value).ok()
}

/// Parse one line. `None` means the line is not a command this collector knows.
pub fn parse_command(line: &str) -> Option<Command> {
    let envelope: Envelope = serde_json::from_str(line).ok()?;
    match envelope.message_type.as_deref()? {
        "configure" => Some(Command::Configure {
            revision: envelope.revision?.as_u64()?,
            policy: policy_of(envelope.policy)?,
        }),
        // The simple commands never look at `revision` or `policy`: a line that carries junk next to a
        // `pause` still pauses, exactly as it did before the rewrite.
        "pause" => Some(Command::Pause),
        "resume" => Some(Command::Resume),
        "shutdown" => Some(Command::Shutdown),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configure_line() -> String {
        r#"{"v":1,"type":"configure","revision":7,"policy":{"mode":"include-only","allowedBundleIds":["Microsoft.VisualStudioCode","explorer.exe"],"blockedBundleIds":[],"protectedBundleIds":["1Password.exe"],"protectedPathPatterns":["C:\\Users\\47209\\secrets\\*","C:/x"]}}"#
            .to_string()
    }

    #[test]
    fn a_configure_line_is_parsed_with_its_policy() {
        let Some(Command::Configure { revision, policy }) = parse_command(&configure_line()) else {
            panic!("configure did not parse");
        };
        assert_eq!(revision, 7);
        assert_eq!(
            policy.allowed_bundle_ids,
            vec!["Microsoft.VisualStudioCode", "explorer.exe"]
        );
        assert!(policy.blocked_bundle_ids.is_empty());
        assert_eq!(policy.protected_bundle_ids, vec!["1Password.exe"]);
        assert_eq!(
            policy.protected_path_patterns,
            vec!["C:\\Users\\47209\\secrets\\*", "C:/x"]
        );
    }

    #[test]
    fn the_simple_commands_are_parsed() {
        assert_eq!(parse_command(r#"{"v":1,"type":"pause"}"#), Some(Command::Pause));
        assert_eq!(parse_command(r#"{"v":1,"type":"resume"}"#), Some(Command::Resume));
        assert_eq!(
            parse_command(r#"{"v":1,"type":"shutdown"}"#),
            Some(Command::Shutdown)
        );
    }

    #[test]
    fn unknown_or_incomplete_lines_are_ignored_rather_than_fatal() {
        for line in [
            "",
            "not json",
            r#"{"v":1,"type":"nonsense"}"#,
            r#"{"v":1,"type":"configure"}"#,
            r#"{"v":1,"type":"configure","revision":1}"#,
            r#"{"v":1,"type":"configure","revision":"1","policy":{}}"#,
            r#"{"v":1,"type":"pause"} tail"#,
            r#"{"v":1,"type":"pau"#,
        ] {
            assert_eq!(parse_command(line), None, "line should be ignored: {line}");
        }
    }

    #[test]
    fn escapes_unknown_fields_and_multibyte_text_do_not_break_parsing() {
        let line = r#"{"v":1,"type":"configure","revision":3,"extra":{"nested":true},"policy":{"allowedBundleIds":["a\"b","c\\d","中"],"protectedPathPatterns":["x\u00e9"]}}"#;
        let Some(Command::Configure { policy, .. }) = parse_command(line) else {
            panic!("configure with escapes did not parse");
        };
        assert_eq!(policy.allowed_bundle_ids, vec!["a\"b", "c\\d", "中"]);
        assert_eq!(policy.protected_path_patterns, vec!["xé"]);
    }

    #[test]
    fn the_version_field_is_never_required_or_checked() {
        // The host always sends `v:1`, and this parser has never looked at it. Frozen before the encoder
        // rewrite so that a typed envelope cannot quietly start requiring a field the host only ever
        // sends by convention.
        assert_eq!(parse_command(r#"{"type":"pause"}"#), Some(Command::Pause));
        assert_eq!(parse_command(r#"{"v":99,"type":"resume"}"#), Some(Command::Resume));
    }

    #[test]
    fn an_unusable_revision_ignores_the_whole_line() {
        // A revision has to be a non-negative integer. Anything else is a line this collector does not
        // understand, and ignoring is the documented behaviour - never fatal.
        for line in [
            r#"{"v":1,"type":"configure","revision":-1,"policy":{}}"#,
            r#"{"v":1,"type":"configure","revision":1.5,"policy":{}}"#,
        ] {
            assert_eq!(parse_command(line), None, "line should be ignored: {line}");
        }
    }

    #[test]
    fn policy_arrays_tolerate_missing_fields_and_non_string_members() {
        let Some(Command::Configure { policy, .. }) = parse_command(
            r#"{"v":1,"type":"configure","revision":2,"policy":{"allowedBundleIds":["a",7,null,{"k":1},"b"]}}"#,
        ) else {
            panic!("configure with mixed array members did not parse");
        };
        assert_eq!(policy.allowed_bundle_ids, vec!["a", "b"]);
        // Arrays the host did not send are empty, not an error.
        assert!(policy.blocked_bundle_ids.is_empty());
        assert!(policy.protected_bundle_ids.is_empty());
        assert!(policy.protected_path_patterns.is_empty());
    }

    #[test]
    fn a_word_inside_an_unread_field_is_not_a_command() {
        // The Linux collector used to scan for the substring `"configure"`, so this line acked
        // `configured revision 0` - a false positive that also silently truncated long revisions. Both
        // were found by driving the real binary; the shared parser reads `type` and nothing else.
        assert_eq!(
            parse_command(r#"{"type":"pause","note":"a \"configure\" b"}"#),
            Some(Command::Pause)
        );
        assert_eq!(
            parse_command(
                r#"{"type":"configure","revision":123456789012345678901234567890,"policy":{}}"#
            ),
            None,
            "a revision JSON cannot represent as an integer is not a revision"
        );
    }

    #[test]
    fn a_non_object_policy_is_refused_rather_than_reinterpreted() {
        // serde reads a JSON array as a struct with every field missing, so `"policy":[]` configured an
        // EMPTY policy: a malformed line silently replacing the live allow-list. Found by an adversarial
        // re-run of this rewrite; refused now, exactly as the hand-written parser refused it.
        for line in [
            r#"{"v":1,"type":"configure","revision":2,"policy":[]}"#,
            r#"{"v":1,"type":"configure","revision":2,"policy":[["a"],["b"],["c"],["d"]]}"#,
            r#"{"v":1,"type":"configure","revision":2,"policy":"x"}"#,
            r#"{"v":1,"type":"configure","revision":2,"policy":5}"#,
        ] {
            assert_eq!(parse_command(line), None, "line should be ignored: {line}");
        }
    }

    #[test]
    fn a_simple_command_ignores_junk_it_does_not_need() {
        // The hand-written parser read `type` and nothing else for pause/resume/shutdown. A fully typed
        // envelope made a junk `revision` kill the line, which the adversarial re-run also caught.
        for line in [
            r#"{"type":"pause","revision":"abc"}"#,
            r#"{"type":"pause","revision":-1}"#,
            r#"{"type":"pause","policy":"x"}"#,
            r#"{"type":"shutdown","policy":[]}"#,
            r#"{"type":"resume","policy":"x","revision":1.5}"#,
        ] {
            assert!(
                parse_command(line).is_some(),
                "line should be understood: {line}"
            );
        }
    }
}
