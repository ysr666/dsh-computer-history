//! Entry point: the protocol loop, wired to the platform module.
use std::io::{self, BufRead, Write};

use collector::{platform, protocol};

fn main() {
    let session = format!("win-{}", std::process::id());
    let mut out = io::stdout();
    let _ = writeln!(out, "{}", protocol::hello(&session, env!("CARGO_PKG_VERSION")));
    match platform::unavailable_reason() {
        None => {
            let _ = writeln!(out, "{}", protocol::state("running", true, None));
        }
        Some(reason) => {
            let _ = writeln!(out, "{}", protocol::state("permission-required", false, Some(reason)));
            let _ = writeln!(out, "{}", protocol::diagnostic("warn", "uia-unavailable", reason));
        }
    }
    let _ = out.flush();

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.contains("\"configure\"") {
            let revision = line
                .split("\"revision\":")
                .nth(1)
                .and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next())
                .and_then(|digits| digits.parse::<u64>().ok())
                .unwrap_or(0);
            let _ = writeln!(out, "{}", protocol::configured(revision));
            let _ = out.flush();
        } else if line.contains("\"shutdown\"") {
            break;
        }
    }
}
