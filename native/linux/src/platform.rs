//! The only module that knows about Linux.
//!
//! On Linux it talks to AT-SPI2 over D-Bus. Everywhere else - and on a Linux desktop where accessibility
//! is switched off, which is the common case - it reports **why** it cannot observe instead of staying
//! silent. A collector that says nothing is indistinguishable from a machine nobody used, and that
//! ambiguity is what this module exists to remove.
//!
//! The check shells out to `gdbus` rather than linking a D-Bus client: the collector's whole dependency
//! list is the shared protocol crate, `gdbus` ships with GLib on every desktop this runs on, and a
//! subprocess is bounded and easy to fail closed. When it is missing the collector says so - it does not
//! guess.

#[cfg(target_os = "linux")]
pub const BUILT_FOR_LINUX: bool = true;
#[cfg(not(target_os = "linux"))]
pub const BUILT_FOR_LINUX: bool = false;

/// Whether AT-SPI is reachable *and* enabled, as far as this process can tell.
///
/// Measured on a real Linux (Ubuntu 24.04 in a VM, kernel 6.8) through a session bus: the bus answers
/// `org.a11y.Bus.GetAddress`, and `org.a11y.Status` answers `IsEnabled`; with no accessibility stack
/// installed at all the collector reports that, which is the whole point of the reason strings.
pub fn accessibility_state() -> AccessibilityState {
    if !BUILT_FOR_LINUX {
        return AccessibilityState::Unavailable(
            "this collector was built for linux; AT-SPI is not reachable from this platform",
        );
    }

    let address = match run_gdbus(&[
        "call",
        "--session",
        "--dest",
        "org.a11y.Bus",
        "--object-path",
        "/org/a11y/bus",
        "--method",
        "org.a11y.Bus.GetAddress",
    ]) {
        Ok(output) => match parse_bus_address(&output) {
            Some(address) => address,
            None => {
                return AccessibilityState::Unknown(
                    "the AT-SPI bus answered without an address",
                )
            }
        },
        Err(Failure::NoGdbus) => {
            return AccessibilityState::Unavailable(NO_GDBUS)
        }
        Err(_) => {
            return AccessibilityState::Unknown(
                "the AT-SPI bus is not running on this session: org.a11y.Bus did not answer",
            )
        }
    };

    let enabled = match status_property(&address, "IsEnabled") {
        Ok(value) => value,
        Err(Failure::NoGdbus) => {
            return AccessibilityState::Unavailable(NO_GDBUS)
        }
        Err(_) => {
            return AccessibilityState::Unknown(
                "the AT-SPI bus answered but org.a11y.Status did not",
            )
        }
    };
    // A screen reader turns the tree on by itself, so either flag means there is something to observe.
    let screen_reader =
        status_property(&address, "ScreenReaderEnabled").unwrap_or(false);

    if enabled || screen_reader {
        AccessibilityState::Enabled
    } else {
        AccessibilityState::Disabled(
            "accessibility is switched off for this session: turn on \"toolkit accessibility\" \
             (gsettings set org.gnome.desktop.interface toolkit-accessibility true) or run a screen reader",
        )
    }
}

const NO_GDBUS: &str =
    "gdbus is not installed (it ships with GLib), and it is how this collector asks AT-SPI whether it may observe";

/// Why a single `gdbus` call did not produce a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    /// The `gdbus` binary is not on PATH.
    NoGdbus,
    /// It ran, but not successfully: no session bus, no such name, or it took too long.
    NoAnswer,
    /// It answered with something this parser does not recognise.
    Unintelligible,
}

/// The macOS collector bounds every Accessibility round trip at 0.5 s; a subprocess is bounded here.
const GDBUS_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1_500);

fn run_gdbus(args: &[&str]) -> Result<String, Failure> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Instant;

    let mut child = match Command::new("gdbus")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Failure::NoGdbus)
        }
        Err(_) => return Err(Failure::NoAnswer),
    };

    let deadline = Instant::now() + GDBUS_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Err(Failure::NoAnswer),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Failure::NoAnswer);
            }
            Err(_) => return Err(Failure::NoAnswer),
        }
    }

    let mut output = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut output);
    }
    Ok(output)
}

fn status_property(address: &str, name: &str) -> Result<bool, Failure> {
    let output = run_gdbus(&[
        "call",
        "--address",
        address,
        "--dest",
        "org.a11y.Status",
        "--object-path",
        "/org/a11y/Status",
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.a11y.Status",
        name,
    ])?;
    parse_boolean(&output).ok_or(Failure::Unintelligible)
}

/// `('unix:path=/run/user/1000/at-spi/bus_0',)` -> the address.
fn parse_bus_address(output: &str) -> Option<String> {
    let start = output.find('\'')? + 1;
    let rest = &output[start..];
    let end = rest.find('\'')?;
    let address = &rest[..end];
    (!address.is_empty()).then(|| address.to_string())
}

/// `(<true>,)` -> `true`. gdbus prints GVariant text, which is where these two spellings come from.
fn parse_boolean(output: &str) -> Option<bool> {
    if output.contains("<true>") {
        Some(true)
    } else if output.contains("<false>") {
        Some(false)
    } else {
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessibilityState {
    /// AT-SPI answered and is enabled.
    Enabled,
    /// AT-SPI answered and is disabled: the user can turn it on, so the reason says how.
    Disabled(&'static str),
    /// The check could not be made at all.
    Unknown(&'static str),
    /// This binary cannot make the check.
    Unavailable(&'static str),
}

impl AccessibilityState {
    pub fn state_name(&self) -> &'static str {
        match self {
            AccessibilityState::Enabled => "running",
            _ => "permission-required",
        }
    }

    pub fn reason(&self) -> Option<&'static str> {
        match self {
            AccessibilityState::Enabled => None,
            AccessibilityState::Disabled(reason)
            | AccessibilityState::Unknown(reason)
            | AccessibilityState::Unavailable(reason) => Some(reason),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bus_address_is_read_out_of_the_gvariant_text() {
        assert_eq!(
            parse_bus_address("('unix:path=/run/user/1000/at-spi/bus_0',)"),
            Some("unix:path=/run/user/1000/at-spi/bus_0".to_string()),
        );
        assert_eq!(parse_bus_address("()"), None);
        assert_eq!(parse_bus_address("('',)"), None);
    }

    #[test]
    fn the_two_gvariant_spellings_of_a_boolean_are_both_understood() {
        assert_eq!(parse_boolean("(<true>,)"), Some(true));
        assert_eq!(parse_boolean("(<false>,)"), Some(false));
        assert_eq!(parse_boolean("(error)"), None);
    }

    #[test]
    fn a_platform_without_at_spi_says_so_rather_than_staying_silent() {
        // The rule the reason strings exist for: a collector that cannot observe must say why.
        let state = accessibility_state();
        if state != AccessibilityState::Enabled {
            assert!(state.reason().is_some(), "a non-running state without a reason");
            assert_eq!(state.state_name(), "permission-required");
        }
    }

    #[test]
    fn a_disabled_session_tells_the_user_how_to_turn_it_on() {
        let state = AccessibilityState::Disabled("turn on toolkit accessibility");
        assert_eq!(state.state_name(), "permission-required");
        assert_eq!(state.reason(), Some("turn on toolkit accessibility"));
    }
}
