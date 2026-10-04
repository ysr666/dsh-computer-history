//! What is Windows about observation: UI Automation, and the reason a build without it reports.
//!
//! The seam itself - `ObservationSource` and the facts it hands over - lives in
//! `dsh_collector_protocol::platform`, because one engine serves three platforms. Everything below this
//! line is the only code in the collector that knows how to read a foreground window.

pub use dsh_collector_protocol::platform::{
    Availability, ElementState, ForegroundIdentity, ObservationSource, PlatformObservation,
};

/// The source used by a build that cannot observe: it reports the reason rather than silence.
pub struct UnsupportedSource;

impl UnsupportedSource {
    pub fn new() -> Self {
        Self
    }
}

impl ObservationSource for UnsupportedSource {
    fn platform(&self) -> &'static str {
        "win32"
    }

    fn provider(&self) -> &'static str {
        // Never reaches the wire: this source emits no observation.
        "unavailable"
    }

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
