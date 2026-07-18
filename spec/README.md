# fidacy-spec

The open specification for Fidacy's signed payloads and protocol containers. Every format here is
**neutral and independently verifiable**: the source of truth is always a compact **EdDSA JWS**,
checkable against the public JWKS (`https://api.fidacy.com/.well-known/jwks.json`) with the
open-source [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify), no trust in Fidacy
required.

## Formats

| Format | Spec | Schema |
| --- | --- | --- |
| **Risk Payload**, the signed verdict claims (`issuer/subject/decision/score/model_version/assessed_at`) | [risk-payload.md](./risk-payload.md) | [risk-payload.schema.json](./risk-payload.schema.json) |
| **risk_data container**, how the verdict rides AP2 (`{ fidacy: { … vc_jws … } }`) | [risk-data.md](./risk-data.md) | [risk-data.schema.json](./risk-data.schema.json) |
| **A2A Task.metadata block**, how the verdict rides plain A2A (`{ fidacy_assessment: … }`) | [a2a-metadata.md](./a2a-metadata.md) | [a2a-metadata.schema.json](./a2a-metadata.schema.json) |
| **A2A Trust-Verdict Extension v1**, the declarable A2A extension that names the above and pins where the verdict rides | [a2a-trust-verdict-extension.md](./a2a-trust-verdict-extension.md) | [a2a-trust-verdict-extension.schema.json](./a2a-trust-verdict-extension.schema.json) |
| **UCP Trust-Verdict Binding v1**, how the verdict rides UCP as a `com.fidacy.trust_verdict` signal | [ucp-trust-verdict-binding.md](./ucp-trust-verdict-binding.md) | [ucp-trust-verdict-signal.schema.json](./ucp-trust-verdict-signal.schema.json) |
| **AP2 Trust-Verdict Binding v1**, the neutral reference for AP2's open `risk_data` extension point | [ap2-trust-verdict-binding.md](./ap2-trust-verdict-binding.md) | [risk-data.schema.json](./risk-data.schema.json) |
| **KYA**, Know-Your-Agent identity inputs | [kya.md](./kya.md) | [kya.schema.json](./kya.schema.json) |

Versioning policy: [VERSIONING.md](./VERSIONING.md).

## A2A Trust-Verdict Extension

**Extension URI:** `https://fidacy.com/a2a/extensions/trust-verdict/v1`

A formal [A2A](https://a2a-protocol.org) extension: an agent declares in its Agent Card that it
carries a Fidacy trust verdict, and clients opt in. The verdict travels in the existing `risk_data`
(AP2) or `Task.metadata` (A2A) containers; the signed `vc_jws` is authoritative. See
[a2a-trust-verdict-extension.md](./a2a-trust-verdict-extension.md) and the
[examples](./examples).

## UCP Trust-Verdict Binding

**Binding URI:** `https://fidacy.com/ucp/extensions/trust-verdict/v1`

How the verdict rides [UCP](https://ucp.dev): as a `com.fidacy.trust_verdict` **signal**, the
mechanism UCP defines for independently verifiable third-party attestations. The signed `jws` is
authoritative. Fidacy does not publish a `/.well-known/ucp` profile (that is for businesses and
platforms); key discovery is the `provider_jwks` inline in the signal. See
[ucp-trust-verdict-binding.md](./ucp-trust-verdict-binding.md).

## AP2 Trust-Verdict Binding

**Binding URI:** `https://fidacy.com/ap2/extensions/trust-verdict/v1`

How the verdict rides [AP2](https://ap2-protocol.org): as a neutral risk signal inside the mandate's
`risk_data` field, the extension point AP2 deliberately left open for the ecosystem to fill. AP2
mandates prove authorization (signed by the user or agent, a party); the Fidacy verdict in
`risk_data` adds the neutral, independently verifiable risk judgment. AP2 moved to the FIDO Alliance
for governance in 2026. See [ap2-trust-verdict-binding.md](./ap2-trust-verdict-binding.md).

## Examples

- [examples/a2a-agent-card-with-extension.json](./examples/a2a-agent-card-with-extension.json), an Agent Card declaring the extension.
- [examples/a2a-cart-mandate-with-risk_data.json](./examples/a2a-cart-mandate-with-risk_data.json), an AP2 CartMandate carrying the verdict in `risk_data`.
- [examples/ucp-checkout-with-trust-verdict.json](./examples/ucp-checkout-with-trust-verdict.json), a UCP checkout carrying the verdict in `signals`.
