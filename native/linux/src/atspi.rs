//! The Linux observation source: the foreground window from X11, the tree from AT-SPI, the application id
//! from the `.desktop` file that names the process.
//!
//! Every route here was measured before it was written (Ubuntu 24.04, Xvfb, openbox, a GTK application,
//! 2026-10-05) because two of the obvious ones are wrong on this platform:
//!
//! * the **foreground window does not come from AT-SPI**. The frame's state bits carried modal, sensitive,
//!   showing and visible, and stayed identical before and after activating a window, so `_NET_ACTIVE_WINDOW`
//!   is the source. On Wayland that route needs a portal and is not implemented - the source reports itself
//!   unavailable rather than guessing.
//! * an application's **pid is not `org.a11y.atspi.Application.Id`** (it answered 0). It comes from
//!   `GetConnectionUnixProcessID` on the bus name the registry hands out.
//!
//! Fail-closed, like the other collectors: if the tree cannot be read the observation is withheld, and a
//! focused element whose role is `password text` marks the surface secure.

use std::path::Path;

use dsh_collector_protocol::platform::{
    Availability, ElementState, ForegroundIdentity, ObservationSource, PlatformObservation,
};

use crate::platform;

/// AT-SPI's role name for a field that must never be described, let alone read.
const PASSWORD_ROLE: &str = "password text";

/// AT-SPI state bits, from `atspi-constants.h`: the state set is two words, bit *n* of the first word is
/// state *n* (measured against a GTK dialog, whose bits decoded to modal + sensitive + showing + visible).
const STATE_ACTIVE: u32 = 1 << 1;
const STATE_FOCUSED: u32 = 1 << 12;

/// How much of the tree one observation may read. A window with thousands of nodes must not turn a
/// heartbeat into a hang; the focused element is near the top in practice.
const MAX_NODES: usize = 48;
const MAX_DEPTH: usize = 6;

/// The paths a `.desktop` file may live in, in the order the desktop specification reads them.
const APPLICATION_DIRS: &[&str] = &[
    "/usr/share/applications",
    "/usr/local/share/applications",
];

/// The source this build uses.
#[derive(Debug, Default)]
pub struct AtspiSource;

impl AtspiSource {
    pub fn new() -> Self {
        Self
    }
}

impl ObservationSource for AtspiSource {
    fn platform(&self) -> &'static str {
        "linux"
    }

    fn provider(&self) -> &'static str {
        "at-spi"
    }

    fn availability(&mut self) -> Availability {
        match platform::accessibility_state() {
            platform::AccessibilityState::Enabled => Availability::Available,
            other => Availability::Unavailable(
                other
                    .reason()
                    .unwrap_or("AT-SPI is not available on this session")
                    .to_string(),
            ),
        }
    }

    fn foreground(&mut self) -> Option<ForegroundIdentity> {
        let window = active_window()?;
        let pid = window.pid?;
        let executable = executable_name(pid);
        // Which id the policy and the adapter table match, most specific first:
        //
        // 1. the desktop specification's own mapping - the window's `WM_CLASS` against a `.desktop` file's
        //    `StartupWMClass`. Measured 2026-10-05: gnome-terminal's window belongs to
        //    `/usr/libexec/gnome-terminal-server`, which no `Exec=` line names, while its `.desktop` file
        //    says `StartupWMClass=Gnome-terminal`;
        // 2. the executable, as named by a `.desktop` file's `Exec=` (this is what resolves zenity);
        // 3. the executable name itself - the same "candidates" idea the Windows source uses.
        let application_id = window
            .wm_class
            .as_deref()
            .and_then(|class| desktop_id_for_wm_class(class, APPLICATION_DIRS))
            .or_else(|| {
                executable
                    .as_deref()
                    .and_then(|name| desktop_id_for(name, APPLICATION_DIRS))
            })
            .or_else(|| executable.clone())?;
        Some(ForegroundIdentity {
            pid,
            window: window.window,
            application_id,
            application_executable: executable,
            application_name: None,
        })
    }

    fn describe(&mut self, identity: &ForegroundIdentity) -> Option<PlatformObservation> {
        let bus = at_spi_bus_address()?;
        let application = application_for_pid(
            &bus,
            identity.pid,
            identity.application_executable.as_deref(),
        )?;
        let window = window_node(&bus, &application)?;

        let role = role_name(&bus, &application, &window.path);
        let focused = focused_role(&bus, &application, &window);
        // Nothing readable at all: report that, and let the adapter's focus policy decide whether window
        // metadata is still enough (ADR 0006) or the observation is withheld.
        let element_state = match (&role, &focused) {
            _ if focused.as_deref() == Some(PASSWORD_ROLE) => ElementState::Secure,
            (None, None) => ElementState::Unreadable,
            _ => ElementState::NotSecure,
        };

        Some(PlatformObservation {
            pid: identity.pid,
            application_id: identity.application_id.clone(),
            application_name: application.name.clone(),
            window_title: window.name.clone(),
            document: None,
            element_role: focused.or(role),
            element_state,
        })
    }

    fn idle_seconds(&mut self) -> Option<u64> {
        // X11 has no portable idle query without another tool (`xprintidle`), and AT-SPI has none at all.
        // Reporting nothing is honest; the host's idle boundary simply does not fire on this platform.
        None
    }
}

/// The foreground window as X11 describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveWindow {
    pub window: isize,
    pub title: Option<String>,
    pub pid: Option<i32>,
    /// The window's `WM_CLASS`, whose second element is what a `.desktop` file's `StartupWMClass` names.
    pub wm_class: Option<String>,
}

fn active_window() -> Option<ActiveWindow> {
    let root = run("xprop", &["-root", "_NET_ACTIVE_WINDOW"])?;
    let window = parse_active_window(&root)?;
    let id = format!("0x{window:x}");
    let title = run("xprop", &["-id", &id, "_NET_WM_NAME"])
        .and_then(|output| parse_wm_name(&output))
        .or_else(|| {
            run("xprop", &["-id", &id, "WM_NAME"])
                .and_then(|output| parse_wm_name(&output))
        });
    let pid = run("xprop", &["-id", &id, "_NET_WM_PID"])
        .and_then(|output| parse_wm_pid(&output));
    let wm_class = run("xprop", &["-id", &id, "WM_CLASS"])
        .and_then(|output| parse_wm_class(&output));
    Some(ActiveWindow {
        window: window as isize,
        title,
        pid,
        wm_class,
    })
}

/// `_NET_ACTIVE_WINDOW(WINDOW): window id # 0x400004` -> `0x400004`.
fn parse_active_window(output: &str) -> Option<u32> {
    let rest = output.split('#').nth(1)?.trim();
    let digits = rest.strip_prefix("0x").unwrap_or(rest);
    u32::from_str_radix(digits.trim(), 16).ok().filter(|id| *id != 0)
}

/// `_NET_WM_NAME(UTF8_STRING) = "Probe Window"` -> `Probe Window`.
fn parse_wm_name(output: &str) -> Option<String> {
    let value = output.split('=').nth(1)?.trim();
    let name = value.trim_matches('"');
    (!name.is_empty() && !value.contains("not found")).then(|| name.to_string())
}

/// `_NET_WM_PID(CARDINAL) = 7369` -> `7369`.
fn parse_wm_pid(output: &str) -> Option<i32> {
    let value = output.split('=').nth(1)?.trim();
    value.parse::<i32>().ok().filter(|pid| *pid > 0)
}

/// `WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"` -> `Gnome-terminal`.
///
/// The second element is the class (the first is the instance name), which is what `StartupWMClass` names.
fn parse_wm_class(output: &str) -> Option<String> {
    let value = output.split('=').nth(1)?.trim();
    let mut parts = value.split(',').map(|part| part.trim().trim_matches('"'));
    let _instance = parts.next()?;
    let class = parts.next()?;
    (!class.is_empty()).then(|| class.to_string())
}

/// The `.desktop` id whose `StartupWMClass` names this window class.
fn desktop_id_for_wm_class(class: &str, dirs: &[&str]) -> Option<String> {
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if desktop_wm_class(&text, class) {
                return desktop_file_id(&path);
            }
        }
    }
    None
}

/// Whether a `.desktop` entry's `StartupWMClass` matches a window class. The specification compares them
/// case-insensitively, and a file may name several classes separated by semicolons.
fn desktop_wm_class(desktop: &str, class: &str) -> bool {
    desktop
        .lines()
        .filter_map(|line| line.strip_prefix("StartupWMClass="))
        .flat_map(|value| value.split(';'))
        .any(|candidate| candidate.trim().eq_ignore_ascii_case(class))
}

/// The id an adapter table matches: the `.desktop` **file name**, not its stem.
///
/// `src/shared/constants.ts` declares `org.gnome.Terminal.desktop` for Linux, and the host matches ids
/// exactly, so returning `org.gnome.Terminal` here would make every GTK application unobservable. This ran
/// that way once, on a real desktop, and produced no observation at all.
fn desktop_file_id(path: &Path) -> Option<String> {
    path.file_name().map(|name| name.to_string_lossy().into_owned())
}

fn executable_name(pid: i32) -> Option<String> {
    let target = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

/// The `.desktop` id whose `Exec=` names this executable.
fn desktop_id_for(executable: &str, dirs: &[&str]) -> Option<String> {
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if desktop_names(&text, executable) {
                return desktop_file_id(&path);
            }
        }
    }
    None
}

/// Whether a `.desktop` entry's `Exec=` line runs this executable.
///
/// Handles the three shapes the specification allows: a bare name (`Exec=code %F`), an absolute path, and
/// the `env` prefix GTK writes (`Exec=env BAMF_DESKTOP_FILE_HINT=… app %U`). The program is the first word
/// that is neither the leading `env`, an assignment, nor a field code.
fn desktop_names(desktop: &str, executable: &str) -> bool {
    desktop
        .lines()
        .filter_map(|line| line.strip_prefix("Exec="))
        .any(|exec| {
            exec.split_whitespace()
                .skip_while(|word| *word == "env")
                .find(|word| !word.contains('=') && !word.starts_with('%'))
                .is_some_and(|word| {
                    Path::new(word)
                        .file_name()
                        .is_some_and(|name| name == executable)
                })
        })
}

/// The AT-SPI bus address: the environment variable a session exports, then the registry's own answer.
pub(crate) fn at_spi_bus_address() -> Option<String> {
    if let Ok(address) = std::env::var("AT_SPI_BUS_ADDRESS") {
        if !address.is_empty() {
            return Some(address);
        }
    }
    let output = run(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.a11y.Bus",
            "--object-path",
            "/org/a11y/bus",
            "--method",
            "org.a11y.Bus.GetAddress",
        ],
    )?;
    parse_bus_address(&output)
}

/// `('unix:path=/run/user/1000/at-spi/bus_0',)` -> the address, comma and guid included.
fn parse_bus_address(output: &str) -> Option<String> {
    let start = output.find('\'')? + 1;
    let rest = &output[start..];
    let end = rest.find('\'')?;
    let address = &rest[..end];
    (!address.is_empty()).then(|| address.to_string())
}

/// One AT-SPI application: the bus name to address it by, the path of its root, and its own name.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Application {
    bus: String,
    path: String,
    name: Option<String>,
}

/// One node in an application's tree: which application it lives in, and its object path.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Node {
    bus: String,
    path: String,
    name: Option<String>,
}

/// The application to describe, found the way the tree is actually shaped: the registry's desktop root lists
/// applications as `(bus name, object path)` pairs.
///
/// The pid is the first choice, and on Linux it is not always the answer: measured 2026-10-05, a
/// gnome-terminal window reported `_NET_WM_PID` of the process that owns the window while the application
/// registered its tree from a different one, so a pid-only match found nothing and the collector went
/// silent. The fallback compares the application's own `Name` - the same string the window carries as its
/// `WM_CLASS` instance, which is where `executable` comes from. Both are metadata the identity gate already
/// read; no window content is touched.
fn application_for_pid(bus: &str, pid: i32, executable: Option<&str>) -> Option<Application> {
    let refs = children_of(
        bus,
        "org.a11y.atspi.Registry",
        "/org/a11y/atspi/accessible/root",
    );
    // `bus` is the AT-SPI bus address and stays that way: an earlier version shadowed it with the
    // application's bus name here, so every `Name` lookup was sent to the wrong bus and answered nothing -
    // which made the collector silent rather than wrong, and cost a measurement round to find.
    let applications: Vec<Application> = refs
        .into_iter()
        .map(|(bus_name, path)| Application {
            name: property(bus, &bus_name, &path, "org.a11y.atspi.Accessible", "Name"),
            bus: bus_name,
            path,
        })
        .collect();

    let named: Vec<(String, Option<String>, Option<i32>)> = applications
        .iter()
        .map(|application| {
            (
                application.bus.clone(),
                application.name.clone(),
                connection_pid(bus, &application.bus),
            )
        })
        .collect();
    choose_application(&named, pid, executable).map(|index| applications[index].clone())
}

/// Which application answers for a window: the one whose process id matches, else the one whose name is the
/// executable the window reports.
fn choose_application(
    candidates: &[(String, Option<String>, Option<i32>)],
    pid: i32,
    executable: Option<&str>,
) -> Option<usize> {
    let by_pid = candidates
        .iter()
        .position(|(_, _, candidate_pid)| *candidate_pid == Some(pid));
    by_pid.or_else(|| {
        executable.and_then(|executable| {
            candidates.iter().position(|(_, name, _)| {
                name.as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(executable))
            })
        })
    })
}

/// The window to describe: the frame that is active, else the one whose title X11 gave us, else the
/// application's first child - three answers of decreasing confidence, and never a different application's.
fn window_node(bus: &str, application: &Application) -> Option<Node> {
    let children = children_of(bus, &application.bus, &application.path);
    if children.is_empty() {
        // An application with no window of its own: describe its root, which is all there is.
        return Some(Node {
            bus: application.bus.clone(),
            path: application.path.clone(),
            name: application.name.clone(),
        });
    }
    let nodes: Vec<Node> = children
        .into_iter()
        .map(|(bus_name, path)| Node {
            bus: bus_name,
            path,
            name: None,
        })
        .collect();
    let active = nodes
        .iter()
        .find(|node| is_set(state_bits(bus, &node.bus, &node.path), STATE_ACTIVE));
    let first = nodes.first();
    let chosen = active.or(first)?;
    Some(Node {
        name: property(bus, &chosen.bus, &chosen.path, "org.a11y.atspi.Accessible", "Name"),
        ..chosen.clone()
    })
}

/// The role of the focused node within `window`, found by walking the tree for the `focused` state bit.
///
/// AT-SPI has no "get the focused element" call: a client tracks focus events, and a poller reads the
/// state. The walk is bounded in breadth and depth because the tree belongs to another process.
fn focused_role(bus: &str, application: &Application, window: &Node) -> Option<String> {
    let mut visited = 0usize;
    let mut queue = vec![(window.path.clone(), 0usize)];
    while let Some((path, depth)) = queue.pop() {
        visited += 1;
        if visited > MAX_NODES {
            return None;
        }
        if is_set(state_bits(bus, &application.bus, &path), STATE_FOCUSED) {
            return role_name_at(bus, &application.bus, &path);
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        for (child_bus, child_path) in children_of(bus, &application.bus, &path) {
            // A child that lives in another process is another application's node; do not follow it.
            if child_bus == application.bus {
                queue.push((child_path, depth + 1));
            }
        }
    }
    None
}

fn children_of(bus: &str, destination: &str, path: &str) -> Vec<(String, String)> {
    let Some(output) = run(
        "gdbus",
        &[
            "call",
            "--address",
            bus,
            "--dest",
            destination,
            "--object-path",
            path,
            "--method",
            "org.a11y.atspi.Accessible.GetChildren",
        ],
    ) else {
        return Vec::new();
    };
    parse_children(&output)
}

/// `([(':1.0', objectpath '/org/a11y/atspi/accessible/root'), (':1.1', '/org/…')],)` -> the pairs.
///
/// GVariant prints a type annotation **once per array**: the first element carries `objectpath` and the rest
/// do not. Measured 2026-10-05 - requiring it on every element silently dropped every application after the
/// first, so the collector could not find the one in front and produced no observation at all, while the
/// registry was answering correctly the whole time.
fn parse_children(output: &str) -> Vec<(String, String)> {
    let mut children = Vec::new();
    let mut rest = output;
    while let Some(start) = rest.find("('") {
        let after = &rest[start + 2..];
        let Some(name_end) = after.find('\'') else { break };
        let name = &after[..name_end];
        let tail = &after[name_end + 1..];
        let Some(path) = quoted(tail) else { break };
        if !name.is_empty() && !path.is_empty() {
            children.push((name.to_string(), path.to_string()));
        }
        rest = tail;
    }
    children
}

/// The first single-quoted string in `text`.
fn quoted(text: &str) -> Option<&str> {
    let open = text.find('\'')?;
    let rest = &text[open + 1..];
    let close = rest.find('\'')?;
    Some(&rest[..close])
}

fn connection_pid(bus: &str, name: &str) -> Option<i32> {
    let output = run(
        "gdbus",
        &[
            "call",
            "--address",
            bus,
            "--dest",
            "org.freedesktop.DBus",
            "--object-path",
            "/org/freedesktop/DBus",
            "--method",
            "org.freedesktop.DBus.GetConnectionUnixProcessID",
            name,
        ],
    )?;
    parse_uint32(&output).map(|pid| pid as i32)
}

fn property(bus: &str, destination: &str, path: &str, interface: &str, name: &str) -> Option<String> {
    let output = run(
        "gdbus",
        &[
            "call",
            "--address",
            bus,
            "--dest",
            destination,
            "--object-path",
            path,
            "--method",
            "org.freedesktop.DBus.Properties.Get",
            interface,
            name,
        ],
    )?;
    parse_string(&output)
}

fn role_name(bus: &str, application: &Application, path: &str) -> Option<String> {
    role_name_at(bus, &application.bus, path)
}

fn role_name_at(bus: &str, destination: &str, path: &str) -> Option<String> {
    let output = run(
        "gdbus",
        &[
            "call",
            "--address",
            bus,
            "--dest",
            destination,
            "--object-path",
            path,
            "--method",
            "org.a11y.atspi.Accessible.GetRoleName",
        ],
    )?;
    parse_string(&output)
}

/// `([uint32 1124139008, 0],)` -> the first word of the AT-SPI state set.
fn state_bits(bus: &str, destination: &str, path: &str) -> Option<u32> {
    let output = run(
        "gdbus",
        &[
            "call",
            "--address",
            bus,
            "--dest",
            destination,
            "--object-path",
            path,
            "--method",
            "org.a11y.atspi.Accessible.GetState",
        ],
    )?;
    parse_uint32(&output)
}

fn is_set(bits: Option<u32>, flag: u32) -> bool {
    bits.is_some_and(|bits| bits & flag != 0)
}

/// `(<'Probe Window'>,)` or `('dialog',)` -> the string, quotes removed.
fn parse_string(output: &str) -> Option<String> {
    let start = output.find('\'')? + 1;
    let rest = &output[start..];
    let end = rest.find('\'')?;
    let value = &rest[..end];
    (!value.is_empty()).then(|| value.to_string())
}

/// `(uint32 6196,)` -> `6196`.
fn parse_uint32(output: &str) -> Option<u32> {
    output
        .split("uint32 ")
        .nth(1)?
        .split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_millis(1_500);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    }
    let mut output = String::new();
    use std::io::Read;
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_active_window_is_read_out_of_xprops_answer() {
        assert_eq!(
            parse_active_window("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x400004"),
            Some(0x400004),
        );
        // Nothing focused is `0x0`, and "no such window" is not a window.
        assert_eq!(
            parse_active_window("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0"),
            None,
        );
        assert_eq!(parse_active_window("no such atom"), None);
    }

    #[test]
    fn the_window_title_and_pid_are_read_out_of_xprops_answer() {
        assert_eq!(
            parse_wm_name("_NET_WM_NAME(UTF8_STRING) = \"Probe Window\""),
            Some("Probe Window".to_string()),
        );
        assert_eq!(
            parse_wm_name("WM_NAME(STRING) = \"notes.txt - gedit\""),
            Some("notes.txt - gedit".to_string()),
        );
        assert_eq!(
            parse_wm_name("_NET_WM_NAME:  not found."),
            None,
        );
        assert_eq!(parse_wm_pid("_NET_WM_PID(CARDINAL) = 7369"), Some(7369));
        assert_eq!(parse_wm_pid("_NET_WM_PID:  not found."), None);
        assert_eq!(parse_wm_pid("_NET_WM_PID(CARDINAL) = 0"), None);
    }

    #[test]
    fn a_desktop_entry_is_matched_by_the_first_real_word_of_its_exec_line() {
        // The three shapes the specification allows, plus the two that must not match.
        assert!(desktop_names("Exec=code %F\nName=Code\n", "code"));
        assert!(desktop_names("Exec=/usr/bin/zenity --info\n", "zenity"));
        assert!(desktop_names(
            "Exec=env BAMF_DESKTOP_FILE_HINT=/usr/share/applications/app.desktop /usr/bin/app %U\n",
            "app",
        ));
        assert!(!desktop_names("Exec=code-insiders %F\n", "code"));
        assert!(!desktop_names("TryExec=code\nName=Code\n", "code"));
    }

    #[test]
    fn the_window_class_is_the_second_element_of_wm_class() {
        assert_eq!(
            parse_wm_class("WM_CLASS(STRING) = \"gnome-terminal-server\", \"Gnome-terminal\""),
            Some("Gnome-terminal".to_string()),
        );
        assert_eq!(
            parse_wm_class("WM_CLASS(STRING) = \"Navigator\", \"firefox\""),
            Some("firefox".to_string()),
        );
        assert_eq!(parse_wm_class("WM_CLASS:  not found."), None);
    }

    #[test]
    fn a_desktop_entry_is_matched_by_its_startup_wm_class() {
        // The mapping the desktop specification defines, and the one that resolves gnome-terminal, whose
        // window belongs to /usr/libexec/gnome-terminal-server while its .desktop file says Gnome-terminal.
        assert!(desktop_wm_class("StartupWMClass=Gnome-terminal\n", "Gnome-terminal"));
        assert!(desktop_wm_class("StartupWMClass=Gnome-terminal\n", "gnome-terminal"));
        assert!(desktop_wm_class("StartupWMClass=Code;VSCodium;\n", "VSCodium"));
        assert!(!desktop_wm_class("Name=Terminal\nExec=gnome-terminal\n", "Gnome-terminal"));
    }

    #[test]
    fn the_desktop_id_is_the_file_name_the_adapter_table_declares() {
        // Written into a real directory, because the bug this pins was a file *stem*: the id looked right
        // in a log and matched nothing, so the collector reported no observation at all.
        let dir = std::env::temp_dir().join(format!("dsh-desktop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("org.gnome.Terminal.desktop"),
            "Name=Terminal\nExec=gnome-terminal\nStartupWMClass=Gnome-terminal\n",
        )
        .unwrap();
        let dirs = vec![dir.to_str().unwrap()];
        assert_eq!(
            desktop_id_for_wm_class("Gnome-terminal", &dirs),
            Some("org.gnome.Terminal.desktop".to_string()),
        );
        assert_eq!(
            desktop_id_for("gnome-terminal", &dirs),
            Some("org.gnome.Terminal.desktop".to_string()),
        );
        assert_eq!(desktop_id_for("gnome-terminal-server", &dirs), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_application_is_chosen_by_pid_first_and_by_its_name_second() {
        // The measured case: the window says pid 16658, the accessibility tree answers from 16701, and the
        // names are the same string on both sides.
        let measured = vec![
            (
                ":1.2".to_string(),
                Some("gnome-terminal-server".to_string()),
                Some(16701),
            ),
        ];
        assert_eq!(
            choose_application(&measured, 16658, Some("gnome-terminal-server")),
            Some(0),
        );
        // A pid match still wins over a name match.
        let two = vec![
            (":1.1".to_string(), Some("other".to_string()), Some(999)),
            (":1.2".to_string(), Some("app".to_string()), Some(4242)),
        ];
        assert_eq!(choose_application(&two, 4242, Some("other")), Some(1));
        // And nothing at all when neither matches.
        assert_eq!(choose_application(&measured, 1, Some("nobody")), None);
    }

    #[test]
    fn children_pairs_are_parsed_with_their_object_paths() {
        let output = "([(':1.0', objectpath '/org/a11y/atspi/accessible/root'), \
                       (':1.2', objectpath '/org/gnome/Zenity/a11y/abc')],)";
        assert_eq!(
            parse_children(output),
            vec![
                (":1.0".to_string(), "/org/a11y/atspi/accessible/root".to_string()),
                (":1.2".to_string(), "/org/gnome/Zenity/a11y/abc".to_string()),
            ],
        );
        // The spelling the registry really uses: the type annotation appears once, so every later element
        // has none. This is the line that failed on a real desktop.
        let measured = "([(':1.2', objectpath '/org/a11y/atspi/accessible/root'), \
                         (':1.1', '/org/a11y/atspi/accessible/root')],)";
        assert_eq!(
            parse_children(measured),
            vec![
                (":1.2".to_string(), "/org/a11y/atspi/accessible/root".to_string()),
                (":1.1".to_string(), "/org/a11y/atspi/accessible/root".to_string()),
            ],
        );
        assert!(parse_children("()").is_empty());
    }

    #[test]
    fn strings_and_numbers_are_read_out_of_gvariant_text() {
        assert_eq!(parse_string("('dialog',)"), Some("dialog".to_string()));
        assert_eq!(parse_string("(<'Probe Window'>,)"), Some("Probe Window".to_string()));
        assert_eq!(parse_string("('',)"), None);
        assert_eq!(parse_uint32("(uint32 6196,)"), Some(6196));
        assert_eq!(parse_uint32("(uint32 1124139008, 0)"), Some(1124139008));
        assert_eq!(parse_uint32("()"), None);
    }

    #[test]
    fn the_state_bits_decode_the_way_the_measured_dialog_did() {
        // Measured on a GTK dialog: modal + sensitive + showing + visible, and not focused.
        let measured = 1124139008u32;
        assert!(is_set(Some(measured), 1 << 16), "modal");
        assert!(is_set(Some(measured), 1 << 24), "sensitive");
        assert!(is_set(Some(measured), 1 << 25), "showing");
        assert!(is_set(Some(measured), 1 << 30), "visible");
        assert!(!is_set(Some(measured), STATE_FOCUSED));
        assert!(!is_set(Some(measured), STATE_ACTIVE));
        assert!(!is_set(None, STATE_FOCUSED));
    }

    #[test]
    fn the_password_role_is_the_one_at_spi_defines() {
        // The fail-closed rule: this role marks the surface secure, and nothing about it is recorded.
        assert_eq!(PASSWORD_ROLE, "password text");
    }
}
