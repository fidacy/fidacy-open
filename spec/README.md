# fidacy-spec

The open specification for Fidacy's signed payloads and protocol containers. Every format here is
**neutral and independently verifiable**: the source of truth is always a compact **EdDSA JWS**,
checkable against the public JWKS (`https://api.fidacy.com/.well-known/jwks.json`) with the
open-source [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify) — no trust in Fidacy
required.

## Formats

| Format | Spec | Schema |
| --- | --- | --- |
| **Risk Payload** — the signed verdict claims (`issuer/subject/decision/score/model_version/assessed_at`) | [risk-payload.md](./risk-payload.md) | [risk-payload.schema.json](./risk-payload.schema.json) |
| **risk_data container** — how the verdict rides AP2 (`{ fidacy: { … vc_jws … } }`) | [risk-data.md](./risk-data.md) | [risk-data.schema.json](./risk-data.schema.json) |
| **A2A Task.metadata block** — how the verdict rides plain A2A (`{ fidacy_assessment: … }`) | [a2a-metadata.md](./a2a-metadata.md) | [a2a-metadata.schema.json](./a2a-metadata.schema.json) |
| **A2A Trust-Verdict Extension v1** — the declarable A2A extension that names the above and pins where the verdict rides | [a2a-trust-verdict-extension.md](./a2a-trust-verdict-extension.md) | [a2a-trust-verdict-extension.schema.json](./a2a-trust-verdict-extension.schema.json) |
| **KYA** — Know-Your-Agent identity inputs | [kya.md](./kya.md) | [kya.schema.json](./kya.schema.json) |

Versioning policy: [VERSIONING.md](./VERSIONING.md).

## A2A Trust-Verdict Extension

**Extension URI:** `https://fidacy.com/a2a/extensions/trust-verdict/v1`

A formal [A2A](https://a2a-protocol.org) extension: an agent declares in its Agent Card that it
carries a Fidacy trust verdict, and clients opt in. The verdict travels in the existing `risk_data`
(AP2) or `Task.metadata` (A2A) containers; the signed `vc_jws` is authoritative. See
[a2a-trust-verdict-extension.md](./a2a-trust-verdict-extension.md) and the
[examples](./examples).

## Examples

- [examples/a2a-agent-card-with-extension.json](./examples/a2a-agent-card-with-extension.json) — an Agent Card declaring the extension.
- [examples/a2a-cart-mandate-with-risk_data.json](./examples/a2a-cart-mandate-with-risk_data.json) — an AP2 CartMandate carrying the verdict in `risk_data`.
