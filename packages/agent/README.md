# @fidacy/agent

A universal Fidacy **trust guard** for any AI agent runtime.

Give it an agent ACTION (who is acting, on whose behalf, and what the action is); it asks Fidacy for a cryptographically signed verdict (`approve` / `review` / `deny`) and verifies that signature against Fidacy's public JWKS before handing it back. Anyone can re-check the verdict later with [`@fidacy/verify`](../verify), without trusting you and without a Fidacy account. The verdict travels.

It is framework-agnostic: the action is structurally typed, hashing uses Web Crypto (Node 18+, browser, edge), and the only runtime dependency is `@fidacy/sdk`. The API key is held by the SDK client and is never logged or folded into a verdict.

## Three surfaces

| import | for |
| --- | --- |
| `@fidacy/agent` | the universal guard: `FidacyGuard.check()` / `FidacyGuard.guard()` for any agent (Claude Code, LangChain, your own loop) |
| `@fidacy/agent/openclaw` | a thin adapter for [OpenClaw](https://github.com/openagentplatform) tool executions: `createOpenClawGuard().beforeAction()` |
| `@fidacy/agent/hermes` | a thin adapter for Hermes Agent (Nous Research) autonomous L402 / Lightning payments: `createHermesGuard().beforePayment()` |

## Install

```bash
npm i @fidacy/agent
```

## Quickstart

```ts
import { FidacyGuard } from '@fidacy/agent';

const guard = new FidacyGuard({ apiKey: process.env.FIDACY_API_KEY! });

const verdict = await guard.check({
  agent: 'did:web:acme.com#agent-1',     // the agent acting        -> actor_agent
  principal: 'org_acme',                 // on whose behalf         -> principal
  type: 'tool',
  payload: { tool: 'send_email', args: { to: 'x@y.com' } },
});

if (!verdict.allowed) throw new Error('blocked: ' + verdict.reasons.join(', '));
```

Prefer a one-call gate? `guard.guard(action, proceed)` runs `proceed` only on `approve`, throws `FidacyDenied` on `deny`, and throws `FidacyReview` on `review` (pass `{ onReview: 'allow' }` to let `review` through).

## The universal mapping

Every action reduces to the engine's `custom` mandate: `actor_agent = agent`, `principal = principal`, and `payload_hash = "sha256:" + sha256hex(canonicalJSON({ type, payload, meta }))` (or your precomputed `payloadHash`). Optional `scope`, `cnf` (RFC 7800 key-binding), and `iss` ride along when set. That single mapping is what the OpenClaw and Hermes adapters both produce.

## Verify it yourself

A verdict is only worth something if you can check it. Each `verdict.riskPayloadJws` is an EdDSA-signed JWS; verify it independently with [`@fidacy/verify`](../verify):

```ts
import { verifyRiskPayload } from '@fidacy/sdk'; // re-exported from @fidacy/verify

const { claims } = await verifyRiskPayload(verdict.riskPayloadJws);
console.log(claims.decision, claims.score); // 'approve' | 'review' | 'deny', 0..100
```

EdDSA (Ed25519) is the only accepted algorithm: a forged `alg: none` / `HS256` token is rejected before verification. `FidacyGuard` runs this verification for you by default and reports `verdict.verified`.

## Examples

- [`examples/claude-code`](../../examples/claude-code) — a Claude Code `PreToolUse` hook that gates every tool call on a signed Fidacy verdict (the universal connector).
- [`examples/openclaw`](../../examples/openclaw) — `createOpenClawGuard().beforeAction()` around a sample OpenClaw action.
- [`examples/hermes`](../../examples/hermes) — `createHermesGuard().beforePayment()` around a sample L402 payment.

## License

Apache-2.0. Part of [fidacy-open](https://github.com/fidacy/fidacy-open).
