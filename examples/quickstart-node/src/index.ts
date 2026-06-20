/**
 * Fidacy quickstart — "don't trust us, verify".
 *
 * 1. Call the public Fidacy API to assess a payment mandate.
 * 2. Independently verify the signed verdict against Fidacy's public JWKS.
 *
 * Run:
 *   export FIDACY_API_KEY=fky_test_…   # a test key from app.fidacy.com
 *   pnpm --filter @fidacy/quickstart-node start
 */
import { randomUUID } from 'node:crypto';

import { Fidacy } from '@fidacy/sdk';
import { verifyRiskPayload } from '@fidacy/verify';

const apiKey = process.env.FIDACY_API_KEY;
if (!apiKey) {
  console.error('Set FIDACY_API_KEY (a fky_test_… key from app.fidacy.com)');
  process.exit(1);
}

const fidacy = new Fidacy({ apiKey });

// A minimal AP2 payment mandate (intent/cart). Replace with your real mandate.
const mandate = {
  vct: 'mandate.payment.1',
  transaction_id: randomUUID().replace(/-/g, ''),
  payee: { id: 'merchant_demo', name: 'Demo Store' },
  payment_amount: { amount: 4299, currency: 'EUR' },
  payment_instrument: { id: 'pi_demo', type: 'card' },
};

const result = await fidacy.assess({ mandate });
console.log('decision:', result.decision);

// Verify the signed verdict yourself, against the public JWKS — no trust required:
const verified = await verifyRiskPayload(result.riskPayloadJws);
console.log('signature valid:', verified.valid);
console.log('decisions match:', verified.claims.decision === result.decision);
