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

/// One UI Automation element that could anchor an observation to a document, a folder or a URL.
///
/// Measurement only: the collector reads none of this today. The fields exist so that "what can anchor an
/// observation on Windows" is answered by what the platform really exposes rather than by a guess - the
/// same rule the adapter table follows, where an identity string is measured before it is listed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElementCandidate {
    /// How the element was reached: the window itself, the focused element, one of its ancestors, or a
    /// descendant that can carry a location.
    pub relation: &'static str,
    pub control_type: Option<String>,
    pub name: Option<String>,
    pub automation_id: Option<String>,
    pub class_name: Option<String>,
    pub help_text: Option<String>,
    pub item_status: Option<String>,
    pub is_password: Option<bool>,
}

/// The elements around the foreground window that could anchor an observation.
///
/// `limit` bounds both the walk and the result: an unresponsive provider, or a window whose tree has
/// thousands of nodes, must not turn a measurement into a hang.
///
/// Nothing here reads a value, text or selection pattern - that is content, forbidden repo-wide by
/// `scripts/verify-privacy-boundary.mjs`, and a location has to be found in metadata if it is found at all.
#[cfg(windows)]
pub use crate::windows_impl::anchor_candidates;

/// Nothing to measure on a build without UI Automation.
#[cfg(not(windows))]
pub fn anchor_candidates(_limit: usize) -> Vec<ElementCandidate> {
    Vec::new()
}

#[cfg(windows)]
pub use crate::windows_impl::WindowsSource;

/// The source this build actually uses: UI Automation on Windows, the reason everywhere else.
#[cfg(windows)]
pub type DefaultSource = WindowsSource;
#[cfg(not(windows))]
pub type DefaultSource = UnsupportedSource;
