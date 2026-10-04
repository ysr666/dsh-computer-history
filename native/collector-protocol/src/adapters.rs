//! The adapter table's shape, shared by every collector.
//!
//! The *table* is per platform and lives in each collector: win32 matches on `Code.exe` and
//! `explorer.exe`, Linux on `.desktop` ids, macOS on bundle identifiers. Only the shape is shared, and it
//! is shared because one engine reads it - a second copy of the lookup rules is the failure this crate
//! exists to prevent.
//!
//! The single source of truth for the ids themselves is `src/shared/constants.ts`; each platform's table
//! is compared with it by `tests/repository.spec.ts`, because a collector has to resolve an id before the
//! host sees anything and cannot import TypeScript.

/// What the adapter's application guarantees about focused elements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPolicy {
    /// The focused element must be queryable, or the observation is withheld (fail closed).
    Require,
    /// The application exposes no queryable element and renders its own fields; window metadata may be
    /// recorded without element fields (ADR 0006).
    WindowOnly,
}

/// One surface adapter, as far as the Windows collector needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Adapter {
    pub id: &'static str,
    pub ids: &'static [&'static str],
    /// Terminal windows carry the working directory and the running command, so their titles are never
    /// recorded.
    pub suppresses_window_title: bool,
    pub focus_policy: FocusPolicy,
}
