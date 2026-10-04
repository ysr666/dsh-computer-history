//! Prints the foreground application identity the collector sees, once a second.
//!
//!   cargo run --release --example foreground_identity -- 12
//!
//! This is the measurement behind the Windows row of docs/validation-three-platforms.md. An adapter
//! table can only list identity strings Windows really reports, and a collector that silently ignores
//! an application cannot say what it saw - so the measurement runs through the same `platform` seam the
//! collector uses, not through a second implementation that could disagree with it.
//!
//! The second half of each line is what `describe()` reads: the window title, the focused element's
//! control type and its password flag. That is the whole read surface - nothing here reads text, a
//! selection or a value pattern - and the tool deliberately skips the policy gate, because measuring
//! what the platform exposes is not the same question as deciding what may be recorded.

use std::thread::sleep;
use std::time::Duration;

use collector::platform::{DefaultSource, ObservationSource};

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);
    let mut source = DefaultSource::new();
    println!("availability: {:?}", source.availability());
    for _ in 0..seconds {
        match source.foreground() {
            Some(identity) => match source.describe(&identity) {
                Some(facts) => println!(
                    "pid={} id={:?} name={:?} title={:?} role={:?} element={:?}",
                    identity.pid,
                    identity.application_id,
                    identity.application_name,
                    facts.window_title,
                    facts.element_role,
                    facts.element_state,
                ),
                None => println!(
                    "pid={} id={:?} name={:?} (no metadata: the foreground changed or the window is gone)",
                    identity.pid, identity.application_id, identity.application_name
                ),
            },
            None => println!("(no foreground window)"),
        }
        sleep(Duration::from_secs(1));
    }
}
