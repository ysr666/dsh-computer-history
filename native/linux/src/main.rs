//! Entry point: the protocol loop, wired to the Linux platform module.
//!
//! The command loop is the shared one (`dsh_collector_protocol::command`). This collector used to scan the
//! raw line for the substring `"configure"` and then take the digits after `"revision":`, which acked
//! `revision 0` for a `pause` whose note happened to contain the word, truncated a long revision to
//! nothing, and ignored `pause`/`resume` entirely. An adversarial re-run of the serde migration found all
//! three by driving the real binary; they are gone because one function now decides what a line means.
use std::io::{self, BufRead, Write};

use collector::{platform, protocol};
use protocol::command::{self, Command};

fn main() {
    let session = format!("linux-{}", std::process::id());
    let mut out = io::stdout();
    let _ = writeln!(
        out,
        "{}",
        protocol::hello(&session, env!("CARGO_PKG_VERSION"), "linux")
    );
    let accessibility = platform::accessibility_state();
    let trusted = accessibility.state_name() == "running";
    let _ = writeln!(
        out,
        "{}",
        protocol::state(accessibility.state_name(), trusted, accessibility.reason())
    );
    if let Some(reason) = accessibility.reason() {
        let _ = writeln!(
            out,
            "{}",
            protocol::diagnostic("warn", "at-spi-unavailable", reason)
        );
    }
    let _ = out.flush();

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Some(command) = command::parse_command(&line) else {
            continue;
        };
        let lines = match command {
            // The policy is acknowledged but not applied: there is no observation engine on this platform
            // yet. The acknowledgement is not optional - the host stops a collector that does not answer -
            // and the state line above already says this collector cannot observe.
            Command::Configure { revision, .. } => vec![protocol::configured(revision)],
            Command::Pause => vec![protocol::state("paused", trusted, None)],
            Command::Resume => vec![protocol::state(
                accessibility.state_name(),
                trusted,
                accessibility.reason(),
            )],
            Command::Shutdown => break,
        };
        for line in lines {
            let _ = writeln!(out, "{line}");
        }
        let _ = out.flush();
    }
}
