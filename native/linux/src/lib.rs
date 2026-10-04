//! The Linux collector: the shared engine and message layer plus one platform module.
//!
//! The engine, the message layer and the platform seam come from `dsh_collector_protocol` - the same code
//! the Windows collector runs - so "the same fields on every platform" is what the dependency graph says
//! rather than what a reviewer has to check.
//!
//! What is Linux here: `platform` (may this collector observe, and why not) and `atspi` (the observation
//! source: the foreground window from X11, the tree from AT-SPI, the application id from the `.desktop`
//! file that names the process). Every route in that source was measured before it was written - see the
//! module comment for the two obvious routes that are wrong on this platform.

pub mod adapters;
pub mod atspi;
pub mod platform;

/// The shared engine, under the name the Windows collector uses for it.
pub use dsh_collector_protocol::engine;

pub use dsh_collector_protocol as protocol;
pub use dsh_collector_protocol::{is_protected, PROTECTED_IDS};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_linux_binary_does_not_claim_to_be_windows() {
        let line = protocol::hello("linux-1", "0.1.0", "linux");
        assert!(line.contains("\"platform\":\"linux\""), "{line}");
        assert!(!line.contains("win32"), "{line}");
    }

    #[test]
    fn unavailability_is_reported_with_a_reason_rather_than_silence() {
        // The rule this platform exists to honour: a collector that cannot observe must say so. Silence is
        // indistinguishable from a machine nobody used.
        let state = platform::accessibility_state();
        if state != platform::AccessibilityState::Enabled {
            assert!(state.reason().is_some(), "a non-running state without a reason");
        }
        let line = protocol::state(state.state_name(), false, state.reason());
        assert!(
            line.contains("\"state\":\"permission-required\"") && line.contains("\"reason\""),
            "{line}",
        );
    }

    #[test]
    fn the_boundary_is_the_same_list_as_the_other_platforms() {
        // Shared, not copied: a platform cannot quietly drop a protected application.
        assert!(is_protected("1Password.exe"));
        assert!(is_protected("1password.desktop"));
        assert!(!is_protected("org.gnome.Terminal.desktop"));
    }
}
