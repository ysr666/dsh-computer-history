//! Host-to-collector commands, parsed from the newline-delimited JSON written to stdin.
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
//! `.debug/serde-migration/01-inbound-tolerance.md` and its tests before this parser was rewritten.
//!
//! `v` is deliberately absent from the envelope: the host sends it by convention and this parser has never
//! looked at it, which `the_version_field_is_never_required_or_checked` pins.

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
/// nowhere to land.
#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    message_type: Option<String>,
    revision: Option<u64>,
    policy: Option<Policy>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Configure { revision: u64, policy: Policy },
    Pause,
    Resume,
    Shutdown,
}

/// Parse one line. `None` means the line is not a command this collector knows.
pub fn parse_command(line: &str) -> Option<Command> {
    let envelope: Envelope = serde_json::from_str(line).ok()?;
    match envelope.message_type.as_deref()? {
        // A configure without a usable revision or policy is not half-applied: the old parser refused it
        // and the frozen tests keep that.
        "configure" => Some(Command::Configure {
            revision: envelope.revision?,
            policy: envelope.policy?,
        }),
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
}
