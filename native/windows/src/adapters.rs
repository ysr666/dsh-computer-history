//! Which application ids this collector understands, and what the adapter table guarantees about them.
//!
//! The single source of truth is `src/shared/constants.ts`. This table is compared with it in
//! `tests/repository.spec.ts`, because the collector has to resolve an id before the host sees anything
//! and cannot import TypeScript. Adding an adapter is a data change on both sides plus an evidence row
//! in `docs/adapters.md`.

/// What the adapter's application guarantees about focused elements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPolicy {
    /// The focused element must be queryable, or the observation is withheld (fail closed).
    Require,
    /// The application exposes no queryable element and renders its own fields; window metadata may be
    /// recorded without element fields (ADR 0006).
    WindowOnly,
}

/// One surface adapter, as far as the Windows collector needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Adapter {
    pub id: &'static str,
    pub ids: &'static [&'static str],
    /// Terminal windows carry the working directory and the running command, so their titles are never
    /// recorded.
    pub suppresses_window_title: bool,
    pub focus_policy: FocusPolicy,
}

/// The win32 half of the shared adapter table.
pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        id: "vscode",
        // Expected, not measured: VS Code is not installed on the machine that produced the Windows
        // row, and this is the executable name of the user-installer build.
        ids: &["Code.exe"],
        suppresses_window_title: false,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "terminal",
        // Measured 2026-10-04: a Windows Terminal window reports its executable name, not the packaged
        // AppUserModelID the Start menu publishes.
        ids: &["WindowsTerminal.exe"],
        suppresses_window_title: true,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "finder",
        // Measured 2026-10-04: Explorer has no AppUserModelID, so its executable name is the identity.
        ids: &["explorer.exe"],
        suppresses_window_title: false,
        focus_policy: FocusPolicy::Require,
    },
];

/// Resolve an application id. Windows ids are compared case-insensitively: executable names vary in
/// case between the process list and the adapter table.
pub fn adapter_for(application_id: &str) -> Option<&'static Adapter> {
    ADAPTERS.iter().find(|adapter| {
        adapter
            .ids
            .iter()
            .any(|id| id.eq_ignore_ascii_case(application_id))
    })
}
