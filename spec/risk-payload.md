# Risk Payload

**Schema:** [`risk-payload.schema.json`](./risk-payload.schema.json) (JSON Schema, draft 2020-12)

The **Risk Payload** is Fidacy's verdict: a small, signed claims set that states the
risk decision for an assessed agent or mandate. It is the authoritative, machine-verifiable
output of Fidacy — everything else (the `risk_data` container, the A2A metadata block) merely
transports it.

## How it is signed

The claims are signed as a **compact JWS** (RFC 7515):

| Property        | Value                                                              |
| --------------- | ----------------------------------------------------------------- |
| Algorithm       | `EdDSA` (Ed25519)                                                  |
| `typ` header    | `application/vc+jws`                                               |
| `kid` header    | The signing key id; also the fragment of the `issuer` DID         |
| Encoding        | Compact serialization — `base64url(header).base64url(payload).base64url(signature)` |

The signature is verifiable against Fidacy's **public JWKS**:

```
https://api.fidacy.com/.well-known/jwks.json
```

The `kid` in the JWS protected header selects the public key from the JWKS. The same `kid`
appears as the fragment of the `issuer` claim, e.g. `did:web:fidacy.com#key-2026-06`.

> **Don't trust — verify.** Use [`@fidacy/verify`](../packages/verify) to fetch the JWKS and
> cryptographically verify a Risk Payload entirely client-side, with no callback to Fidacy.

## Claims

| Claim           | Type     | Required | Notes                                                       |
| --------------- | -------- | -------- | ----------------------------------------------------------- |
| `issuer`        | string   | yes      | DID of the signer; matches `^did:web:fidacy\.com#.+`        |
| `subject`       | string   | yes      | Opaque id of the assessed agent/mandate                     |
| `decision`      | enum     | yes      | `approve` \| `review` \| `deny`                             |
| `score`         | number   | yes      | `0`–`100` (0 = lowest risk, 100 = highest)                  |
| `signals`       | object   | no       | **Opaque**, advisory — see below                            |
| `model_version` | string   | yes      | Scoring model identifier; independent of format version     |
| `assessed_at`   | string   | yes      | RFC 3339 / ISO 8601 date-time                               |

### `signals` is opaque

`signals` is a **free-form, advisory** object. The set of keys, their names, and their meaning
are **not part of this specification**, may change at any time, and **MUST NOT** be used for
decisioning. The signed `decision` is the authoritative result. Verifiers and integrators
should treat `signals` purely as informational telemetry.

### Forward compatibility

The schema sets `additionalProperties: true`. Fidacy may add new claims over time.
**Verifiers MUST ignore claims they do not recognize** and MUST NOT fail verification on their
presence. See [`VERSIONING.md`](./VERSIONING.md).

## Example claims

```json
{
  "issuer": "did:web:fidacy.com#key-2026-06",
  "subject": "agent_9f3a...",
  "decision": "approve",
  "score": 12,
  "signals": { "velocity": "ok", "reputation": "high" },
  "model_version": "risk-1.4.2",
  "assessed_at": "2026-06-20T12:00:00.000Z"
}
```

This object is what gets signed into the compact JWS. After verification, `@fidacy/verify`
returns exactly these claims.
