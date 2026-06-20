# Fidacy — Open verification + SDK

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Open verification + SDK for Fidacy — the external, signed trust layer for agent payments.

**Verify any Fidacy verdict yourself, against our public JWKS. Don't trust us — check.**

Every verdict Fidacy issues is signed. These packages let you fetch our public keys
and cryptographically verify that a risk payload or webhook genuinely came from Fidacy
and was not tampered with — entirely client-side, with no need to call back to us.

## Packages

| Package          | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| `@fidacy/verify` | Isomorphic signature verification against Fidacy's public JWKS. Zero trust in the SDK transport — verify the verdict itself. |
| `@fidacy/sdk`    | Thin, typed client for the public Fidacy API. Calls the API and verifies every response via `@fidacy/verify`. |
| `fidacy-spec`    | The open specification for Fidacy's signed payloads, JWKS, and webhook formats. See [`spec/`](./spec). |

## Quickstart

```bash
pnpm add @fidacy/sdk @fidacy/verify
# Not yet published to npm — for now, install from this repo (workspace).
```

```ts
import { Fidacy } from '@fidacy/sdk';
import { verifyRiskPayload } from '@fidacy/verify';

const fidacy = new Fidacy({ apiKey: process.env.FIDACY_API_KEY! });

// Assess a payment mandate (AP2 intent/cart).
const result = await fidacy.assess({
  mandate: {
    vct: 'mandate.payment.1',
    payee: { id: 'merchant_demo', name: 'Demo Store' },
    payment_amount: { amount: 4299, currency: 'EUR' },
    payment_instrument: { id: 'pi_demo', type: 'card' },
  },
});
console.log('decision:', result.decision);

// Don't trust us — verify the signed verdict yourself, against the public JWKS:
const verified = await verifyRiskPayload(result.riskPayloadJws);
console.log('signature valid:', verified.valid);
console.log('decisions match:', verified.claims.decision === result.decision);
```

Runnable end-to-end example: [`examples/quickstart-node`](./examples/quickstart-node).

## Links

- Specification: [`spec/`](./spec)
- Hosted product: https://fidacy.com

## Repository

> **Note:** the GitHub URL `https://github.com/fidacy/fidacy-open` is a **placeholder**
> until the public repository is created. Package `repository`/`homepage`/`bugs`
> metadata points at this placeholder for now.

## Design principles

- **Isomorphic.** `@fidacy/verify` runs in Node 18+, the browser, and edge runtimes.
  No Node-only globals.
- **Independent.** These packages only call the public API and verify signatures.
  They contain no Fidacy proprietary logic.
- **Auditable.** Apache-2.0, open source, no secrets.

## License

[Apache-2.0](./LICENSE) © 2026 ZEEPCODE GROUP LLC
