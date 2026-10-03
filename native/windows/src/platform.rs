//! The only module that knows about Windows.
//!
//! On Windows it will call UI Automation. Everywhere else it reports that it cannot, which is what makes
//! the rest of the crate testable on a machine that is not Windows - and it is also the honest answer a
//! Windows collector must give when UIA is unavailable, rather than silence.

/// Whether this build can observe anything at all.
#[cfg(windows)]
pub const AVAILABLE: bool = true;
#[cfg(not(windows))]
pub const AVAILABLE: bool = false;

/// Why observation is unavailable, in the shape `diagnostic` wants.
pub fn unavailable_reason() -> Option<&'static str> {
    if AVAILABLE {
        None
    } else {
        Some("this collector was built for win32; UI Automation is not reachable from this platform")
    }
}

/// The raw facts a platform hands over, before policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformObservation {
    pub pid: i32,
    pub application_id: String,
    pub application_name: Option<String>,
    pub window_title: Option<String>,
    pub document: Option<String>,
    pub element_role: Option<String>,
    pub secure: bool,
}
