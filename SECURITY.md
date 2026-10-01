# Security and Privacy

DSH Computer History handles highly sensitive contextual metadata about local computer activity. Privacy controls are part of the core architecture.

## Phase 1 collection boundary

The collector must not capture screenshots or screen recordings; microphone or system audio; raw keyboard input or mouse coordinates; clipboard data; Accessibility text values or selected text; terminal buffer/output or shell history; source-file bodies; or browser page bodies.

Secure fields are a hard boundary and cannot be enabled by configuration.

## Local data

Phase 1 stores observations and episodes locally. The default design uses short-lived observations and longer-lived deterministic episodes. Deletion of source evidence must also delete or rebuild derived data.

## Sensitive applications and resources

Protected applications are excluded before AX observation is attached. Sensitive path rules fail closed. Browser private/incognito resource capture is not considered safe until a browser companion provides a reliable privacy boundary.

## Reporting

Do not include private history databases, capture logs, file paths containing secrets, or credentials in public bug reports. Security-sensitive findings should be reported privately to the repository maintainer until a public policy/contact is established.
