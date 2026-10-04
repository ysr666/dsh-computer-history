//! The win32 half of the shared adapter table.
//!
//! The shape lives in `dsh_collector_protocol::adapters` because one engine reads it; what is Windows
//! here is which ids Windows reports and what each adapter guarantees.

pub use dsh_collector_protocol::adapters::{Adapter, FocusPolicy};

/// The win32 half of the shared adapter table.
pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        id: "vscode",
        // Measured 2026-10-05: with VS Code 1.140.0 installed on that machine, a stored observation says
        // bundleId "Code.exe" with adapter "vscode".
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
    Adapter {
        id: "notepad",
        // Measured 2026-10-05: Windows 11 Notepad reports its executable name, answers UI Automation
        // (ControlType.50030) and its title carries a file name and nothing else, so it is recorded like an
        // editor's.
        ids: &["Notepad.exe"],
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
