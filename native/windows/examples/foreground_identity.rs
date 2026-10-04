//! Prints the foreground application identity the collector sees, once a second.
//!
//!   cargo run --release --example foreground_identity -- 12
//!
//! This is the measurement behind the Windows row of docs/validation-three-platforms.md. An adapter
//! table can only list identity strings Windows really reports, and a collector that silently ignores
//! an application cannot say what it saw - so the measurement runs through the same `platform` seam the
//! collector uses, not through a second implementation that could disagree with it.

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
            Some(identity) => println!(
                "pid={} id={:?} name={:?}",
                identity.pid, identity.application_id, identity.application_name
            ),
            None => println!("(no foreground window)"),
        }
        sleep(Duration::from_secs(1));
    }
}
