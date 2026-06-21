/**
 * Fidacy Trust-Verdict Extension (A2A) — reference example.
 *
 * Demonstrates the whole point of the extension end to end:
 *   1. An agent assesses a purchase through Fidacy inside an A2A flow.
 *   2. Fidacy returns the verdict the A2A way — in `Task.metadata` under
 *      `fidacy_assessment`, carrying the signed EdDSA JWS.
 *   3. The client VERIFIES that JWS itself with @fidacy/verify, against the
 *      public JWKS. No trust in Fidacy is required.
 *
 * Run:
 *   export FIDACY_API_KEY=fky_test_…    # a TEST key from app.fidacy.com (sandbox, never billed)
 *   pnpm install && pnpm start
 *
 * The agent that RECEIVES this verdict typically uses the official A2A SDK
 * (`@a2a-js/sdk`) to drive the Task; this example focuses on the Fidacy half —
 * extracting and verifying the verdict that rides inside the A2A Task.metadata.
 */
import { randomUUID } from 'node:crypto';
import { Fidacy } from '@fidacy/sdk';
import { verifyRiskPayload, FidacyVerificationError } from '@fidacy/verify';
import type { AgentCard } from '@a2a-js/sdk';

const apiKey = process.env.FIDACY_API_KEY;
if (!apiKey) {
  console.error('Set FIDACY_API_KEY (a fky_test_… key from app.fidacy.com → API Keys, mode: test).');
  process.exit(1);
}

// How a buying agent DECLARES the extension in its Agent Card (typed with the
// official A2A SDK). Clients that understand the extension opt in.
const agentCard: Pick<AgentCard, 'capabilities'> = {
  capabilities: {
    extensions: [
      {
        uri: 'https://fidacy.com/a2a/extensions/trust-verdict/v1',
        description: 'Carries a Fidacy trust verdict (approve/review/deny), signed and verifiable.',
        required: false,
        params: {
          issuer: 'did:web:fidacy.com',
          jwks_uri: 'https://api.fidacy.com/.well-known/jwks.json',
          verify_package: '@fidacy/verify',
        },
      },
    ],
  },
};
console.log('Agent Card declares:', agentCard.capabilities?.extensions?.[0]?.uri);

const fidacy = new Fidacy({ apiKey });

// A minimal AP2 payment mandate the agent wants assessed.
const mandate = {
  vct: 'mandate.payment.1',
  transaction_id: randomUUID().replace(/-/g, ''),
  payee: { id: 'merchant_demo', name: 'Demo Store' },
  payment_amount: { amount: 2999, currency: 'EUR' },
  payment_instrument: { id: 'pi_demo', type: 'card' },
};

// 1+2. Assess inside an A2A flow. The verdict comes back in the A2A Task.metadata.
const result = await fidacy.assess(
  { mandate, a2a: { task_id: `task_${randomUUID().slice(0, 8)}` } },
  { a2aVersion: '1.0' },
);

// The `a2a` block is protocol-specific (AssessResult is open via its index signature).
const a2a = (result as { a2a?: { recommended_task_state?: string; task_metadata?: { fidacy_assessment?: { risk_payload?: { jws?: string } } } } }).a2a;
const fa = a2a?.task_metadata?.fidacy_assessment;
const jws = fa?.risk_payload?.jws ?? result.riskPayloadJws;
console.log('A2A recommended task state:', a2a?.recommended_task_state);
console.log('Verdict rides in Task.metadata.fidacy_assessment:', Boolean(fa));

// 3. Verify the signed verdict yourself — do not trust the response object.
try {
  const verified = await verifyRiskPayload(jws);
  console.log('signature valid:', verified.valid);
  console.log('decision (verified):', verified.claims.decision, '· score:', verified.claims.score);
  console.log('decisions match:', verified.claims.decision === result.decision);
} catch (err) {
  if (err instanceof FidacyVerificationError) {
    console.error('verdict rejected — do not honour it:', err.code);
    process.exit(1);
  }
  throw err;
}
