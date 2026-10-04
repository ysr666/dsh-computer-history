//! Entry point: the protocol loop, wired to the platform module.
//!
//! stdin is read on its own thread because the main thread owns the platform reads (UI Automation wants
//! COM on one thread) and the heartbeat; the channel carries commands between them.

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use collector::platform::DefaultSource;
use collector::collector::{Collector, HEARTBEAT_SECONDS};
use collector::protocol::command::{self, Command};

fn main() {
    let session = format!("win-{}", std::process::id());
    let mut collector = Collector::new(session, DefaultSource::new());

    let (sender, receiver) = mpsc::channel::<Command>();
    std::thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if let Some(command) = command::parse_command(&line) {
                if sender.send(command).is_err() {
                    break;
                }
            }
        }
    });

    let mut stdout = io::stdout();
    emit(&mut stdout, collector.start());
    let heartbeat = Duration::from_secs(HEARTBEAT_SECONDS);
    let mut last_tick = Instant::now();
    loop {
        // A command stream faster than the heartbeat must not starve the reconcile loop: wait at most
        // the remaining time, then tick whenever a full heartbeat has passed.
        let wait = heartbeat.saturating_sub(last_tick.elapsed());
        match receiver.recv_timeout(wait.max(Duration::from_millis(1))) {
            Ok(Command::Configure { revision, policy }) => {
                emit(&mut stdout, collector.configure(revision, policy));
            }
            Ok(Command::Pause) => emit(&mut stdout, collector.set_paused(true)),
            Ok(Command::Resume) => emit(&mut stdout, collector.set_paused(false)),
            Ok(Command::Shutdown) => break,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_tick.elapsed() >= heartbeat {
            emit(&mut stdout, collector.tick());
            last_tick = Instant::now();
        }
    }
}

fn emit(stdout: &mut io::Stdout, lines: Vec<String>) {
    for line in lines {
        let _ = writeln!(stdout, "{line}");
    }
    let _ = stdout.flush();
}
