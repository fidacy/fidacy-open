# Klaimee x Fidacy: the claim file

Insurance answers *who pays*. It can only answer it after someone establishes
*what actually happened, and was it authorized*. This demo runs that second
question against the real Fidacy engine.

```bash
npm i && node demo.mjs
```

## What it shows

**Act 1, underwriting.** Six consequential actions from one agent, each decided
against the mandate at the instant it happens. Five are stopped. Every deny is
mapped to one of the eight risk dimensions published on klaimee.ai:

| action | dimension | rule that fired |
|---|---|---|
| category the human never authorized | scope violation | `category_not_allowed:crypto` |
| payee absent from the allowlist | unauthorized action | `payee_not_in_allowlist` |
| prompt-injected `northw1nd` vs `northwind` | adversarial manipulation | `payee_lookalike` |
| above the per-transaction ceiling | operational control failure | `per_tx_cap_exceeded:9000>5000` |
| same invoice presented twice | output integrity | `duplicate_invoice` |

A denied action is a loss that never became a claim. For an underwriter that is
loss frequency observed per agent, continuously, instead of declared once in an
application form.

**Act 2, the claim.** The one allowed payment is later disputed. The adjudicator
verifies the authorization with **stock `node:crypto`** and nothing else: the
Ed25519 grant against the public key, and the hash-chained audit for integrity.
No call to Fidacy, no request for the insured's logs, no trust in either party.

## Why the issuer has to be a non-party

The same structural rule Fidacy argues for payment rails applies here. A party
that meters, settles, or takes a fee on a transaction cannot credibly judge it;
an insurer that produces the evidence it underwrites against is in that same
position. The evidence has to come from someone with nothing at stake in the
outcome. Fidacy holds no funds, takes no fee on the transaction, and carries no
liability, so the artifact survives adversarial reading.

## Honesty contract

- The Fidacy side is the **real shipped engine**: `DevFidacyCore` from the
  published [`@fidacy/mcp`](https://www.npmjs.com/package/@fidacy/mcp) on npm.
  Real Ed25519 grants, real hash-chained audit, real deny rules. Nothing mocked.
- The Klaimee side is **only our mapping** of the eight risk dimensions published
  on klaimee.ai. It is not their product and asserts nothing about how they
  underwrite.
- This dev core signs with a per-session key. Production uses a stable key and
  anchors audit checkpoints into Bitcoin transactions, so the record stays
  verifiable if Fidacy disappears.
- Two of the eight dimensions (data exfiltration, model drift) are not decided by
  the firewall. Model drift is measured separately and publicly in
  [Model Watch](https://fidacy.com/pulse/model-watch); data exfiltration is out
  of scope and stated as such rather than papered over.
