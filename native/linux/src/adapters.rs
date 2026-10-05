//! The Linux half of the shared adapter table.
//!
//! The shape lives in `dsh_collector_protocol::adapters` because one engine reads it; what is Linux here is
//! which ids this platform reports. A Linux window is named by its `.desktop` file - measured 2026-10-05:
//! the pid of the foreground window resolves to an executable, and the executable to the `.desktop` entry
//! whose `Exec=` names it (`/usr/bin/zenity` -> `org.gnome.Zenity`) - so the ids are `.desktop` file names,
//! which is what `src/shared/constants.ts` declares for this platform.

pub use dsh_collector_protocol::adapters::{Adapter, FocusPolicy};

/// The linux half of the shared adapter table.
pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        id: "vscode",
        // Measured 2026-10-05: the arm64 deb (1.140.0) installs `com.microsoft.VSCode.desktop` and **not**
        // `code.desktop` - which three files in this repository had declared, so on that machine VS Code would
        // have resolved to an id no adapter knew and been silently unobservable. `code.desktop` stays listed
        // because other packages and distros use it, and the measurement covers the deb this repository
        // installed, not every packaging of VS Code.
        ids: &["com.microsoft.VSCode.desktop", "code.desktop"],
        suppresses_window_title: false,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "terminal",
        // Measured 2026-10-05 (Ubuntu 24.04 arm64): gnome-terminal's window reports WM_CLASS
        // "gnome-terminal-server"/"Gnome-terminal" and a title that is the shell's working directory, which
        // is why the title is suppressed - the stored row came back with `title: null`.
        ids: &["org.gnome.Terminal.desktop", "org.kde.konsole.desktop"],
        suppresses_window_title: true,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "finder",
        // Measured 2026-10-05: nautilus reports WM_CLASS "org.gnome.Nautilus" and `Exec=nautilus --new-window`
        // in its `.desktop` file, so the executable rule resolves it; the stored surface was
        // `org.gnome.Nautilus.desktop / window` with the title `Home`.
        ids: &["org.gnome.Nautilus.desktop", "org.kde.dolphin.desktop"],
        suppresses_window_title: false,
        focus_policy: FocusPolicy::Require,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_id_is_a_desktop_file_name() {
        // The host refuses an observation whose adapter it cannot resolve, and the fixture declares
        // `.desktop` ids for this platform: an id that is not one would be a silent gap.
        for adapter in ADAPTERS {
            for id in adapter.ids {
                assert!(id.ends_with(".desktop"), "{id} is not a .desktop id");
            }
        }
    }

    #[test]
    fn terminals_suppress_their_titles_and_editors_do_not() {
        for adapter in ADAPTERS {
            let suppresses = adapter.suppresses_window_title;
            if adapter.id == "terminal" {
                assert!(suppresses, "a terminal title carries a working directory");
            } else {
                assert!(!suppresses, "{} should keep its title", adapter.id);
            }
        }
    }
}
