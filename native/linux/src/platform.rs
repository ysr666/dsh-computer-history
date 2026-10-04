//! The only module that knows about Linux.
//!
//! On Linux it talks to AT-SPI2 over D-Bus. Everywhere else - and on a Linux desktop where accessibility
//! is switched off, which is the common case - it reports **why** it cannot observe instead of staying
//! silent. A collector that says nothing is indistinguishable from a machine nobody used, and that
//! ambiguity is what this module exists to remove.
//!
//! The observation source itself lives in `atspi.rs`; this module is what every build can answer - may this
//! collector observe, and if not, why.
//!
//! The check shells out to `gdbus` rather than linking a D-Bus client: the collector's whole dependency
//! list is the shared protocol crate, `gdbus` ships with GLib on every desktop this runs on, and a
//! subprocess is bounded and easy to fail closed. When a tool is missing the collector says so - it does
//! not guess.
//!
//! **Measured 2026-10-05, on Ubuntu 24.04 in a VM with Xvfb, a session bus, `at-spi2-core` and a GTK
//! application running.** Two facts came out of that run and both changed this file:
//!
//! * `org.a11y.Status` is **not** on the AT-SPI bus. It did not answer there, and in a headless session it
//!   did not answer on the session bus either - a desktop session exports it, a headless one does not.
//! * the setting that actually gates a GTK application exporting its tree is the dconf key
//!   `org.gnome.desktop.interface toolkit-accessibility`, and `gsettings get` reads it reliably (`true` in
//!   that session, with `gdbus` present and the AT-SPI bus alive).
//!
//! So the enable state is read from `org.a11y.Status` when it answers, and from that key when it does not.

#[cfg(target_os = "linux")]
pub const BUILT_FOR_LINUX: bool = true;
#[cfg(not(target_os = "linux"))]
pub const BUILT_FOR_LINUX: bool = false;

/// Whether AT-SPI is reachable *and* enabled, as far as this process can tell.
pub fn accessibility_state() -> AccessibilityState {
    if !BUILT_FOR_LINUX {
        return AccessibilityState::Unavailable(
            "this collector was built for linux; AT-SPI is not reachable from this platform",
        );
    }

    let status = status_flags();
    match status {
        Ok((enabled, screen_reader)) => {
            return if enabled || screen_reader {
                AccessibilityState::Enabled
            } else {
                AccessibilityState::Disabled(TURN_IT_ON)
            }
        }
        Err(Failure::NoGdbus) => return AccessibilityState::Unavailable(NO_GDBUS),
        // The canonical source did not answer; the setting GTK itself reads is the next best thing.
        Err(_) => {}
    }

    match toolkit_accessibility() {
        Ok(true) => AccessibilityState::Enabled,
        Ok(false) => AccessibilityState::Disabled(TURN_IT_ON),
        Err(Failure::NoGdbus) => AccessibilityState::Unavailable(NO_GDBUS),
        Err(_) => AccessibilityState::Unknown(NO_SOURCE),
    }
}

const TURN_IT_ON: &str =
    "accessibility is switched off for this session: turn on \"toolkit accessibility\" \
     (gsettings set org.gnome.desktop.interface toolkit-accessibility true) or run a screen reader";

const NO_GDBUS: &str = "gdbus is not installed (it ships with GLib), and it is how this collector asks \
                        the session whether it may observe";

const NO_SOURCE: &str = "neither org.a11y.Status nor the toolkit-accessibility setting answered, so \
                         whether AT-SPI may be used is unknown";

/// Why a single subprocess did not produce a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    /// The binary is not on PATH.
    NoGdbus,
    /// It ran, but not successfully: no bus, no such name, or it took too long.
    NoAnswer,
    /// It answered with something this parser does not recognise.
    Unintelligible,
}

/// The macOS collector bounds every Accessibility round trip at 0.5 s; a subprocess is bounded here.
const TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1_500);

/// `IsEnabled` and `ScreenReaderEnabled` from `org.a11y.Status` on the session bus.
///
/// Measured: a desktop session exports this name; a headless one does not, which is why the caller falls
/// back to the dconf key instead of reporting a failure.
fn status_flags() -> Result<(bool, bool), Failure> {
    let enabled = status_property("IsEnabled")?;
    // A screen reader turns the tree on by itself, so either flag means there is something to observe.
    let screen_reader = status_property("ScreenReaderEnabled").unwrap_or(false);
    Ok((enabled, screen_reader))
}

fn status_property(name: &str) -> Result<bool, Failure> {
    let output = run(&[
        "gdbus",
        "call",
        "--session",
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

/// The dconf key GNOME's GTK applications read before exporting their tree.
fn toolkit_accessibility() -> Result<bool, Failure> {
    let output = run(&[
        "gsettings",
        "get",
        "org.gnome.desktop.interface",
        "toolkit-accessibility",
    ])?;
    parse_gsettings_boolean(&output).ok_or(Failure::Unintelligible)
}

fn run(argv: &[&str]) -> Result<String, Failure> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Instant;

    let (program, args) = argv.split_first().ok_or(Failure::NoAnswer)?;
    let mut child = match Command::new(program)
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

    let deadline = Instant::now() + TOOL_TIMEOUT;
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

/// `gsettings get` prints `true`, `false`, or the same wrapped in quotes.
fn parse_gsettings_boolean(output: &str) -> Option<bool> {
    let trimmed = output.trim().trim_matches('\'').trim_matches('"');
    match trimmed {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
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
    fn the_two_gvariant_spellings_of_a_boolean_are_both_understood() {
        assert_eq!(parse_boolean("(<true>,)"), Some(true));
        assert_eq!(parse_boolean("(<false>,)"), Some(false));
        assert_eq!(parse_boolean("(error)"), None);
    }

    #[test]
    fn the_dconf_answers_are_understood_in_both_spellings() {
        assert_eq!(parse_gsettings_boolean("true\n"), Some(true));
        assert_eq!(parse_gsettings_boolean("false"), Some(false));
        assert_eq!(parse_gsettings_boolean("'true'"), Some(true));
        assert_eq!(parse_gsettings_boolean("'custom'\n"), None);
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
        let state = AccessibilityState::Disabled(TURN_IT_ON);
        assert_eq!(state.state_name(), "permission-required");
        assert!(state.reason().unwrap().contains("toolkit-accessibility"));
    }
}

/// The source this build uses. The Windows collector has the same shape: the platform module names one
/// implementation and the engine takes it.
pub use crate::atspi::AtspiSource;

/// The source the binary uses.
pub type DefaultSource = AtspiSource;
