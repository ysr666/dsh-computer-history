//! The Windows collector, split so that everything except the platform calls can be tested anywhere.
//!
//! `platform` is the only module that touches Windows: it produces the raw facts (foreground window,
//! process, application id, focused element, document path). The engine that turns those facts into the
//! messages `docs/collector-protocol.md` defines lives in `dsh_collector_protocol::engine` and is the same
//! code the Linux collector runs - the part a Windows machine is *not* needed to verify, and the part the
//! conformance suite measures.

pub mod adapters;
pub mod platform;

#[cfg(windows)]
mod windows_impl;

/// The shared engine, re-exported under the name this crate always used.
pub use dsh_collector_protocol::engine as collector;

/// The shared message layer, re-exported under the name this crate always used.
pub use dsh_collector_protocol as protocol;

pub use dsh_collector_protocol::{is_protected, PROTECTED_IDS};

/// The surface kinds a collector may report, as the adapter table names them.
pub const SURFACE_EDITOR: &str = "editor";
pub const SURFACE_TERMINAL: &str = "terminal";
pub const SURFACE_WINDOW: &str = "window";
pub const SURFACE_BROWSER: &str = "browser";
