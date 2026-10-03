//! The only module that knows about Linux.
//!
//! On Linux it will talk to AT-SPI2 over D-Bus. Everywhere else - and on a Linux desktop where
//! accessibility is switched off, which is the common case - it reports **why** it cannot observe instead
//! of staying silent. A collector that says nothing is indistinguishable from a machine nobody used, and
//! that ambiguity is what this module exists to remove.

#[cfg(target_os = "linux")]
pub const BUILT_FOR_LINUX: bool = true;
#[cfg(not(target_os = "linux"))]
pub const BUILT_FOR_LINUX: bool = false;

/// Whether AT-SPI is reachable *and* enabled, as far as this process can tell.
///
/// The real check reads `org.a11y.Status` on the session bus: `IsEnabled` and `ScreenReaderEnabled`. Until
/// a Linux machine runs this, the honest answer is "unknown", which the caller reports as
/// `permission-required` with a reason - never as `running` with silence.
pub fn accessibility_state() -> AccessibilityState {
    if !BUILT_FOR_LINUX {
        return AccessibilityState::Unavailable(
            "this collector was built for linux; AT-SPI is not reachable from this platform",
        );
    }
    AccessibilityState::Unknown(
        "AT-SPI availability has not been read on this build: the session-bus check is not implemented yet",
    )
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
