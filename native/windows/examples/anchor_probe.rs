//! Prints what UI Automation exposes around the foreground window that could anchor an observation.
//!
//!   cargo run --release --example anchor_probe -- 12
//!
//! Why this exists: a Windows observation currently carries no resource - no document path, no URL - so an
//! episode can never name the work it describes (measured 2026-10-05: thirteen stored observations, zero
//! episodes). Before the collector reads anything, the question "what could it read" has to be answered by
//! the platform itself. The probe runs through the same `platform` seam the collector uses - same COM
//! instance, same 0.5 s timeouts - so what it prints is what the collector could see, not what a second
//! implementation happens to expose.
//!
//! The Value pattern is deliberately not read, here or anywhere else in this repository: an address bar's
//! value is a URL and a document's value is its text, and `scripts/verify-privacy-boundary.mjs` forbids
//! content patterns repo-wide. What the probe reads is metadata - control type, name, automation id, class
//! name, help text, item status, password flag - which is where a location has to come from if it can come
//! from anywhere at all.

use std::thread::sleep;
use std::time::Duration;

use collector::platform::anchor_candidates;

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);

    for _ in 0..seconds {
        let candidates = anchor_candidates(24);
        if candidates.is_empty() {
            println!("(nothing: no foreground window, or UI Automation is unavailable)");
        }
        for candidate in candidates {
            println!(
                "{:<10} type={:?} id={:?} class={:?} name={:?} help={:?} status={:?} password={:?}",
                candidate.relation,
                candidate.control_type,
                candidate.automation_id,
                candidate.class_name,
                candidate.name,
                candidate.help_text,
                candidate.item_status,
                candidate.is_password,
            );
        }
        println!("---");
        sleep(Duration::from_secs(1));
    }
}
