# Security and Privacy

DSH Computer History handles highly sensitive contextual metadata about local computer activity. Privacy controls are part of the core architecture.

## Phase 1 collection boundary

The collector must not capture screenshots or screen recordings; microphone or system audio; raw keyboard input or mouse coordinates; clipboard data; Accessibility text values or selected text; terminal buffer/output or shell history; source-file bodies; or browser page bodies.

Secure fields are a hard boundary and cannot be enabled by configuration.

## Local data

Phase 1 stores observations and episodes locally. Raw observations expire 24 hours after the observed activity; deterministic Episodes may remain for 30 days. Raw TTL expiry is evidence compaction and does not, by itself, delete a still-live Episode.

User-requested Forget/Delete is stronger than TTL compaction. When complete raw provenance remains, affected Episodes are deterministically rebuilt from the remaining evidence. When raw expiry has made provenance incomplete, the affected derived Episode is deleted in full rather than retaining a summary that may contain forgotten evidence. Short-lived deletion tombstones reject delayed pre-deletion observations while allowing genuinely new activity after the request.

SQLite uses restrictive filesystem permissions and `secure_delete`. After successful logical deletion, WAL checkpoint/truncation and VACUUM are best-effort cleanup only. This project does not claim forensic erasure; protection against recovered disk blocks depends on full-disk encryption such as FileVault and the underlying platform/storage guarantees.

## Sensitive applications and resources

Protected applications are excluded before AX observation is attached. Sensitive path rules fail closed. Browser private/incognito resource capture is not considered safe until a browser companion provides a reliable privacy boundary.

## Process and distribution boundary

Only one DSH Host may own ambient capture for a Computer History data directory at a time. Other Hosts may inspect or delete history but cannot run another collector or mutate capture policy while an owner is active. If a pause transition cannot be acknowledged by the native helper, the Host fails closed by stopping the helper rather than assuming capture paused.

The Phase 1 build produces and verifies a universal arm64/x86_64 helper with a stable code-signing identifier. Local/ad-hoc signing and `codesign --verify` are alpha build gates, not a claim that the helper has completed a production Apple Developer ID, hardened-runtime, notarization, and Desktop distribution pipeline.

## Reporting

Do not include private history databases, capture logs, file paths containing secrets, or credentials in public bug reports. Security-sensitive findings should be reported privately to the repository maintainer until a public policy/contact is established.
