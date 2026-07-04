# Conformance corpus

"Anyone can verify" should be a testable claim, not a slogan. This corpus makes
it one: a fixed set of signed fixtures plus expected outcomes that any
implementation of the Fidacy verdict check, in any language, can run offline.

## What is here

- `fixtures.json`: an embedded public JWKS (throwaway key, never used in
  production), a pinned clock instant, and 8 cases covering the failure matrix:
  valid approve, valid deny, tampered payload, unknown kid, wrong issuer,
  expired, missing required claim, not a JWS at all.
- `run.mjs`: the reference runner. From `packages/verify`:
  `node conformance/run.mjs` prints PASS/FAIL per case and exits non-zero on
  any mismatch.
- `generate.mjs`: regenerates every fixture with a fresh throwaway key, so the
  contract is (fixtures, expectations), never a historical byte string.

## Proving a port compatible

Consume `fixtures.json`. For each case, verify `jws` against the embedded
`jwks` with the clock pinned to `now` and the issuer prefix from
`issuerPrefix`. Your implementation is conformant when every case reproduces
its `expect`: `{ valid: true, decision }` or `{ valid: false, code }` with the
same error code taxonomy (`invalid_signature`, `unknown_kid`, `wrong_issuer`,
`expired`, `malformed`).

No network, no account, no Fidacy involvement: that is the point.
