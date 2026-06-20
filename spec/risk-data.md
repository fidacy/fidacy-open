# `risk_data` Container

**Schema:** [`risk-data.schema.json`](./risk-data.schema.json) (JSON Schema, draft 2020-12)

The **`risk_data` container** is how Fidacy's verdict rides inside an
[AP2](https://github.com/google-agentic-commerce/AP2) **Payment Mandate**. AP2 mandates of type
`payment` / `open_payment` carry a `risk_data` field; Fidacy populates it with a `{ fidacy: { ... } }`
object so the payment rail can read — and independently verify — the signed decision without
calling back to Fidacy.

> This document describes the `{ fidacy: ... }` object that is the **value** of the AP2
> `risk_data` field. The surrounding AP2 mandate structure is defined by AP2, not here.

## Shape

```jsonc
{
  "risk_data": {
    "fidacy": {
      "decision": "approve",        // convenience copy
      "score": 12,                  // convenience copy
      "vc_jws": "eyJhbGciOi...",    // the signed verdict — source of truth
      "signing_key_id": "key-2026-06",
      "payload": { /* decoded Risk Payload claims */ }
    }
  }
}
```

| Field            | Type   | Required | Notes                                                                  |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `decision`       | enum   | yes      | Convenience copy of the signed decision                                |
| `score`          | number | yes      | Convenience copy of the signed score (`0`–`100`)                       |
| `vc_jws`         | string | yes      | The compact EdDSA JWS — **independently verifiable**                    |
| `signing_key_id` | string | yes      | `kid` of the signing key; matches the issuer DID fragment and JWKS     |
| `payload`        | object | yes      | The decoded [Risk Payload](./risk-payload.md) claims, for convenience  |

## Authority model

`vc_jws` is the **source of truth**. The `decision`, `score`, and `payload` fields are
convenience copies provided so a reader can route on the verdict without first decoding the JWS.
A trusting integrator **MUST verify `vc_jws`** (e.g. with [`@fidacy/verify`](../packages/verify))
against the public JWKS at `https://api.fidacy.com/.well-known/jwks.json` and treat the verified
claims — not the convenience copies — as authoritative.

`payload` conforms to [`risk-payload.schema.json`](./risk-payload.schema.json).

## Forward compatibility

`additionalProperties: true` at both levels. Readers MUST ignore unknown fields. See
[`VERSIONING.md`](./VERSIONING.md).
