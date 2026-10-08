# Website and workspace consent (Issue #96)

Computer History is local-first and stores activity metadata in local SQLite. This does not justify collecting metadata outside the user's chosen sources.

## Settings → Data & privacy

**Allowed websites** and **Allowed editor workspaces** each support three modes:

- **All:** Retain the existing app-level allow policy, to avoid silently changing legacy capture on upgrade.
- **Only selected:** Record activity only from the explicitly allowed browser origins or vouched editor workspace roots. An empty selected list records nothing.
- **None:** Do not record activity of that kind.

The app itself must still be allowed. Built-in protection and explicit resource deny/protect take precedence, even for listed origins and roots. Website rules cannot affect editor or ordinary file capture, nor vice versa.

Browser allow entries are exact HTTP(S) origins, such as https://github.com. Scheme, host and port matter; a subdomain or lookalike host is not allowed. Paths, query strings, credentials and fragments are rejected in Settings. The Browser Companion still strips queries/fragments before the Host sees them.

Editor allow entries are absolute project roots. Windows paths are normalised case-insensitively; POSIX paths remain case-sensitive. When selected mode is enabled, only a paired Editor Companion can vouch for an allowed root. Unvouched native Accessibility/UIA/AT-SPI editor observations fail closed, even if they appear to name a file in an allowed folder. Pair an editor companion to capture in strict mode.

## Upgrade and audit contract

New consent is stored in the existing versioned policy_rules table, as exact-match resource allow rules with a distinct @dch-consent/v1/ namespace and type-specific markers. No schema migration is necessary. Legacy untyped resource allow entries are not automatically reinterpreted as grants. Existing app-only policies retain All as their initial mode.

Changes are submitted through the authenticated policy API, replace only that kind's consent markers, preserve built-in and unrelated rules, and take effect on new observations. Redaction preview uses the same decision predicates. **Changing a rule never deletes existing history.** Old observations must be removed separately in Data → Delete history.

These recording permissions are entirely separate from remote-model summary consent or DSH Agent continuation context.

Verification: tests/unit/resource-consent.spec.ts and integration Companion tests cover allowlist enforcement, native bypass prevention, protect/deny precedence, Windows root normalization, API rule validation, and legacy compatibility.
