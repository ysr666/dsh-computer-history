//! The seam between the collector engine and the platform it runs on.
//!
//! `collector.rs` holds every decision that does not need Windows - policy gates, fingerprinting, the
//! heartbeat, the protocol messages. This module hands it the raw facts, and it is the only module that
//! knows how to read a foreground window.

/// What the focused element says about a surface where secrets may be typed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementState {
    /// A readable element that is positively not a secure field.
    NotSecure,
    /// A readable secure field: the surface is withheld.
    Secure,
    /// The application exposes no queryable element (ADR 0006: a window-only adapter may still record
    /// window metadata; every other adapter fails closed).
    Unqueryable,
    /// We could not ask (timeout, invalid element, API failure): fail closed.
    Unreadable,
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
    pub element_state: ElementState,
}

/// Whether observation is possible at all right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Availability {
    Available,
    Unavailable(String),
}

/// The foreground application's identity, read before any policy decision.
///
/// The collector must know *which* application is in front to apply the include-only policy, and it
/// must not read a protected or blocked application's window beyond that identity. macOS has the same
/// ordering: Collector.swift guards adapter + protected + blocked + allowed before any AX read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundIdentity {
    pub pid: i32,
    /// The window handle. `describe` compares it, so metadata can never be attributed to a different
    /// window than the one the policy gate saw - not even another window of the same process.
    pub window: isize,
    /// The identity Windows reports: the window's AppUserModelID when it carries one, otherwise the
    /// executable name.
    pub application_id: String,
    /// The executable name, when it differs from `application_id`. Both are candidates for the policy
    /// and adapter match: a window that reports an AppUserModelID no rule knows would otherwise be
    /// silently unobservable, which is a silent gap rather than a fail-closed decision.
    pub application_executable: Option<String>,
    pub application_name: Option<String>,
}

impl ForegroundIdentity {
    /// The ids this window could be known by, most specific first.
    pub fn candidates(&self) -> Vec<&str> {
        let mut ids = vec![self.application_id.as_str()];
        if let Some(executable) = self.application_executable.as_deref() {
            if !executable.eq_ignore_ascii_case(&self.application_id) {
                ids.push(executable);
            }
        }
        ids
    }
}

/// Everything the engine needs from a platform.
pub trait ObservationSource {
    /// Whether observation is possible right now, and why not when it is not.
    fn availability(&mut self) -> Availability;
    /// The foreground application's identity only: no title, no element, no document.
    fn foreground(&mut self) -> Option<ForegroundIdentity>;
    /// The window metadata for `identity`, called only after the policy gate passed. A `None` here
    /// means the surface could not be read (or the foreground changed) and nothing is recorded.
    fn describe(&mut self, identity: &ForegroundIdentity) -> Option<PlatformObservation>;
    /// Seconds since the last user input, when the platform can tell.
    fn idle_seconds(&mut self) -> Option<u64>;
}

/// The source used by a build that cannot observe: it reports the reason rather than silence.
pub struct UnsupportedSource;

impl UnsupportedSource {
    pub fn new() -> Self {
        Self
    }
}

impl ObservationSource for UnsupportedSource {
    fn availability(&mut self) -> Availability {
        Availability::Unavailable(
            "this collector was built for win32; UI Automation is not reachable from this platform"
                .to_string(),
        )
    }

    fn foreground(&mut self) -> Option<ForegroundIdentity> {
        None
    }

    fn describe(&mut self, _identity: &ForegroundIdentity) -> Option<PlatformObservation> {
        None
    }

    fn idle_seconds(&mut self) -> Option<u64> {
        None
    }
}

#[cfg(windows)]
pub use crate::windows_impl::WindowsSource;

/// The source this build actually uses: UI Automation on Windows, the reason everywhere else.
#[cfg(windows)]
pub type DefaultSource = WindowsSource;
#[cfg(not(windows))]
pub type DefaultSource = UnsupportedSource;
