# @fidacy/crabtrap

Works with [Brex CrabTrap](https://github.com/brexhq/crabtrap) — add a neutral, portable, signed verdict on top of your local audit.

CrabTrap makes a local allow/deny/timeout decision for every agent request and writes it to an audit log. This adapter observes those decisions and, for each one, asks Fidacy for a **signed, portable verdict** — an EdDSA-signed JWS anyone can verify against Fidacy's public JWKS, without trusting you and without a Fidacy account. The local audit stays yours; the verdict travels.

> **Observe mode is non-blocking.** The adapter never sits in the request path and never alters CrabTrap's decision. If Fidacy is slow or unreachable, the CrabTrap flow is untouched and the adapter falls back to a `review` floor for its own record. A single bad event never throws out of the loop.

This is an **independent complement** to CrabTrap (which is MIT-licensed). It is **not endorsed by, official to, or partnered with Brex**, and it does **not** claim Brex uses Fidacy. "CrabTrap" and "Brex" are referenced only to describe interoperability.

## Install

```bash
npm i @fidacy/crabtrap
```

## How it maps (risk-zero)

The CrabTrap decision is mapped to a Fidacy [`custom` action](https://github.com/fidacy/fidacy-open) and sent to the live `/v1/assess`. **Fidacy issues its own signed verdict**; the CrabTrap local decision/reason/policy ride along as context in the mandate's `upstream` block. No engine change, no special endpoint.

| CrabTrap audit entry        | Fidacy `custom` mandate                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `user_id`                   | `actor_agent` (and `principal`, unless you override)              |
| `method` + `url` + headers  | `payload_hash` = sha-256 of canonical `{method,url,headers}`      |
| `method` + url host         | `scope` (`"POST api.vendor.com"`)                                  |
| `timestamp`                 | `requested_at` (epoch seconds)                                    |
| `decision`/`llm_reason`/`llm_policy_id`/`approved_by` | `upstream.{local_decision,local_reason,policy_id,approved_by}` |

Sensitive request headers (`authorization`, `cookie`, `x-api-key`, anything matching `token|secret|api-key|bearer|auth|session`) are stripped to `[REDACTED]` before anything leaves the process — defence in depth, since CrabTrap already redacts over SSE.

## Use it

`observe()` is source-agnostic and takes its Fidacy assessor as a dependency, so the same core runs in tests, offline, and live.

```ts
import { observe, sseSource, sdkAssessor } from '@fidacy/crabtrap';

await observe({
  // Ingest: CrabTrap's SSE audit stream (SSRF-guarded). Swap for any
  // AsyncIterable<CrabTrapDecision> — Postgres, a REST poll, a test stub.
  source: sseSource({ url: 'https://crabtrap.internal/admin/events', token: process.env.CRABTRAP_TOKEN }),
  // Verdict source: the live Fidacy API (your org-scoped key).
  assessor: sdkAssessor({ apiKey: process.env.FIDACY_API_KEY! }),
  attachHeader: true,
  onVerdict: (record) => {
    // record.crabtrap — the local decision
    // record.fidacy   — the signed Fidacy verdict (or null on failure)
    // record.header   — { 'X-Fidacy-Verdict': '<jws>' } when attachHeader is on
    // record.fallback — 'review' when the assessment failed (record.fidacy === null)
  },
});
```

### Verify it yourself

A verdict is only worth something if you can check it. Each verdict is an EdDSA-signed JWS; verify it with [`@fidacy/verify`](../verify):

```ts
import { verifyVerdict, assertKidInTrustList } from '@fidacy/crabtrap';

const { claims, kid } = await verifyVerdict(record.fidacy.riskPayloadJws);
await assertKidInTrustList(kid); // the signing key is published in Fidacy's signed trust list
console.log(claims.decision, claims.score); // 'approve' | 'review' | 'deny', 0..100
```

EdDSA (Ed25519) is the only accepted algorithm — a forged `alg: none`/`HS256` token is rejected before verification.

## API

| export | purpose |
| --- | --- |
| `observe(deps)` | orchestrate normalize → map → assess → verify → emit; non-blocking, fail-safe |
| `sseSource(opts)` | the CrabTrap `/admin/events` SSE ingest (SSRF-guarded) → `AsyncIterable<CrabTrapDecision>` |
| `sdkAssessor(opts)` | the live `FidacyAssessor` backed by `@fidacy/sdk` |
| `normalizeAuditEntry(raw)` | raw SSE `AuditEntry` → `CrabTrapDecision` (redacts, lowercases, derives reason) |
| `toCustomMandate(d, opts)` | `CrabTrapDecision` → Fidacy `custom` mandate |
| `attachVerdict(d, verdict)` | build the Verdict Container record (+ optional `X-Fidacy-Verdict` header) |
| `verifyVerdict(jws, opts)` | verify a signed verdict (wraps `@fidacy/verify`) |
| `assertKidInTrustList(kid, opts)` | assert the signing key is in Fidacy's signed trust list (SSRF-guarded) |

## Security

- **EdDSA-only**, every signature. Algorithm-confusion is rejected.
- **SSRF-guarded** on every new fetch (SSE connect + trust-list fetch): loopback, link-local (`169.254.169.254`), and RFC1918 hosts are blocked unless you opt in with `allowInsecureHosts` (local dev / the example).
- **Org-scoped**: the assess key is your organization's; verdicts are about *your* agents.
- **No private keys here.** This package only *calls* `/v1/assess` and *verifies* public JWS. Fidacy's signing key never leaves the engine.

## Example

See [`examples/crabtrap-observe`](../../examples/crabtrap-observe) — runs end-to-end offline (a DEMO signer, no creds) and prints `signing_valid: true`; set `FIDACY_API_KEY` to run it live.

## License

Apache-2.0. Part of [fidacy-open](https://github.com/fidacy/fidacy-open).
