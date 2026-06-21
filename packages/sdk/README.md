# @fidacy/sdk

A thin, typed client for the public Fidacy API. It ships [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify) alongside it, so the verdict you get back is one call away from being independently verified.

Fidacy returns a signed verdict for an agent payment. The point of the SDK is not to make you trust that verdict: it is to get it, and hand you the tool to check the signature yourself.

## Install

```bash
npm i @fidacy/sdk
```

## Assess, then verify

```ts
import { Fidacy } from '@fidacy/sdk';

const fidacy = new Fidacy({ apiKey: process.env.FIDACY_API_KEY! }); // fky_test_… or fky_live_…

const result = await fidacy.assess({
  mandate: {
    vct: 'mandate.payment.1',
    payee: { id: 'merchant_demo', name: 'Demo Store' },
    payment_amount: { amount: 4299, currency: 'EUR' },
    payment_instrument: { id: 'pi_demo', type: 'card' },
  },
});

console.log(result.decision); // 'approve' | 'review' | 'deny'
console.log(result.score);    // 0..100

// Don't trust the response object — verify the signed payload yourself.
const verified = await fidacy.verify(result.riskPayloadJws);
console.log('signature valid:', verified.valid);
console.log('decisions match:', verified.claims.decision === result.decision);
```

`fidacy.verify` is `@fidacy/verify`'s `verifyRiskPayload`, bundled so you don't add a second dependency. The `assess` call itself does no verification: it returns the API's response as-is, and you decide whether to trust it by checking the signature against Fidacy's public JWKS.

### What `assess` returns

```ts
interface AssessResult {
  decision: 'approve' | 'review' | 'deny';
  score: number;            // 0..100
  assessmentId: string;
  riskPayloadJws: string;   // the signed verdict — pass to fidacy.verify
  signingKeyId: string;
  signals: Record<string, unknown>;
  outcome: Record<string, unknown>;
  spend_guard?: Record<string, unknown>;
  a2a?: { recommended_task_state: string; task_metadata: Record<string, unknown> };
}
```

## Webhooks

Webhook events are verified for you. `constructEvent` checks the signature before returning, and throws if it does not hold.

```ts
const event = await fidacy.webhooks.constructEvent(
  rawBody,
  req.headers['x-fidacy-signature'],
);
// event.type, event.data — only reached on a valid signature.
```

## Billing

```ts
const status = await fidacy.billing.get();
const { url } = await fidacy.billing.checkout({ tier: 'growth' });
```

## Errors

A non-2xx response throws `FidacyError`. The message is static and never includes your key or the request body.

```ts
import { FidacyError } from '@fidacy/sdk';

try {
  await fidacy.assess({ mandate });
} catch (err) {
  if (err instanceof FidacyError) {
    console.error(err.type, err.status, err.rejection_reasons);
  } else {
    throw err;
  }
}
```

## Options

```ts
new Fidacy({
  apiKey,            // required, sent as a Bearer token
  baseUrl,           // default 'https://api.fidacy.com'
  timeoutMs,         // per-request, default 10000
  maxRetries,        // idempotent calls only, default 2
  fetch,             // inject a fetch implementation
});
```

Retries apply only when you pass an `idempotencyKey` to `assess`, so a retried call can never double-charge or duplicate.

## License

Apache-2.0. Part of [fidacy-open](https://github.com/fidacy/fidacy-open).
