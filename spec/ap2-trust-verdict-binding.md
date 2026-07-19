# AP2 Trust-Verdict Binding v1

**Binding URI:** `https://fidacy.com/ap2/extensions/trust-verdict/v1`
**Schema:** the container is [`risk-data.schema.json`](./risk-data.schema.json); the signed claims are
[`risk-payload.schema.json`](./risk-payload.schema.json).

How a Fidacy **trust verdict** rides the [Agent Payments Protocol (AP2)](https://ap2-protocol.org):
as a neutral, independently verifiable risk signal inside the mandate's `risk_data` field, the
extension point AP2 deliberately left open for the ecosystem to fill.

## Why this binding exists

AP2 carries its Intent, Cart, and Payment Mandates as W3C Verifiable Credentials signed by the
**user's wallet or the agent's key**. Those signatures prove who authorized the flow. They do not,
and structurally cannot, carry a **neutral** judgment of the transaction, because the signer is a
party to it.

AP2 anticipated this. Its `risk_data` field is, by design, "intentionally left open-ended... we
expect different players in the industry to assess the right signals" (AP2 v0.1). The A2A extension
for AP2 states that a Cart Mandate artifact MAY include a `DataPart` whose key is `risk_data` and
whose value is implementation-defined risk signal data.

This binding fills that open extension point with a **reference implementation**: a signed verdict
from a party that meters, settles, and takes a fee on nothing, so the risk signal is neutral by
construction and verifiable by anyone without trusting the issuer.

## Where the verdict rides

Inside the AP2 mandate's `risk_data` field, as the value of a `fidacy` key:

```jsonc
{
  "risk_data": {
    "fidacy": {
      "decision": "approve",        // convenience copy, untrusted until the JWS verifies
      "score": 12,                  // convenience copy
      "vc_jws": "eyJhbGciOi...",    // the signed verdict — source of truth
      "signing_key_id": "1zoM57brjllufNTzCwI5-...",
      "payload": { /* decoded Risk Payload claims */ }
    }
  }
}
```

The container shape is defined by [`risk-data.md`](./risk-data.md). The surrounding AP2 mandate
structure is defined by AP2, not here. The verdict is session-scoped: it is about the transaction
the mandate authorizes.

## Neutrality (normative)

- AP2 mandate signatures (ECDSA P-256, per AP2) attest **authorization**: who agreed to the flow.
- The Fidacy verdict (`vc_jws`, EdDSA over JCS-canonical bytes, per
  [risk-payload.md](./risk-payload.md#how-it-is-signed)) attests **risk**: whether the transaction
  is within policy, from a neutral party.
- The two are independent siblings, not nested: a verifier resolves the AP2 mandate against its
  signer's key and the Fidacy verdict against Fidacy's JWKS, in separate steps, neither issuer
  online at verify time.
- Conformance: a verifier MUST NOT issue a risk verdict for a transaction to which it is a party
  (anyone who meters, settles, or takes a fee on it). Fidacy takes no fee, settles nothing, and
  holds no funds, so it is a non-party to the verdicts it issues. The clause applies to Fidacy too.

## Verification (normative)

`vc_jws` is the source of truth; `decision`, `score`, and `payload` are untrusted convenience hints
until it verifies.

1. Read `risk_data.fidacy.vc_jws` from the AP2 mandate.
2. Resolve the `kid` in the JWS protected header against the public JWKS at
   `https://api.fidacy.com/.well-known/jwks.json`.
3. Verify the EdDSA signature (for example with
   [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify) → `verifyRiskPayload`). `alg: none`
   and non-EdDSA algorithms MUST be rejected.
4. Act on the verified claims; if invalid or expired, discard the verdict.

## Governance note

AP2 moved to the **FIDO Alliance** for community-led governance in 2026. This binding is a public,
Apache-2.0 proposal for a neutral risk signal under AP2's open `risk_data` extension point; it adds
nothing to and changes nothing in the AP2 mandate schema, and it is fully opt-in.

## References

- AP2 specification and core concepts: https://ap2-protocol.org
- Container: [risk-data.md](./risk-data.md) · Claims: [risk-payload.md](./risk-payload.md)
- Verifier: [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify)
- Public JWKS: https://api.fidacy.com/.well-known/jwks.json
- Sibling bindings: [UCP](./ucp-trust-verdict-binding.md) · [A2A](./a2a-trust-verdict-extension.md) · sibling claim type: [Decision-Provenance](./decision-provenance-claim.md)
