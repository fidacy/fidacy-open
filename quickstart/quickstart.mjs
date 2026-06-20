/**
 * Fidacy quickstart — "don't trust us, verify".
 *
 *   1. Assess a payment mandate (the engine validates, scores, signs, audits).
 *   2. Verify the signed verdict YOURSELF against the public JWKS — no trust needed.
 *
 * Run (30 seconds):
 *   npm install
 *   FIDACY_API_KEY=fky_test_…  node quickstart.mjs     # test key from app.fidacy.com
 */
import { randomUUID } from 'node:crypto';
import { Fidacy } from '@fidacy/sdk';
import { verifyRiskPayload } from '@fidacy/verify';

const apiKey = process.env.FIDACY_API_KEY;
if (!apiKey) {
  console.error(
    '\n  ✗ Set FIDACY_API_KEY first.' +
    '\n    Create a TEST key (sandbox, never billed) at https://app.fidacy.com → API Keys → mode: test' +
    '\n    Then:  FIDACY_API_KEY=fky_test_… node quickstart.mjs\n',
  );
  process.exit(1);
}

const fidacy = new Fidacy({ apiKey }); // defaults to https://api.fidacy.com

// 1) Assess — returns the decision + an EdDSA-signed verdict (riskPayloadJws).
const verdict = await fidacy.assess({
  mandate: {
    vct: 'mandate.payment.1',
    transaction_id: randomUUID().replace(/-/g, ''),
    payee: { id: 'merchant_demo', name: 'Demo Store' },
    payment_amount: { amount: 4299, currency: 'EUR' },
    payment_instrument: { id: 'pi_demo', type: 'card' },
  },
});
console.log('\n  decision  :', verdict.decision, `(approve | review | deny)`);
console.log('  score     :', verdict.score);
console.log('  assessment:', verdict.assessmentId);

// 2) Verify the signature yourself — against the public JWKS, offline, no trust.
const { valid, claims } = await verifyRiskPayload(verdict.riskPayloadJws);
console.log('\n  signature valid :', valid, '  ← anyone (a rail, an auditor, a public body) can check this');
console.log('  signed decision :', claims.decision, '(matches the response:', claims.decision === verdict.decision, ')\n');

process.exit(valid ? 0 : 1);
