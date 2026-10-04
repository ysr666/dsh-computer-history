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
//! No serde: the shapes are tiny and fixed, and a collector that dies on a line it cannot parse is
//! worse than one that ignores it. `None` means "not a command this collector knows".

/// The include-only policy the host sends with `configure`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Policy {
    pub allowed_bundle_ids: Vec<String>,
    pub blocked_bundle_ids: Vec<String>,
    pub protected_bundle_ids: Vec<String>,
    pub protected_path_patterns: Vec<String>,
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
    let mut parser = Parser::new(line);
    let value = parser.parse_value()?;
    if !parser.exhausted() {
        return None;
    }
    let Json::Object(fields) = &value else {
        return None;
    };
    match get_field(fields, "type")?.as_str()? {
        "configure" => {
            let revision = get_field(fields, "revision")?.as_u64()?;
            let policy = get_field(fields, "policy")?.as_object()?;
            Some(Command::Configure {
                revision,
                policy: Policy {
                    allowed_bundle_ids: string_array(get_field(policy, "allowedBundleIds")),
                    blocked_bundle_ids: string_array(get_field(policy, "blockedBundleIds")),
                    protected_bundle_ids: string_array(get_field(policy, "protectedBundleIds")),
                    protected_path_patterns: string_array(get_field(policy, "protectedPathPatterns")),
                },
            })
        }
        "pause" => Some(Command::Pause),
        "resume" => Some(Command::Resume),
        "shutdown" => Some(Command::Shutdown),
        _ => None,
    }
}

fn string_array(value: Option<&Json>) -> Vec<String> {
    value
        .and_then(Json::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn get_field<'a>(fields: &'a [(String, Json)], key: &str) -> Option<&'a Json> {
    fields
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value)
}

#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Number(i64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(fields) => Some(fields),
            _ => None,
        }
    }

    fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }

    fn as_u64(&self) -> Option<u64> {
        match self {
            Json::Number(number) if *number >= 0 => Some(*number as u64),
            _ => None,
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn exhausted(&mut self) -> bool {
        self.skip_whitespace();
        self.pos >= self.bytes.len()
    }

    fn parse_value(&mut self) -> Option<Json> {
        self.skip_whitespace();
        match self.peek()? {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => self.parse_string().map(Json::String),
            b't' => self.literal("true").map(|()| Json::Bool(true)),
            b'f' => self.literal("false").map(|()| Json::Bool(false)),
            b'n' => self.literal("null").map(|()| Json::Null),
            b'-' | b'0'..=b'9' => self.parse_number(),
            _ => None,
        }
    }

    fn parse_object(&mut self) -> Option<Json> {
        self.pos += 1;
        let mut fields = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Some(Json::Object(fields));
        }
        loop {
            self.skip_whitespace();
            let key = self.parse_string()?;
            self.skip_whitespace();
            if self.peek()? != b':' {
                return None;
            }
            self.pos += 1;
            let value = self.parse_value()?;
            fields.push((key, value));
            self.skip_whitespace();
            match self.peek()? {
                b',' => self.pos += 1,
                b'}' => {
                    self.pos += 1;
                    return Some(Json::Object(fields));
                }
                _ => return None,
            }
        }
    }

    fn parse_array(&mut self) -> Option<Json> {
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Some(Json::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_whitespace();
            match self.peek()? {
                b',' => self.pos += 1,
                b']' => {
                    self.pos += 1;
                    return Some(Json::Array(items));
                }
                _ => return None,
            }
        }
    }

    fn parse_number(&mut self) -> Option<Json> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos]).ok()?;
        text.parse::<i64>().ok().map(Json::Number)
    }

    fn parse_string(&mut self) -> Option<String> {
        if self.peek() != Some(b'"') {
            return None;
        }
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.peek()? {
                b'"' => {
                    self.pos += 1;
                    return Some(out);
                }
                b'\\' => {
                    self.pos += 1;
                    match self.peek()? {
                        b'"' => {
                            out.push('"');
                            self.pos += 1;
                        }
                        b'\\' => {
                            out.push('\\');
                            self.pos += 1;
                        }
                        b'/' => {
                            out.push('/');
                            self.pos += 1;
                        }
                        b'b' => {
                            out.push('\u{8}');
                            self.pos += 1;
                        }
                        b'f' => {
                            out.push('\u{c}');
                            self.pos += 1;
                        }
                        b'n' => {
                            out.push('\n');
                            self.pos += 1;
                        }
                        b'r' => {
                            out.push('\r');
                            self.pos += 1;
                        }
                        b't' => {
                            out.push('\t');
                            self.pos += 1;
                        }
                        b'u' => {
                            self.pos += 1;
                            let first = self.parse_hex4()?;
                            let ch = if (0xD800..0xDC00).contains(&first) {
                                if self.peek()? != b'\\' || self.bytes.get(self.pos + 1) != Some(&b'u') {
                                    return None;
                                }
                                self.pos += 2;
                                let second = self.parse_hex4()?;
                                if !(0xDC00..0xE000).contains(&second) {
                                    return None;
                                }
                                char::from_u32(
                                    0x10000
                                        + ((first as u32 - 0xD800) << 10)
                                        + (second as u32 - 0xDC00),
                                )?
                            } else {
                                char::from_u32(first as u32)?
                            };
                            out.push(ch);
                        }
                        _ => return None,
                    }
                }
                byte => {
                    // Copy the whole UTF-8 sequence: copying byte by byte would split multibyte
                    // characters (the host sends Chinese path patterns on a Chinese Windows).
                    let start = self.pos;
                    let length = utf8_length(byte)?;
                    let end = start + length;
                    out.push_str(std::str::from_utf8(self.bytes.get(start..end)?).ok()?);
                    self.pos = end;
                }
            }
        }
    }

    fn parse_hex4(&mut self) -> Option<u16> {
        let end = self.pos + 4;
        let text = std::str::from_utf8(self.bytes.get(self.pos..end)?).ok()?;
        self.pos = end;
        u16::from_str_radix(text, 16).ok()
    }

    fn literal(&mut self, text: &str) -> Option<()> {
        if self.bytes[self.pos..].starts_with(text.as_bytes()) {
            self.pos += text.len();
            Some(())
        } else {
            None
        }
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }
}

fn utf8_length(byte: u8) -> Option<usize> {
    match byte {
        0x00..=0x7f => Some(1),
        0xc2..=0xdf => Some(2),
        0xe0..=0xef => Some(3),
        0xf0..=0xf4 => Some(4),
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
}
