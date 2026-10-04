//! The collector message layer, shared by every non-macOS collector.
//!
//! It lives in its own crate so that "the three platforms produce the same fields" is a structural fact
//! rather than a promise: Windows and Linux depend on this, and the conformance fixtures measure what it
//! emits. A second copy of these shapes would be a second source of truth, which is the failure this
//! repository keeps recording.
//! The message layer: exactly the shapes in `docs/collector-protocol.md`, nothing more.
//!
//! There is deliberately **no field** for text, a selection, a clipboard, a keystroke or an image, and a
//! test asserts that the serialised forms cannot carry one: adding a field is a protocol change, not a
//! local decision.

/// Applications whose contents must never be recorded, by executable or desktop id.
///
/// This is the shape Windows and Linux see (an executable name or a `.desktop` id); macOS keeps its
/// own bundle-id list in `native/macos/Sources/ComputerHistoryCollector/Privacy.swift`, because a
/// macOS collector never sees an executable name. A platform that forgets one is a boundary hole, so
/// the list stays plain data with its own tests rather than something derived.
pub const PROTECTED_IDS: &[&str] = &[
    "1Password.exe",
    "Bitwarden.exe",
    "KeePassXC.exe",
    "Dashlane.exe",
    "LastPass.exe",
    "1password.desktop",
];

pub fn is_protected(application_id: &str) -> bool {
    PROTECTED_IDS.iter().any(|id| id.eq_ignore_ascii_case(application_id))
}

/// A collector observation, reduced to the facts the protocol allows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub collector_session: String,
    pub seq: u64,
    pub observed_at_ms: i64,
    pub pid: i32,
    pub application_id: String,
    pub application_name: Option<String>,
    pub window_title: Option<String>,
    pub document: Option<String>,
    pub element_role: Option<String>,
    pub adapter: String,
    pub secure: bool,
    pub protected: bool,
    /// Why a secure or protected observation is withheld, in the protocol's own reason strings.
    /// The host counts refusals by reason, so `protected-app` and `secure-field` have to stay
    /// distinguishable on the wire instead of collapsing into one bucket.
    pub privacy_reason: Option<String>,
    pub idle_seconds: Option<u64>,
    pub selection_text: Option<String>,
}

fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn field(name: &str, value: &str) -> String {
    format!("\"{}\":\"{}\"", name, escape(value))
}

fn optional(name: &str, value: &Option<String>) -> String {
    match value {
        Some(text) => field(name, text),
        None => format!("\"{}\":null", name),
    }
}

impl Observation {
    /// The line this observation becomes, field for field as the protocol documents it.
    pub fn to_line(&self) -> String {
        let mut parts = vec![
            "\"v\":1".to_string(),
            field("type", "observation"),
            field("collectorSession", &self.collector_session),
            format!("\"seq\":{}", self.seq),
            format!("\"observedAtMs\":{}", self.observed_at_ms),
            format!(
                "\"app\":{{\"pid\":{},{},{}}}",
                self.pid,
                field("bundleId", &self.application_id),
                optional("name", &self.application_name),
            ),
            format!(
                "\"window\":{{{},{},{}}}",
                optional("title", &self.window_title),
                optional("document", &self.document),
                "\"url\":null",
            ),
            format!("\"element\":{{{},\"subrole\":null,\"identifier\":null}}", optional("role", &self.element_role)),
            {
                let reason = match self.privacy_reason.as_deref() {
                    Some(reason) if !reason.is_empty() => {
                        format!(",{}", field("reason", reason))
                    }
                    _ => String::new(),
                };
                format!(
                    "\"privacy\":{{\"secure\":{},\"protected\":{}{}}}",
                    self.secure, self.protected, reason
                )
            },
            format!("\"source\":{{{}}}", field("adapter", &self.adapter)),
        ];
        if let Some(idle) = self.idle_seconds {
            parts.push(format!("\"activity\":{{\"idleSeconds\":{}}}", idle));
        }
        format!("{{{}}}", parts.join(","))
    }
}

/// The capabilities the Rust collectors can actually back. `resource-uri` is deliberately absent: a
/// resource URI needs a document, and on Windows `document` is always null (UI Automation has no
/// `kAXDocument` equivalent). The macOS collector has its own list because it can produce one; claiming
/// it here would be the same "capabilities it cannot back" the live Windows row exists to remove.
pub const CAPABILITIES: &[&str] = &[
    "app-focus",
    "window-metadata",
    "secure-field-detection",
];

/// The architecture value the host's vocabulary uses. macOS emits `arm64`/`x64`; rustc's own
/// `std::env::consts::ARCH` says `aarch64`/`x86_64`, and the host rejects those on the hello line.
pub fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        other => other,
    }
}

/// The first message. The platform is a parameter because it differs per collector - and because a
/// hardcoded one silently claims to be Windows from a Linux binary.
pub fn hello(session: &str, version: &str, platform: &str) -> String {
    let capabilities = CAPABILITIES
        .iter()
        .map(|capability| format!("\"{}\"", capability))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"v\":1,\"type\":\"hello\",\"collectorSession\":\"{}\",\"collectorVersion\":\"{}\",\
         \"platform\":\"{}\",\"arch\":\"{}\",\"capabilities\":[{}]}}",
        escape(session),
        escape(version),
        escape(platform),
        arch(),
        capabilities,
    )
}

pub fn state(state: &str, accessibility_trusted: bool, reason: Option<&str>) -> String {
    match reason {
        Some(text) => format!(
            "{{\"v\":1,\"type\":\"state\",\"state\":\"{}\",\"accessibilityTrusted\":{},\"reason\":\"{}\"}}",
            escape(state), accessibility_trusted, escape(text)
        ),
        None => format!(
            "{{\"v\":1,\"type\":\"state\",\"state\":\"{}\",\"accessibilityTrusted\":{}}}",
            escape(state), accessibility_trusted
        ),
    }
}

pub fn configured(revision: u64) -> String {
    format!("{{\"v\":1,\"type\":\"configured\",\"revision\":{}}}", revision)
}

pub fn diagnostic(level: &str, code: &str, message: &str) -> String {
    format!(
        "{{\"v\":1,\"type\":\"diagnostic\",\"level\":\"{}\",\"code\":\"{}\",\"message\":\"{}\"}}",
        escape(level), escape(code), escape(message)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Observation {
        Observation {
            collector_session: "win-1".into(),
            seq: 7,
            observed_at_ms: 1_791_011_759_552,
            pid: 42,
            application_id: "Microsoft.VisualStudioCode".into(),
            application_name: Some("Visual Studio Code".into()),
            window_title: Some("provider.ts".into()),
            document: Some("file:///C:/work/provider.ts".into()),
            element_role: Some("Document".into()),
            adapter: "vscode".into(),
            secure: false,
            protected: false,
            privacy_reason: None,
            idle_seconds: Some(0),
            selection_text: Some("secret".into()),
        }
    }

    #[test]
    fn an_observation_carries_the_documented_fields() {
        let line = sample().to_line();
        for expected in [
            "\"type\":\"observation\"",
            "\"collectorSession\":\"win-1\"",
            "\"seq\":7",
            "\"bundleId\":\"Microsoft.VisualStudioCode\"",
            "\"document\":\"file:///C:/work/provider.ts\"",
            "\"adapter\":\"vscode\"",
            "\"secure\":false",
        ] {
            assert!(line.contains(expected), "missing {expected} in {line}");
        }
    }

    #[test]
    fn there_is_no_field_for_content() {
        // The boundary as a property of the shape: whatever the platform hands over, the serialised line
        // has no place to put a selection, a document body or an image.
        let line = sample().to_line();
        for forbidden in ["text", "selection", "clipboard", "keystroke", "image", "content", "screenshot"] {
            assert!(
                !line.to_lowercase().contains(forbidden),
                "the observation shape grew a {forbidden} field: {line}"
            );
        }
    }

    #[test]
    fn control_characters_cannot_break_a_line() {
        // One message per line is the transport. A title containing a newline must not synthesise a
        // second message, which is how a collector could otherwise inject one.
        let mut observation = sample();
        observation.window_title = Some("line one\nline two".into());
        let line = observation.to_line();
        assert!(!line.contains('\n'), "a newline reached the wire: {line}");
        assert!(line.contains("line one line two") || line.contains("\\n"));
    }

    #[test]
    fn the_privacy_reason_is_carried_only_when_present() {
        // The host counts refusals by reason, so the reason has to be in the line where it exists -
        // and an unset reason must stay absent rather than becoming an empty string. The whole
        // privacy object is asserted, because a doubled key (`"reason":"reason":"...`) is still a
        // substring match for the reason but is invalid JSON, and the host stops capture on it.
        let mut observation = sample();
        observation.privacy_reason = Some("protected-app".into());
        let line = observation.to_line();
        assert!(
            line.contains(
                "\"privacy\":{\"secure\":false,\"protected\":false,\"reason\":\"protected-app\"}",
            ),
            "{line}"
        );
        assert_eq!(line.matches("\"reason\":").count(), 1, "{line}");
        assert!(!line.contains("\"reason\":\"reason\""), "{line}");
        assert!(!sample().to_line().contains("\"reason\""));
    }

    #[test]
    fn the_arch_value_speaks_the_hosts_vocabulary() {
        // The host accepts arm64/x64/x86 (the words a collector may send), not rustc's target_arch
        // names such as x86_64 or aarch64 - a build whose arch word the host rejects dies on the hello
        // line, which is what happened to the first Windows collector.
        assert!(matches!(arch(), "x64" | "arm64" | "x86"), "{}", arch());
        let hello_line = hello("s", "0.1.0", "win32");
        assert!(hello_line.contains(&format!("\"arch\":\"{}\"", arch())));
        // The capabilities are the ones the Rust collectors can back; a document-bearing collector is
        // the macOS one, and it sends its own list.
        assert!(hello_line.contains("\"capabilities\":[\"app-focus\",\"window-metadata\",\"secure-field-detection\"]"), "{hello_line}");
        assert!(!hello_line.contains("resource-uri"), "{hello_line}");
    }

    #[test]
    fn control_characters_are_escaped_rather_than_replaced() {
        // A control character in a window title used to arrive as a space, which silently changed what
        // was stored; the line is JSON, so it can carry the character as an escape instead.
        let mut observation = sample();
        observation.window_title = Some("a\u{7}b".into());
        let line = observation.to_line();
        assert!(line.contains("a\\u0007b"), "{line}");
        assert!(!line.contains('\u{7}'), "{line}");
    }

    #[test]
    fn the_other_messages_match_their_documented_shapes() {
        assert!(hello("s", "0.1.0", "win32").contains("\"type\":\"hello\""));
        assert!(hello("s", "0.1.0", "win32").contains("\"platform\":\"win32\""));
        // The same function must not claim Windows for a Linux binary.
        assert!(hello("s", "0.1.0", "linux").contains("\"platform\":\"linux\""));
        assert_eq!(configured(3), "{\"v\":1,\"type\":\"configured\",\"revision\":3}");
        assert!(state("running", true, None).contains("\"accessibilityTrusted\":true"));
        assert!(state("permission-required", false, Some("uia unavailable")).contains("uia unavailable"));
        assert!(diagnostic("warn", "uia-degraded", "a").contains("\"code\":\"uia-degraded\""));
    }

    #[test]
    fn protected_applications_are_recognised_case_insensitively() {
        assert!(is_protected("1password.exe"));
        assert!(super::is_protected("Bitwarden.exe"));
        assert!(!super::is_protected("Microsoft.VisualStudioCode"));
    }

    #[test]
    fn the_protected_list_is_plain_data() {
        assert!(!PROTECTED_IDS.is_empty());
        let mut sorted = PROTECTED_IDS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), PROTECTED_IDS.len(), "duplicate protected id");
        assert!(PROTECTED_IDS.iter().all(|id| !id.is_empty()));
        assert!(
            PROTECTED_IDS.iter().any(|id| id.to_lowercase().ends_with(".exe")),
            "the Windows executable shape is missing from the protected list"
        );
    }
}
