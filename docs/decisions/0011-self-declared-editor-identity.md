# ADR 0011: An editor companion declares its own identity

Status: Accepted
Date: 2026-10-03
Accepted by: project owner ("放开吧直接" - extend to other editors, let the
extension declare what it is)

## Context

ADR 0009 gave the editor companion its own payload shape, and the first
implementation hardcoded VS Code's bundle id in the Host: the Host decided which
application a companion observation belonged to. That works for one editor and
does not extend - Cursor, Windsurf and JetBrains each speak for a different
application, and the Host cannot tell them apart from the wire.

The alternative was a fixed list in the Host (one entry per supported editor).
The owner chose the general path: **the extension declares its identity**.

## Decision

**An editor payload may carry `app: { bundleId, name }`.** The Host validates the
shape (non-empty, no whitespace, bounded length, a reverse-DNS-looking bundle id)
and then treats it as a **claim**, not as an observation the operating system
made. Three consequences follow, and they are the whole of this ADR:

1. **The claim is recorded as a claim.** The observation keeps
   `source.provider === 'companion'`, and the panel and the audit say the
   application was *declared by a companion* rather than seen by Accessibility.
   An audit that cannot tell those apart is not an audit.
2. **The allow-list still decides.** A declared bundle id goes through the same
   `policyAllows` check as any other observation. An extension claiming an
   application the user has not allowed stores nothing - so "declare yourself"
   does not become "declare yourself into the store".
3. **Protected applications stay protected.** A claim naming a bundle id in the
   built-in protected set (password managers, Keychain) is dropped like any other
   observation from those applications. Declaring an identity cannot unlock one.

The [payload shape](0009-editor-companion-boundary.md) keeps its other
properties: no field for document text, selections or file contents, unknown
fields refused, and no request built at all without a pairing token.

## Why this is acceptable

The companion is already trusted to send observations: it is a paired, loopback,
token-authenticated channel that the user installed deliberately. Choosing which
application to attribute its observations to adds attribution power, not content
power - it cannot send more than the shape allows, and it cannot make the Host
store something the policy refuses. What it *can* do is misattribute; that is why
the claim is labelled as one, and why the redaction preview and the audit show it.

## Consequences

- One extension serves VS Code, Cursor and Windsurf: they are the same extension
  host, and `vscode.env.appName` / `appHost` name the product. JetBrains is a
  different platform and a different plugin, but it speaks the same wire format.
- The Host no longer needs a per-editor list, so a new editor needs no Host
  release - only an extension that speaks the protocol, which is the point.
- `docs/editor-companion.md` gains the identity field, and the wire format is
  documented well enough that a JetBrains client can be written from it.
