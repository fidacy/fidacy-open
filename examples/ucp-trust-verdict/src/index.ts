/**
 * Fidacy Trust-Verdict Binding (UCP) reference example.
 *
 * Demonstrates the binding end to end:
 *   1. Assess a payment inside a UCP flow (a `ucp` block engages UCP).
 *   2. Fidacy returns the verdict the UCP way: as a `com.fidacy.trust_verdict`
 *      signal carrying the signed EdDSA JWS.
 *   3. The client VERIFIES that JWS itself with @fidacy/verify, against the
 *      public JWKS. No trust in Fidacy required.
 *
 * Run:
 *   export FIDACY_API_KEY=fky_test_…    # a TEST key from app.fidacy.com (sandbox, never billed)
 *   pnpm install && pnpm start
 *
 * UCP is called over plain REST here (the verdict rides UCP's `signals`); the SDK
 * does not need a UCP-specific method, so this uses fetch + @fidacy/verify.
 */
import { randomUUID } from 'node:crypto';
import { verifyRiskPayload, FidacyVerificationError } from '@fidacy/verify';

const API = process.env.FIDACY_API ?? 'https://api.fidacy.com';
const apiKey = process.env.FIDACY_API_KEY;
if (!apiKey) {
  console.error('Set FIDACY_API_KEY (a fky_test_… key from app.fidacy.com → API Keys, mode: test).');
  process.exit(1);
}

const mandate = {
  vct: 'mandate.payment.1',
  transaction_id: randomUUID().replace(/-/g, ''),
  payee: { id: 'merchant_demo', name: 'Demo Store' },
  payment_amount: { amount: 2999, currency: 'EUR' },
  payment_instrument: { id: 'pi_demo', type: 'card' },
};

// 1+2. Assess inside a UCP flow. The `ucp` block engages UCP; the verdict comes
// back as a signal under `ucp.signals["com.fidacy.trust_verdict"]`.
const res = await fetch(`${API}/v1/assess`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify({
    kind: 'ap2_payment',
    mandate,
    ucp: { checkout_id: `co_${randomUUID().slice(0, 8)}`, ucp_version: '2026-04-08' },
  }),
});
if (!res.ok) {
  console.error('assess failed:', res.status, await res.text());
  process.exit(1);
}
const result = (await res.json()) as {
  decision: string;
  ucp?: { recommended_action?: string; signals?: Record<string, { jws?: string }> };
};

const signal = result.ucp?.signals?.['com.fidacy.trust_verdict'];
const jws = signal?.jws;
console.log('UCP recommended action:', result.ucp?.recommended_action);
console.log('Verdict rides in signals["com.fidacy.trust_verdict"]:', Boolean(signal));
if (!jws) {
  console.error('No trust-verdict signal in the response.');
  process.exit(1);
}

// 3. Verify the signed verdict yourself, against the public JWKS.
try {
  const verified = await verifyRiskPayload(jws);
  console.log('signature valid:', verified.valid);
  console.log('decision (verified):', verified.claims.decision, 'score:', verified.claims.score);
  console.log('decisions match:', verified.claims.decision === result.decision);
} catch (err) {
  if (err instanceof FidacyVerificationError) {
    console.error('verdict rejected, do not honour it:', err.code);
    process.exit(1);
  }
  throw err;
}
