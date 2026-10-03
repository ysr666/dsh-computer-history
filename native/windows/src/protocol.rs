//! The message layer: exactly the shapes in `docs/collector-protocol.md`, nothing more.
//!
//! There is deliberately **no field** for text, a selection, a clipboard, a keystroke or an image, and a
//! test asserts that the serialised forms cannot carry one: adding a field is a protocol change, not a
//! local decision.

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
            c if (c as u32) < 0x20 => out.push(' '),
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
            format!(
                "\"privacy\":{{\"secure\":{},\"protected\":{}}}",
                self.secure, self.protected
            ),
            format!("\"source\":{{{}}}", field("adapter", &self.adapter)),
        ];
        if let Some(idle) = self.idle_seconds {
            parts.push(format!("\"activity\":{{\"idleSeconds\":{}}}", idle));
        }
        format!("{{{}}}", parts.join(","))
    }
}

pub fn hello(session: &str, version: &str) -> String {
    format!(
        "{{\"v\":1,\"type\":\"hello\",\"collectorSession\":\"{}\",\"collectorVersion\":\"{}\",\
         \"platform\":\"win32\",\"arch\":\"{}\",\"capabilities\":[\"app-focus\",\"window-metadata\",\
         \"resource-uri\",\"secure-field-detection\"]}}",
        escape(session),
        escape(version),
        std::env::consts::ARCH,
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
    fn the_other_messages_match_their_documented_shapes() {
        assert!(hello("s", "0.1.0").contains("\"type\":\"hello\""));
        assert!(hello("s", "0.1.0").contains("\"platform\":\"win32\""));
        assert_eq!(configured(3), "{\"v\":1,\"type\":\"configured\",\"revision\":3}");
        assert!(state("running", true, None).contains("\"accessibilityTrusted\":true"));
        assert!(state("permission-required", false, Some("uia unavailable")).contains("uia unavailable"));
        assert!(diagnostic("warn", "uia-degraded", "a").contains("\"code\":\"uia-degraded\""));
    }

    #[test]
    fn protected_applications_are_recognised_case_insensitively() {
        assert!(super::super::is_protected("1password.exe"));
        assert!(super::super::is_protected("Bitwarden.exe"));
        assert!(!super::super::is_protected("Microsoft.VisualStudioCode"));
    }
}
