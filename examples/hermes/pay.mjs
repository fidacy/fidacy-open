#!/usr/bin/env node
/**
 * Seal a sample Hermes autonomous payment with a signed Fidacy verdict.
 *
 * Hermes Agent (Nous Research) is a self-hosted autonomous agent that, notably,
 * PAYS autonomously (L402 / Lightning, on-chain). Wire `beforePayment` before
 * the L402 / Lightning settlement so every autonomous payment carries a signed,
 * verifiable authorization seal: who authorized it, and the payment's provenance.
 * Gate on `verdict.allowed`.
 *
 * Requires FIDACY_API_KEY. Fails gracefully (no stack, no secret) if it is unset.
 */
import { verifyRiskPayload } from '@fidacy/sdk';
import { createHermesGuard } from '@fidacy/agent/hermes';

async function main() {
  const apiKey = process.env.FIDACY_API_KEY;
  if (!apiKey) {
    console.error(
      'Set FIDACY_API_KEY (a real Fidacy key) to run this example. It calls the live /v1/assess.',
    );
    process.exitCode = 1;
    return;
  }

  const guard = createHermesGuard({
    apiKey,
    agent: 'did:web:nousresearch.com#hermes-1',
    principal: process.env.FIDACY_PRINCIPAL ?? 'wallet_acme',
  });

  // A sample Hermes L402 / Lightning payment about to be settled.
  const payment = {
    amount: { value: 1500, currency: 'sat' },
    recipient: '03a1b2c3...lightning-node-pubkey',
    invoice: 'lnbc15u1p...sample-invoice',
    memo: 'L402 access token for api.vendor.com',
  };

  const verdict = await guard.beforePayment(payment);

  console.log('=== Hermes payment ===');
  console.log(JSON.stringify(payment, null, 2));
  console.log('\n=== Fidacy authorization verdict ===');
  console.log(
    JSON.stringify(
      {
        decision: verdict.decision,
        allowed: verdict.allowed,
        score: verdict.score,
        verified: verdict.verified,
        reasons: verdict.reasons,
        signingKeyId: verdict.signingKeyId,
        assessmentId: verdict.assessmentId,
      },
      null,
      2,
    ),
  );

  // Verify it yourself: the seal anyone can re-check against the public JWKS.
  console.log('\n=== Verify it yourself ===');
  console.log(`riskPayloadJws: ${verdict.riskPayloadJws.slice(0, 48)}...`);
  const checked = await verifyRiskPayload(verdict.riskPayloadJws);
  console.log(`verifyRiskPayload -> valid: ${checked.valid}, decision: ${checked.claims.decision}`);

  if (verdict.allowed) {
    console.log('\nHermes would now settle the L402 invoice, carrying this signed seal.');
  } else {
    console.log('\nHermes would HOLD the payment on the verdict above.');
  }
}

main().catch((err) => {
  console.error('Example failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
