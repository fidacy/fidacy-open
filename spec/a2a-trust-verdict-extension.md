# Fidacy Trust-Verdict Extension (A2A) v1

**Extension URI:** `https://fidacy.com/a2a/extensions/trust-verdict/v1`
**Declaration schema:** [`a2a-trust-verdict-extension.schema.json`](./a2a-trust-verdict-extension.schema.json)

A formal [A2A](https://a2a-protocol.org) extension that lets an agent declare it carries a
**Fidacy trust verdict** — a signed `approve` / `review` / `deny` decision that any party can verify
independently, without trusting Fidacy. The verdict is the same signed
[Risk Payload](./risk-payload.md) the Fidacy engine already produces; this extension gives that
behavior a **declarable, named identity** in the A2A ecosystem and pins where the verdict rides.

This extension does **not** invent a new verdict format. The verdict travels in Fidacy's existing,
already-published containers (below), whose source of truth is a compact **EdDSA JWS** (`vc_jws`).

## What the extension adds

A2A agents advertise capabilities in their **Agent Card** via `AgentCapabilities.extensions[]`, each
an `AgentExtension` with a unique URI. This extension defines that declaration for trust verdicts,
mirroring how the `x402` (settlement) and `AP2` (authorization) extensions are declared. Declaring it
means: *“responses from this agent may carry a Fidacy trust verdict; here is how to find and verify
it.”* The extension is **optional** (`required: false`) and **opt-in** by the client.

## Agent Card declaration

Place this object in `AgentCapabilities.extensions[]`
(see [`examples/a2a-agent-card-with-extension.json`](./examples/a2a-agent-card-with-extension.json)):

```json
{
  "uri": "https://fidacy.com/a2a/extensions/trust-verdict/v1",
  "description": "Carries a Fidacy trust verdict (approve/review/deny) as a signed, independently verifiable credential.",
  "required": false,
  "params": {
    "issuer": "did:web:fidacy.com",
    "jwks_uri": "https://api.fidacy.com/.well-known/jwks.json",
    "trust_list_uri": "https://api.fidacy.com/.well-known/fidacy-trust-list.json",
    "verify_package": "@fidacy/verify"
  }
}
```

| Param            | Required | Meaning                                                                       |
| ---------------- | -------- | ----------------------------------------------------------------------------- |
| `issuer`         | yes      | Fidacy's `did:web` identity. The signing key id (`kid`) appears in the payload's `issuer` claim (`did:web:fidacy.com#<kid>`). |
| `jwks_uri`       | yes      | Public JWKS where the signing key is published.                               |
| `trust_list_uri` | no       | Signed registry of currently active key ids.                                  |
| `verify_package` | no       | The open-source verifier (`@fidacy/verify`).                                  |

## Where the verdict rides (two transports)

The verdict is carried in Fidacy's existing containers — this extension does not change their shape:

- **AP2 flows (preferred):** inside the Payment/Cart Mandate's **`risk_data`** field (the
  "implementation-defined" risk slot reserved by the AP2-over-A2A extension), as
  `{ "fidacy": { … } }`. Schema: [`risk-data.schema.json`](./risk-data.schema.json). Example:
  [`examples/a2a-cart-mandate-with-risk_data.json`](./examples/a2a-cart-mandate-with-risk_data.json).
- **Plain A2A flows (no AP2):** in **`Task.metadata`** as `{ "fidacy_assessment": { … } }`.
  Schema: [`a2a-metadata.schema.json`](./a2a-metadata.schema.json). The decision also maps to an
  official A2A Task state (`approve → WORKING`, `review → AUTH_REQUIRED`, `deny → REJECTED`).

Both containers carry the signed verdict. In `risk_data` the JWS field is `vc_jws` with
`signing_key_id`; in `Task.metadata` the JWS lives inside the opaque assessment outcome. Either way,
the **signed JWS is the authoritative value**.

## Source of truth and verification (normative)

The convenience fields (`decision`, `score`, …) are **untrusted hints** until the JWS is verified. A
recipient **MUST**:

1. Read the compact JWS (`vc_jws`) from the container.
2. Fetch the public JWKS (`jwks_uri`) — or confirm the active key via `trust_list_uri`.
3. Verify the **EdDSA** signature (e.g. [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify)
   → `verifyRiskPayload`). The JWS `typ` is `application/vc+jws`; `alg` is pinned to `EdDSA`
   (`alg: none` and non-EdDSA algorithms **MUST** be rejected).
4. If valid, act on the verified claims; if invalid or expired, discard the verdict as untrusted.

No trust in Fidacy is required — the cryptography is checked directly. The verified claims are the
[Risk Payload](./risk-payload.md): `issuer / subject / decision / score / model_version /
assessed_at`, plus opaque advisory `signals`.

## Versioning and compatibility

- Breaking changes get a new URI (`…/trust-verdict/v2`). Agents that don't recognize the extension
  ignore the `risk_data` / `Task.metadata` block and proceed with the base flow (backward
  compatible). See [`VERSIONING.md`](./VERSIONING.md).
- The extension declares its own URI; the carried containers are versioned by their own schemas.

## Honesty note

This extension **documents and names** behavior the Fidacy engine already ships — it does not promise
anything that doesn't exist. The engine emits the signed Risk Payload into `risk_data` (AP2) and
`Task.metadata` (A2A) today, and the JWS is verifiable against the public JWKS with the open-source
verifier. Examples in this folder are illustrative; their JWS strings are samples, not live
signatures.
