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
        // Declared, not yet measured: no Linux machine in this repository has run VS Code. The id is what
        // the Debian and Ubuntu packages install.
        ids: &["code.desktop"],
        suppresses_window_title: false,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "terminal",
        // Terminal windows carry the working directory and the running command, so their titles are never
        // recorded - the same decision the other two platforms make.
        ids: &["org.gnome.Terminal.desktop", "org.kde.konsole.desktop"],
        suppresses_window_title: true,
        focus_policy: FocusPolicy::Require,
    },
    Adapter {
        id: "finder",
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
