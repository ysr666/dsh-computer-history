//! The Windows collector, split so that everything except the platform calls can be tested anywhere.
//!
//! `platform` is the only module that touches Windows: it produces the raw facts (foreground window,
//! process, application id, focused element, document path). Everything here turns those facts into the
//! messages `docs/collector-protocol.md` defines, which is the part a Windows machine is *not* needed to
//! verify - and the part the conformance suite measures.

pub mod platform;
pub mod protocol;

/// The surface kinds a collector may report, as the adapter table names them.
pub const SURFACE_EDITOR: &str = "editor";
pub const SURFACE_TERMINAL: &str = "terminal";
pub const SURFACE_WINDOW: &str = "window";
pub const SURFACE_BROWSER: &str = "browser";

/// Applications whose contents must never be recorded, by executable or AppUserModelID.
///
/// The macOS collector keeps the same list; a platform that forgets one is a boundary hole, so this is
/// deliberately a plain list that a test can compare rather than something derived.
pub const PROTECTED_IDS: &[&str] = &[
    "1Password.exe",
    "Bitwarden.exe",
    "KeePassXC.exe",
    "Dashlane.exe",
    "LastPass.exe",
];

pub fn is_protected(application_id: &str) -> bool {
    PROTECTED_IDS.iter().any(|id| id.eq_ignore_ascii_case(application_id))
}
