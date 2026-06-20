import { describe, expect, it } from 'vitest';
import { verifyWebhook } from '../src/index.js';
import { forgeToken, jwksOf, makeTestKey, signPayload } from './fixtures.js';

const sampleEvent = {
  id: 'asmt_1:assessment.completed',
  type: 'assessment.completed',
  created: 1_750_000_000,
  livemode: true,
  data: {
    assessment_id: 'asmt_1',
    decision: 'approve',
    risk_level: 'low',
    risk_score: 12,
    agent_id: 'agent_1',
    kind: 'payment',
  },
};

describe('verifyWebhook', () => {
  it('valid signed event → returns the decoded authentic event', async () => {
    const key = await makeTestKey();
    const signatureHeader = await signPayload(key, sampleEvent, 'application/vc+jws');

    const event = await verifyWebhook({
      payload: JSON.stringify(sampleEvent),
      signatureHeader,
      jwks: jwksOf(key),
    });

    expect(event.type).toBe('assessment.completed');
    expect(event.id).toBe('asmt_1:assessment.completed');
    expect(event.created).toBe(1_750_000_000);
    expect(event.data).toEqual(sampleEvent.data);
  });

  it('trusts the SIGNED payload, not the raw body (raw body is ignored)', async () => {
    const key = await makeTestKey();
    const signatureHeader = await signPayload(key, sampleEvent);

    const event = await verifyWebhook({
      payload: '{"type":"attacker.injected"}', // lying raw body
      signatureHeader,
      jwks: jwksOf(key),
    });

    expect(event.type).toBe('assessment.completed');
  });

  it('bad signature → invalid_signature', async () => {
    const signer = await makeTestKey();
    const other = await makeTestKey();
    const signatureHeader = await signPayload(signer, sampleEvent);

    await expect(
      verifyWebhook({
        payload: JSON.stringify(sampleEvent),
        signatureHeader,
        jwks: jwksOf(other),
      }),
    ).rejects.toMatchObject({ code: 'unknown_kid' });
  });

  it('algorithm confusion in webhook → invalid_signature', async () => {
    const key = await makeTestKey();
    const forged = forgeToken('HS256', key.kid, sampleEvent);

    await expect(
      verifyWebhook({
        payload: JSON.stringify(sampleEvent),
        signatureHeader: forged,
        jwks: jwksOf(key),
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('error message never contains the signature header', async () => {
    const signer = await makeTestKey();
    const other = await makeTestKey();
    const signatureHeader = await signPayload(signer, sampleEvent);

    let caught: unknown;
    try {
      await verifyWebhook({
        payload: JSON.stringify(sampleEvent),
        signatureHeader,
        jwks: jwksOf(other),
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).not.toContain(signatureHeader);
  });
});
