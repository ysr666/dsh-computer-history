//! The platform-independent collector engine.
//!
//! Mirrors `native/macos/Sources/ComputerHistoryCollector/Collector.swift`: a 5 s heartbeat reconciles
//! the foreground state, an unchanged fingerprint does not produce a second observation, policy decides
//! what is eligible before anything is read, and a secure or protected surface is reported so the host can
//! count the refusal instead of losing it.
//!
//! Nothing here knows about Windows; `platform.rs` hands over the facts and `command.rs` the policy.

use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::adapters::{Adapter, FocusPolicy};
use crate::protocol::command::Policy;
use crate::platform::{Availability, ElementState, ObservationSource};
use crate::protocol;

pub const HEARTBEAT_SECONDS: u64 = 5;
const IDLE_BOUNDARY_SECONDS: u64 = 8 * 60;

/// What produced an observation on this platform. The host stores this verbatim and audits read it, so
/// it has to name the real path rather than defaulting to the macOS one.
const PROVIDER: &str = "windows-uia";

const REASON_SECURE_FIELD: &str = "secure-field";
const REASON_UNREADABLE: &str = "unreadable-focused-element";
const REASON_UNQUERYABLE: &str = "focused-element-unqueryable";
const REASON_PROTECTED: &str = "protected-app";
const PROTECTED_ADAPTER_MARKER: &str = "protected";

/// The facts an observation is deduplicated by. An unchanged fingerprint produces nothing, which is why
/// sitting in one file does not produce one observation per heartbeat.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    pid: i32,
    application_id: String,
    application_name: Option<String>,
    adapter: Option<&'static str>,
    title: Option<String>,
    document: Option<String>,
    role: Option<String>,
    secure: bool,
    protected: bool,
    idle_boundary: bool,
    /// The reason a secure/protected observation carries. Part of the fingerprint so that a change of
    /// reason (for example secure -> unreadable) is not silently deduplicated away.
    reason: Option<&'static str>,
}

type Clock = fn() -> i64;

fn system_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Collector<S: ObservationSource> {
    session: String,
    seq: u64,
    source: S,
    adapters: &'static [Adapter],
    clock: Clock,
    paused: bool,
    allowed: HashSet<String>,
    blocked: HashSet<String>,
    protected: HashSet<String>,
    protected_paths: Vec<String>,
    last_fingerprint: Option<Fingerprint>,
    last_availability: Option<Availability>,
}

impl<S: ObservationSource> Collector<S> {
    pub fn new(session: String, source: S) -> Self {
        Self::create(session, source, crate::adapters::ADAPTERS, system_now_ms)
    }

    fn create(
        session: String,
        source: S,
        adapters: &'static [Adapter],
        clock: Clock,
    ) -> Self {
        Self {
            session,
            seq: 0,
            source,
            adapters,
            clock,
            paused: false,
            allowed: HashSet::new(),
            blocked: HashSet::new(),
            protected: HashSet::new(),
            protected_paths: Vec::new(),
            last_fingerprint: None,
            last_availability: None,
        }
    }

    /// `hello`, the initial state, and a first reconcile, in that order.
    pub fn start(&mut self) -> Vec<String> {
        let mut lines = vec![protocol::hello(
            &self.session,
            env!("CARGO_PKG_VERSION"),
            "win32",
        )];
        let availability = self.update_availability(&mut lines);
        if matches!(availability, Availability::Available) {
            lines.extend(self.reconcile());
        }
        lines
    }

    /// One heartbeat.
    pub fn tick(&mut self) -> Vec<String> {
        self.reconcile()
    }

    pub fn configure(&mut self, revision: u64, policy: Policy) -> Vec<String> {
        self.allowed = lowercased(policy.allowed_bundle_ids);
        self.blocked = lowercased(policy.blocked_bundle_ids);
        self.protected = lowercased(policy.protected_bundle_ids);
        self.protected_paths = policy.protected_path_patterns;
        self.last_fingerprint = None;

        let mut lines = vec![protocol::configured(revision)];
        lines.extend(self.reconcile());
        lines
    }

    /// Pause and resume keep the macOS collector's state messages: the host waits for them, so a paused
    /// collector must not look like a broken one.
    pub fn set_paused(&mut self, paused: bool) -> Vec<String> {
        self.paused = paused;
        self.last_fingerprint = None;
        let availability = self.source.availability();
        let mut lines = Vec::new();
        if paused {
            lines.push(protocol::state(
                "paused",
                matches!(availability, Availability::Available),
                None,
            ));
        } else {
            self.last_availability = Some(availability.clone());
            lines.push(availability_state(&availability));
            lines.extend(self.reconcile());
        }
        lines
    }

    fn reconcile(&mut self) -> Vec<String> {
        let mut lines = Vec::new();
        if self.paused {
            return lines;
        }
        let availability = self.update_availability(&mut lines);
        if let Availability::Unavailable(_) = availability {
            self.last_fingerprint = None;
            return lines;
        }

        let Some(identity) = self.source.foreground() else {
            self.last_fingerprint = None;
            return lines;
        };
        let candidates = identity.candidates();
        if candidates
            .iter()
            .any(|id| self.blocked.contains(&id.to_lowercase()))
        {
            self.last_fingerprint = None;
            return lines;
        }

        // A protected application is reported with its identity only, so the host can count the refusal
        // by reason (docs/collector-protocol.md); no window metadata is read for it. This is a
        // deliberate divergence from the macOS collector, which emits nothing for a protected
        // application - the protocol document promises the count and the acceptance asks for it.
        let protected_id = candidates.iter().find(|id| {
            protocol::is_protected(id) || self.protected.contains(&id.to_lowercase())
        });
        if let Some(protected_id) = protected_id {
            let adapter_id = self.adapter_id(protected_id);
            let fingerprint = Fingerprint {
                pid: identity.pid,
                application_id: (*protected_id).to_string(),
                application_name: None,
                adapter: adapter_id,
                title: None,
                document: None,
                role: None,
                secure: false,
                protected: true,
                idle_boundary: false,
                reason: Some(REASON_PROTECTED),
            };
            if self.last_fingerprint.as_ref() == Some(&fingerprint) {
                return lines;
            }
            self.last_fingerprint = Some(fingerprint);
            self.seq += 1;
            lines.push(
                protocol::Observation {
                    collector_session: self.session.clone(),
                    seq: self.seq,
                    observed_at_ms: (self.clock)(),
                    pid: identity.pid,
                    application_id: truncated(Some((*protected_id).to_string()), 512)
                        .unwrap_or_default(),
                    application_name: None,
                    window_title: None,
                    document: None,
                    element_role: None,
                    adapter: adapter_id.unwrap_or(PROTECTED_ADAPTER_MARKER).to_string(),
                    provider: PROVIDER,
                    secure: false,
                    protected: true,
                    privacy_reason: Some(REASON_PROTECTED.to_string()),
                    idle_seconds: None,
                    selection_text: None,
                }
                .to_line(),
            );
            return lines;
        }

        // The reported id has to satisfy both gates at once: the host resolves the adapter from it and
        // applies its own policy to it, so an id the allow list knows but the adapter table does not
        // (or the reverse) is not usable. A window whose AppUserModelID no rule knows is still observed
        // through its executable name, instead of disappearing without a trace.
        let matched = candidates.iter().find_map(|id| {
            if !self.allowed.contains(&id.to_lowercase()) {
                return None;
            }
            self.adapters
                .iter()
                .find(|adapter| {
                    adapter
                        .ids
                        .iter()
                        .any(|known| known.eq_ignore_ascii_case(id))
                })
                .map(|adapter| (*id, adapter))
        });
        let Some((reported_id, adapter)) = matched else {
            self.last_fingerprint = None;
            return lines;
        };
        // Only now is the window read: the gate above decided this application may be observed.
        let Some(facts) = self.source.describe(&identity) else {
            self.last_fingerprint = None;
            return lines;
        };

        // Fail closed: metadata is recorded only when the element positively is not a secure field, or
        // when a window-only adapter exposes no queryable element at all (ADR 0006).
        let (metadata_allowed, reason, secure) = match facts.element_state {
            ElementState::NotSecure => (true, None, false),
            ElementState::Secure => (false, Some(REASON_SECURE_FIELD), true),
            ElementState::Unqueryable if adapter.focus_policy == FocusPolicy::WindowOnly => {
                (true, None, false)
            }
            ElementState::Unqueryable => (false, Some(REASON_UNQUERYABLE), true),
            ElementState::Unreadable => (false, Some(REASON_UNREADABLE), true),
        };

        let title = if metadata_allowed && !adapter.suppresses_window_title {
            facts.window_title.clone()
        } else {
            None
        };
        let document = if metadata_allowed {
            facts.document.clone()
        } else {
            None
        };
        if self.is_protected_metadata(document.as_deref(), true)
            || self.is_protected_metadata(title.as_deref(), false)
        {
            self.last_fingerprint = None;
            return lines;
        }
        let element_role = if metadata_allowed && facts.element_state == ElementState::NotSecure {
            facts.element_role.clone()
        } else {
            None
        };
        let idle = self.source.idle_seconds();
        let idle_boundary = idle.is_some_and(|seconds| seconds >= IDLE_BOUNDARY_SECONDS);

        let fingerprint = Fingerprint {
            pid: facts.pid,
            application_id: reported_id.to_string(),
            application_name: facts.application_name.clone(),
            adapter: Some(adapter.id),
            title: title.clone(),
            document: document.clone(),
            role: element_role.clone(),
            secure,
            protected: false,
            idle_boundary,
            reason,
        };
        if self.last_fingerprint.as_ref() == Some(&fingerprint) {
            return lines;
        }
        self.last_fingerprint = Some(fingerprint);
        self.seq += 1;
        lines.push(
            protocol::Observation {
                collector_session: self.session.clone(),
                seq: self.seq,
                observed_at_ms: (self.clock)(),
                pid: facts.pid,
                application_id: truncated(Some(reported_id.to_string()), 512).unwrap_or_default(),
                // The host refuses lines whose fields exceed its own bounds, and a refusal on the wire
                // is fatal; the collector is where an application's own long title gets cut.
                application_name: truncated(facts.application_name, 512),
                window_title: truncated(title, 4_096),
                document: truncated(document, 4_096),
                element_role: truncated(element_role, 2_048),
                adapter: adapter.id.to_string(),
                provider: PROVIDER,
                secure,
                protected: false,
                privacy_reason: reason.map(str::to_string),
                idle_seconds: idle,
                selection_text: None,
            }
            .to_line(),
        );
        lines
    }

    /// Emit the availability state (and the reason) only when it changes, so a stable machine does not
    /// repeat itself every 5 seconds.
    fn update_availability(&mut self, lines: &mut Vec<String>) -> Availability {
        let availability = self.source.availability();
        if self.last_availability.as_ref() == Some(&availability) {
            return availability;
        }
        self.last_availability = Some(availability.clone());
        match &availability {
            Availability::Available => lines.push(availability_state(&availability)),
            Availability::Unavailable(reason) => {
                lines.push(availability_state(&availability));
                lines.push(protocol::diagnostic("warn", "uia-unavailable", reason));
            }
        }
        availability
    }

    fn adapter_id(&self, application_id: &str) -> Option<&'static str> {
        self.adapters
            .iter()
            .find(|adapter| {
                adapter
                    .ids
                    .iter()
                    .any(|id| id.eq_ignore_ascii_case(application_id))
            })
            .map(|adapter| adapter.id)
    }

    fn is_protected_metadata(&self, value: Option<&str>, is_resource: bool) -> bool {
        let Some(value) = value else {
            return false;
        };
        if value.is_empty() {
            return false;
        }
        let decoded = percent_decode(value);
        if self
            .protected_paths
            .iter()
            .any(|pattern| glob_matches(pattern, value) || glob_matches(pattern, &decoded))
        {
            return true;
        }
        is_resource && looks_like_sensitive_resource(&decoded)
    }
}

fn lowercased(ids: Vec<String>) -> HashSet<String> {
    ids.into_iter().map(|id| id.to_lowercase()).collect()
}

/// Cut a field to the host's byte bound on a character boundary, so a long title cannot make the host
/// reject the line (a rejection is fatal: the manager stops the collector).
fn truncated(value: Option<String>, max_bytes: usize) -> Option<String> {
    let value = value?;
    if value.len() <= max_bytes {
        return Some(value);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    Some(value[..end].to_string())
}

fn availability_state(availability: &Availability) -> String {
    match availability {
        Availability::Available => protocol::state("running", true, None),
        Availability::Unavailable(reason) => {
            protocol::state("permission-required", false, Some(reason))
        }
    }
}

/// Glob with `*` as the only wildcard, matching the macOS collector's `globMatches`.
fn glob_matches(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let mut pattern_index = 0;
    let mut value_index = 0;
    let mut star = None;
    let mut star_value = 0;
    while value_index < value.len() {
        if pattern_index < pattern.len() && pattern[pattern_index] == value[value_index] {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == '*' {
            star = Some(pattern_index);
            pattern_index += 1;
            star_value = value_index;
        } else if let Some(star_index) = star {
            pattern_index = star_index + 1;
            star_value += 1;
            value_index = star_value;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == '*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The macOS collector's sensitive-resource marker, kept as a small predicate rather than a regex crate.
fn looks_like_sensitive_resource(value: &str) -> bool {
    let lower = value.to_lowercase();
    if lower.ends_with(".pem") || lower.ends_with(".key") {
        return true;
    }
    if lower.contains("credentials") || lower.contains("secrets") {
        return true;
    }
    lower.split(['/', '\\']).any(|segment| {
        segment == ".ssh" || segment == ".env" || segment.starts_with(".env.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{ForegroundIdentity, PlatformObservation};
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicI64, Ordering};

    const TEST_ADAPTERS: &[Adapter] = &[
        Adapter {
            id: "vscode",
            ids: &["Code.exe"],
            suppresses_window_title: false,
            focus_policy: FocusPolicy::Require,
        },
        Adapter {
            id: "terminal",
            ids: &["WindowsTerminal.exe"],
            suppresses_window_title: true,
            focus_policy: FocusPolicy::Require,
        },
        Adapter {
            id: "androidstudio",
            ids: &["AndroidStudio.exe"],
            suppresses_window_title: false,
            focus_policy: FocusPolicy::WindowOnly,
        },
    ];

    static TEST_CLOCK: AtomicI64 = AtomicI64::new(1_791_000_000_000);

    fn test_clock() -> i64 {
        TEST_CLOCK.fetch_add(1, Ordering::Relaxed)
    }

    struct FakeSource {
        availability: Availability,
        states: VecDeque<Option<PlatformObservation>>,
        /// The state `foreground()` handed to the engine; `describe()` consumes it only if the gate
        /// let the engine get that far.
        pending: Option<Option<PlatformObservation>>,
        idle: Option<u64>,
        describes: usize,
        /// The second identity candidate: a window that reports an AppUserModelID while the rules and
        /// the adapter table know its executable name, which is what Windows does for packaged apps.
        executable: Option<String>,
    }

    impl FakeSource {
        fn new(states: Vec<Option<PlatformObservation>>) -> Self {
            Self {
                availability: Availability::Available,
                states: VecDeque::from(states),
                pending: None,
                idle: Some(0),
                describes: 0,
                executable: None,
            }
        }
    }

    impl ObservationSource for FakeSource {
        fn availability(&mut self) -> Availability {
            self.availability.clone()
        }

        fn foreground(&mut self) -> Option<ForegroundIdentity> {
            if self.pending.is_none() {
                self.pending = Some(self.states.pop_front().flatten());
            }
            match self.pending.as_ref() {
                Some(Some(facts)) => Some(ForegroundIdentity {
                    pid: facts.pid,
                    window: facts.pid as isize,
                    application_id: facts.application_id.clone(),
                    application_executable: self.executable.clone(),
                    application_name: facts.application_name.clone(),
                }),
                _ => None,
            }
        }

        fn describe(&mut self, _identity: &ForegroundIdentity) -> Option<PlatformObservation> {
            self.describes += 1;
            self.pending.take().flatten()
        }

        fn idle_seconds(&mut self) -> Option<u64> {
            self.idle
        }
    }

    fn facts(application_id: &str) -> PlatformObservation {
        PlatformObservation {
            pid: 42,
            application_id: application_id.to_string(),
            application_name: Some("Visual Studio Code".to_string()),
            window_title: Some("provider.ts".to_string()),
            document: Some("file:///C:/work/provider.ts".to_string()),
            element_role: Some("Document".to_string()),
            element_state: ElementState::NotSecure,
        }
    }

    fn collector(
        states: Vec<Option<PlatformObservation>>,
    ) -> Collector<FakeSource> {
        Collector::create(
            "win-1".to_string(),
            FakeSource::new(states),
            TEST_ADAPTERS,
            test_clock,
        )
    }

    fn configure(collector: &mut Collector<FakeSource>, allowed: &[&str]) -> Vec<String> {
        collector.configure(
            1,
            Policy {
                allowed_bundle_ids: allowed.iter().map(|id| id.to_string()).collect(),
                ..Policy::default()
            },
        )
    }

    fn observations(lines: &[String]) -> Vec<&String> {
        lines
            .iter()
            .filter(|line| line.contains("\"type\":\"observation\""))
            .collect()
    }

    #[test]
    fn a_window_whose_reported_id_is_unknown_is_matched_by_its_executable_name() {
        // Windows may report an AppUserModelID for a window whose policy rules and adapter entry are the
        // executable name. The engine tries both candidates and reports the one that satisfies both
        // gates, because the host resolves the adapter from the reported id - reporting the unknown id
        // would be refused as not-an-adapter and the application would be unobservable without a trace.
        let mut collector = collector(vec![Some(facts(
            "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App",
        ))]);
        collector.source.executable = Some("WindowsTerminal.exe".to_string());
        let lines = configure(&mut collector, &["WindowsTerminal.exe"]);
        let parsed = observations(&lines);
        assert_eq!(parsed.len(), 1, "{lines:?}");
        assert!(
            parsed[0].contains("\"bundleId\":\"WindowsTerminal.exe\""),
            "{}",
            parsed[0]
        );
        assert!(parsed[0].contains("\"adapter\":\"terminal\""), "{}", parsed[0]);
    }

    #[test]
    fn protection_and_blocking_match_the_executable_candidate_too() {
        let mut protected = collector(vec![Some(facts("Some.Packaged.Id"))]);
        protected.source.executable = Some("1Password.exe".to_string());
        let lines = protected.tick();
        assert_eq!(observations(&lines).len(), 1, "{lines:?}");
        assert!(lines.iter().any(|line| line.contains("\"protected\":true")));
        assert!(lines.iter().any(|line| line.contains("\"reason\":\"protected-app\"")));
        // Identity only: no window metadata was read for it.
        assert_eq!(protected.source.describes, 0);

        let mut blocked = collector(vec![Some(facts("Some.Packaged.Id"))]);
        blocked.source.executable = Some("WindowsTerminal.exe".to_string());
        let lines = blocked.configure(
            2,
            Policy {
                allowed_bundle_ids: vec!["WindowsTerminal.exe".to_string()],
                blocked_bundle_ids: vec!["WindowsTerminal.exe".to_string()],
                ..Policy::default()
            },
        );
        assert!(observations(&lines).is_empty(), "{lines:?}");
        assert_eq!(blocked.source.describes, 0);
    }

    #[test]
    fn start_sends_hello_first_then_the_running_state() {
        let mut collector = collector(vec![]);
        let lines = collector.start();
        assert!(lines[0].contains("\"type\":\"hello\""), "{lines:?}");
        assert!(
            lines.iter().any(|line| line.contains("\"state\":\"running\"")),
            "{lines:?}"
        );
        assert!(observations(&lines).is_empty());
    }

    #[test]
    fn an_allowed_adapter_is_observed_once_and_deduplicated() {
        let mut collector = collector(vec![Some(facts("Code.exe")); 2]);
        let lines = configure(&mut collector, &["Code.exe"]);
        assert!(lines[0].contains("\"type\":\"configured\""), "{lines:?}");
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"bundleId\":\"Code.exe\""));
        assert!(observed[0].contains("\"adapter\":\"vscode\""));
        assert!(observed[0].contains("\"document\":\"file:///C:/work/provider.ts\""));

        // The same state on the next heartbeat is deduplicated rather than repeated.
        assert!(collector.tick().is_empty());
    }

    #[test]
    fn a_changed_fingerprint_produces_the_next_observation() {
        let mut changed = facts("Code.exe");
        changed.window_title = Some("other.ts".to_string());
        let mut collector = collector(vec![Some(facts("Code.exe")), Some(changed)]);
        configure(&mut collector, &["Code.exe"]);
        let lines = collector.tick();
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"seq\":2"), "{observed:?}");
        assert!(observed[0].contains("other.ts"));
    }

    #[test]
    fn policy_decides_before_anything_is_observed() {
        let mut collector = collector(vec![Some(facts("Code.exe")); 3]);
        collector.start();
        // Nothing is allowed yet: include-only means no observation.
        assert!(observations(&collector.tick()).is_empty());
        let allowed = configure(&mut collector, &["Code.exe"]);
        assert_eq!(observations(&allowed).len(), 1);
        // The same state after the policy stops allowing it is not observed.
        assert!(observations(&configure(&mut collector, &[])).is_empty());
    }

    #[test]
    fn a_blocked_application_is_not_observed_and_not_described() {
        let mut collector = collector(vec![Some(facts("Code.exe"))]);
        let lines = collector.configure(
            2,
            Policy {
                blocked_bundle_ids: vec!["Code.exe".to_string()],
                ..Policy::default()
            },
        );
        assert!(observations(&lines).is_empty(), "{lines:?}");
        // The gate precedes the read: no window metadata was even asked for.
        assert_eq!(collector.source.describes, 0);
    }

    #[test]
    fn a_protected_application_is_not_described() {
        let mut collector = collector(vec![Some(facts("1Password.exe"))]);
        let lines = collector.tick();
        assert_eq!(observations(&lines).len(), 1);
        assert_eq!(collector.source.describes, 0);
    }

    #[test]
    fn a_protected_application_is_reported_without_window_metadata() {
        let mut collector = collector(vec![Some(facts("1Password.exe")); 2]);
        let lines = collector.tick();
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"protected\":true"), "{observed:?}");
        assert!(observed[0].contains("\"reason\":\"protected-app\""));
        assert!(!observed[0].contains("provider.ts"), "window metadata leaked");
        assert!(!observed[0].contains("C:/work"), "document leaked");
        assert!(collector.tick().is_empty());
    }

    #[test]
    fn a_secure_element_withholds_the_window_but_is_still_reported() {
        let mut secure = facts("Code.exe");
        secure.element_state = ElementState::Secure;
        let mut collector = collector(vec![Some(secure)]);
        let lines = configure(&mut collector, &["Code.exe"]);
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"secure\":true"));
        assert!(observed[0].contains("\"reason\":\"secure-field\""));
        assert!(!observed[0].contains("provider.ts"));
        assert!(!observed[0].contains("C:/work"));
    }

    #[test]
    fn an_unreadable_element_fails_closed() {
        let mut unreadable = facts("Code.exe");
        unreadable.element_state = ElementState::Unreadable;
        let mut collector = collector(vec![Some(unreadable)]);
        let lines = configure(&mut collector, &["Code.exe"]);
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"reason\":\"unreadable-focused-element\""));
        assert!(!observed[0].contains("provider.ts"));
    }

    #[test]
    fn a_window_only_adapter_records_window_metadata_but_no_element() {
        let mut unqueryable = facts("AndroidStudio.exe");
        unqueryable.element_state = ElementState::Unqueryable;
        let mut collector = collector(vec![Some(unqueryable)]);
        let lines = configure(&mut collector, &["AndroidStudio.exe"]);
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"secure\":false"));
        assert!(observed[0].contains("provider.ts"));
        // The element object stays in the line (the protocol shape has it) but carries no role.
        assert!(observed[0].contains("\"role\":null"), "element fields leaked");
    }

    #[test]
    fn a_required_element_that_is_unqueryable_withholds_the_window() {
        let mut unqueryable = facts("Code.exe");
        unqueryable.element_state = ElementState::Unqueryable;
        let mut collector = collector(vec![Some(unqueryable)]);
        let lines = configure(&mut collector, &["Code.exe"]);
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"reason\":\"focused-element-unqueryable\""));
        assert!(!observed[0].contains("provider.ts"));
    }

    #[test]
    fn a_terminal_title_is_never_recorded() {
        let mut terminal = facts("WindowsTerminal.exe");
        terminal.window_title = Some("secret-project - pwsh".to_string());
        let mut collector = collector(vec![Some(terminal)]);
        let lines = configure(&mut collector, &["WindowsTerminal.exe"]);
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"title\":null"), "terminal title leaked");
        assert!(!observed[0].contains("secret-project"), "terminal title leaked");
    }

    #[test]
    fn protected_paths_withhold_the_observation() {
        let mut secret = facts("Code.exe");
        secret.document = Some("file:///C:/Users/47209/secrets/keys.txt".to_string());
        let mut collector = collector(vec![Some(secret)]);
        let lines = collector.configure(
            1,
            Policy {
                allowed_bundle_ids: vec!["Code.exe".to_string()],
                protected_path_patterns: vec!["C:/Users/47209/secrets/*".to_string()],
                ..Policy::default()
            },
        );
        assert!(observations(&lines).is_empty(), "{lines:?}");
    }

    #[test]
    fn pause_and_resume_keep_the_state_messages() {
        let mut collector = collector(vec![Some(facts("Code.exe")); 3]);
        configure(&mut collector, &["Code.exe"]);
        let paused = collector.set_paused(true);
        assert!(paused[0].contains("\"state\":\"paused\""), "{paused:?}");
        assert!(collector.tick().is_empty());
        let resumed = collector.set_paused(false);
        assert!(resumed.iter().any(|line| line.contains("\"state\":\"running\"")));
        assert_eq!(observations(&resumed).len(), 1);
    }

    #[test]
    fn an_unavailable_source_reports_why_and_observes_nothing() {
        let mut source = FakeSource::new(vec![]);
        source.availability = Availability::Unavailable("UI Automation failed".to_string());
        let mut collector = Collector::create("win-1".to_string(), source, TEST_ADAPTERS, test_clock);
        let lines = collector.start();
        assert!(
            lines
                .iter()
                .any(|line| line.contains("\"state\":\"permission-required\""))
        );
        assert!(lines.iter().any(|line| line.contains("uia-unavailable")));
        assert!(collector.tick().is_empty());
    }

    #[test]
    fn the_idle_boundary_is_part_of_the_fingerprint() {
        let mut collector = collector(vec![Some(facts("Code.exe")); 3]);
        configure(&mut collector, &["Code.exe"]);
        assert_eq!(observations(&collector.tick()).len(), 0); // same idle, deduplicated
        collector.source.idle = Some(IDLE_BOUNDARY_SECONDS + 1);
        let lines = collector.tick();
        let observed = observations(&lines);
        assert_eq!(observed.len(), 1);
        assert!(observed[0].contains("\"idleSeconds\":481"));
    }
}
