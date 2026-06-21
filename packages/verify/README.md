# @fidacy/verify

Isomorphic signature verification for Fidacy signed payloads, checked against Fidacy's public JWKS.

A Fidacy verdict is an EdDSA-signed JWS. This package verifies that signature so you can trust a verdict without trusting Fidacy and without holding a Fidacy account. It runs the same in Node, the browser, edge runtimes, and Deno (WebCrypto, no native deps). About 5 KB of JS over a single dependency (`jose`).

## Install

```bash
npm i @fidacy/verify
```

## Verify a risk payload

A risk payload travels as a compact JWS (the `risk_data` on an AP2 mandate, or the `jws` field on an assessment). Pass it in. By default the keys are fetched from Fidacy's public JWKS and cached in memory for 5 minutes.

```ts
import { verifyRiskPayload, FidacyVerificationError } from '@fidacy/verify';

try {
  const { claims, kid } = await verifyRiskPayload(jws);
  // The signature is valid and the issuer is Fidacy. Now act on the claims:
  console.log(claims.decision); // 'approve' | 'review' | 'deny'
  console.log(claims.score); // 0..100
  console.log(claims.subject, claims.assessed_at, 'signed by', kid);
} catch (err) {
  if (err instanceof FidacyVerificationError) {
    // Do NOT honour the verdict. err.code tells you why.
    console.error('rejected:', err.code);
  } else {
    throw err;
  }
}
```

`verifyRiskPayload` resolves to a `VerifiedRiskPayload` only when the signature checks out, the key is published in the JWKS, the issuer matches, and the payload has not expired. Otherwise it throws `FidacyVerificationError`. There is no "valid: false" return: a rejection is always a thrown error, so a successful call means the verdict is trustworthy.

### Claims

```ts
interface RiskPayloadClaims {
  issuer: string;        // "did:web:fidacy.com#<kid>"
  subject: string;       // what was assessed
  decision: 'approve' | 'review' | 'deny';
  score: number;         // 0..100
  signals: Record<string, unknown>; // OPAQUE — see below
  model_version: string;
  assessed_at: string;   // ISO 8601
}
```

`signals` is opaque and free to change between model versions. Do not branch on its shape. The stable contract is `decision`, `score`, `subject`, and `assessed_at`.

## Offline / air-gapped

Pin the keys yourself and the verifier never touches the network. Pull the JWKS once from `https://api.fidacy.com/.well-known/jwks.json` (or read it from the signed [trust list](https://api.fidacy.com/.well-known/fidacy-trust-list.json)), then inject it:

```ts
import jwks from './fidacy-jwks.json' assert { type: 'json' };

const { claims } = await verifyRiskPayload(jws, { jwks });
```

## Verify a webhook

```ts
import { verifyWebhook } from '@fidacy/verify';

const event = await verifyWebhook({
  payload: rawBody,                         // the raw request body
  signatureHeader: req.headers['x-fidacy-signature'],
});
// event.type, event.data — only reached if the signature is valid.
```

## Options

```ts
verifyRiskPayload(jws, {
  jwksUrl,          // default 'https://api.fidacy.com/.well-known/jwks.json'
  jwks,             // inject a JWKS document → zero network
  issuer,           // required issuer prefix, default 'did:web:fidacy.com#'
  maxClockSkewSec,  // tolerance for the optional `exp` claim, default 60
  cacheTtlMs,       // in-memory JWKS cache TTL, default 300000
  fetch,            // override the fetch implementation
  now,              // override "now" (tests)
});
```

## Error codes

`FidacyVerificationError.code` is one of:

| code | meaning |
|---|---|
| `invalid_signature` | the JWS did not verify against the resolved key |
| `unknown_kid` | the signing key id is not in the JWKS |
| `wrong_issuer` | the issuer did not match the required prefix |
| `expired` | the payload's `exp` is in the past (beyond skew) |
| `jwks_unavailable` | the JWKS could not be fetched |
| `malformed` | the input was not a well-formed signed payload |

Treat every one of these as "do not honour the verdict."

## License

Apache-2.0. Part of [fidacy-open](https://github.com/fidacy/fidacy-open).
