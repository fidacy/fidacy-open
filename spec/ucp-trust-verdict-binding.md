# Fidacy Trust-Verdict Binding (UCP) v1

**Binding URI:** `https://fidacy.com/ucp/extensions/trust-verdict/v1`
**Signal schema:** [`ucp-trust-verdict-signal.schema.json`](./ucp-trust-verdict-signal.schema.json)

How a **Fidacy trust verdict** rides the [Universal Commerce Protocol](https://ucp.dev) (UCP). The
verdict is a signed `approve` / `review` / `deny` decision that any party verifies independently,
without trusting Fidacy. This binding does not invent a new container: the verdict travels in UCP's
own **signals** mechanism, and the signed EdDSA JWS is the source of truth.

## Where the verdict rides: a UCP signal

UCP carries platform-provided environment data in a checkout's **`signals`** object. The official
[signals schema](https://ucp.dev/schemas/shopping/types/signals.json) defines signals as values that
"MUST NOT be buyer-asserted claims" and are instead "based on direct observation or **independently
verifiable third-party attestations**", keyed by **reverse-domain** identifiers. A Fidacy verdict is
exactly such an attestation, so it rides under the reverse-domain key:

```
com.fidacy.trust_verdict
```

The value placed there is the Fidacy signal object (schema:
[`ucp-trust-verdict-signal.schema.json`](./ucp-trust-verdict-signal.schema.json)):

```json
{
  "format": "application/vc+jws",
  "jws": "<compact EdDSA JWS, the signed verdict>",
  "kid": "<signing key id>",
  "provider_jwks": "https://api.fidacy.com/.well-known/jwks.json",
  "payload": { "decision": "approve", "score": 12, "...": "readable outcome" }
}
```

`jws` is the source of truth: a compact **EdDSA** JWS, `typ application/vc+jws`, issued by
`did:web:fidacy.com#<kid>`. `payload` is a convenience copy; a recipient MUST verify the JWS before
acting on it.

## Advisory action (the merchant owns checkout)

Fidacy is a third-party trust layer, not a UCP business or platform. It does not own the checkout
`status`. Alongside the signal, the engine returns an advisory `recommended_action` the merchant maps
onto its own checkout state:

| `decision` | `recommended_action` | Merchant reading                         |
| ---------- | -------------------- | ---------------------------------------- |
| `approve`  | `proceed`            | continue the checkout                    |
| `review`   | `step_up`            | escalate (UCP `requires_escalation`)     |
| `deny`     | `decline`            | do not proceed                           |

The merchant owns the final UCP checkout status; the verdict is advisory and independently verifiable.

## Verification (normative)

The convenience fields are untrusted hints until the JWS is verified. A recipient MUST:

1. Read `jws` from the `com.fidacy.trust_verdict` signal.
2. Fetch the public JWKS (`provider_jwks`), or confirm the active key via the signed
   [trust list](https://api.fidacy.com/.well-known/fidacy-trust-list.json).
3. Verify the **EdDSA** signature (for example with
   [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify)). `alg: none` and non-EdDSA
   algorithms MUST be rejected.
4. If valid, act on the verified claims; if invalid or expired, discard the verdict.

The verified claims are the [Risk Payload](./risk-payload.md): `issuer / subject / decision / score /
model_version / assessed_at`, plus opaque advisory `signals`.

**Signing input.** The JWS payload is the claims serialized with
[RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) canonical JSON, UTF-8 encoded, `typ`
`application/vc+jws`. A verifier verifies the exact payload bytes in the JWS and does not
re-canonicalize; JCS is what makes the signing input deterministic across implementations. See
[Risk Payload → How it is signed](./risk-payload.md#how-it-is-signed) for the byte-level detail. This
is the natural point of alignment with a shared attestation envelope (UCP #534).

## What this binding deliberately does NOT do

Grounded against the live UCP spec (`ucp.dev`, release 2026-04-08):

- It does **not** publish a `/.well-known/ucp` profile. That document is hosted by a **business** or a
  **platform** (and uses EC signing keys); Fidacy is neither. Key discovery is the `provider_jwks`
  inline in the signal, served from the public JWKS (CORS-open).
- It does **not** declare a UCP capability or redefine the checkout schema. The verdict is a signal
  contributed to the existing `signals` namespace, nothing more.

## Honesty note

This binding documents behavior the Fidacy engine already ships: the UCP adapter emits the verdict as
the `com.fidacy.trust_verdict` signal today, and the JWS is verifiable against the public JWKS with the
open-source verifier. The signal conforms to UCP's own signals schema. Examples here are illustrative;
their JWS strings are samples, not live signatures.

## Sibling claim types and bindings

- [AP2 binding](./ap2-trust-verdict-binding.md) · [A2A extension](./a2a-trust-verdict-extension.md), the same risk verdict riding other protocols.
- [Decision-Provenance Claim Type](./decision-provenance-claim.md) (`com.fidacy.decision_provenance`), the sibling signal answering the after-the-fact question: proof a decision existed as-is at a moment, Bitcoin-anchored.
