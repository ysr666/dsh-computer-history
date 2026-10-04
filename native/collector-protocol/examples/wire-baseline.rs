//! Prints one real line of every message a collector can actually emit.
//!
//! The wire format needs a reference that lives outside the tests: a migration of the encoder can only
//! be called equivalent if it is compared against bytes, field by field, rather than against a claim.
//!
//!     cargo run --example wire-baseline
//!
//! Five types appear here, not six: `docs/collector-protocol.md` documents `fatal` ("when it cannot
//! continue") and the host parses it (`src/host/collector/manager.ts`), but neither the Rust nor the
//! Swift collector constructs one - there is no condition in either that maps to it. The baseline records
//! what exists; the gap belongs to the protocol document, not to this example.
//!
//! The lines are deterministic on purpose: fixed session, clock, pid and sequence numbers, so a diff
//! against the baseline is a diff of the format and nothing else.

use dsh_collector_protocol::{configured, diagnostic, hello, state, Observation};

fn observation() -> Observation {
    Observation {
        collector_session: "win-4242".to_string(),
        seq: 7,
        observed_at_ms: 1_791_000_000_000,
        pid: 4242,
        application_id: "Code.exe".to_string(),
        application_name: Some("Visual Studio Code".to_string()),
        window_title: Some("provider.ts".to_string()),
        document: None,
        element_role: Some("Document".to_string()),
        adapter: "vscode".to_string(),
        provider: "windows-uia",
        secure: false,
        protected: false,
        privacy_reason: None,
        idle_seconds: Some(0),
        selection_text: None,
    }
}

fn main() {
    // A protected application: identity only, with the reason the host counts refusals by.
    let protected = Observation {
        seq: 8,
        application_id: "notepad.exe".to_string(),
        application_name: None,
        window_title: None,
        element_role: None,
        adapter: "protected".to_string(),
        provider: "windows-uia",
        protected: true,
        privacy_reason: Some("protected-app".to_string()),
        idle_seconds: None,
        ..observation()
    };
    // A title carrying a control character: the encoder has to keep it rather than mangle it.
    let control = Observation {
        seq: 9,
        window_title: Some("a\u{7}b".to_string()),
        ..observation()
    };
    // Backspace and form feed: JSON can spell both as `\u0008`/`\u000c` or as `\b`/`\f`, and the two
    // encoders chose differently. This is the one place the migration changes bytes rather than values,
    // which an adversarial re-run found by enumerating 0x00-0x1F; the samples are here so the difference is
    // visible in the reference instead of waiting to be discovered.
    let backspace = Observation {
        seq: 10,
        window_title: Some("c\u{8}d".to_string()),
        ..observation()
    };
    let form_feed = Observation {
        seq: 11,
        window_title: Some("e\u{c}f".to_string()),
        ..observation()
    };

    println!("{}", hello("win-4242", env!("CARGO_PKG_VERSION"), "win32"));
    println!("{}", configured(3));
    println!("{}", state("running", true, None));
    println!("{}", state("permission-required", false, Some("uia-unavailable")));
    println!(
        "{}",
        diagnostic("warn", "uia-unavailable", "UI Automation is not answering")
    );
    println!("{}", observation().to_line());
    println!("{}", protected.to_line());
    println!("{}", control.to_line());
    println!("{}", backspace.to_line());
    println!("{}", form_feed.to_line());
}
