import { CompactSign, calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { FidacyVerificationError, verifyWebhook } from '../src/index';

/**
 * Webhook verification under the v0.2.0 contract: the engine signs the envelope
 * {type, id, created, data} and sends the exact signed bytes as the request
 * body. Verification requires the signature, the byte-exact body match, and a
 * fresh `created`. Fail closed on all of it.
 */

const encoder = new TextEncoder();

let privateKey: CryptoKey;
let publicJwk: JWK;
let kid: string;

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  const pub = await exportJWK(pair.publicKey);
  kid = await calculateJwkThumbprint(pub, 'sha256');
  publicJwk = { ...pub, kid, alg: 'EdDSA', use: 'sig' };
});

function jwks() {
  return { keys: [publicJwk] };
}

async function sign(payload: string): Promise<string> {
  return new CompactSign(encoder.encode(payload))
    .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'application/vc+jws' })
    .sign(privateKey);
}

const now = new Date('2026-07-18T12:00:00.000Z');
const createdSec = Math.floor(now.getTime() / 1000);

function envelopeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    created: createdSec,
    data: { agent_id: 'agt_1', score: 12 },
    id: 'del_123',
    type: 'assessment.completed',
    ...overrides,
  });
}

describe('verifyWebhook', () => {
  it('valid signed event with matching raw body → returns the decoded authentic event', async () => {
    const body = envelopeJson();
    const event = await verifyWebhook({
      payload: body,
      signatureHeader: await sign(body),
      jwks: jwks(),
      now,
    });
    expect(event.type).toBe('assessment.completed');
    expect(event.id).toBe('del_123');
    expect(event.created).toBe(createdSec);
    expect(event.data).toEqual({ agent_id: 'agt_1', score: 12 });
  });

  it('raw body that differs from the signed payload → payload_mismatch (fail closed)', async () => {
    const signedBody = envelopeJson();
    const tamperedBody = envelopeJson({ data: { agent_id: 'agt_1', score: 99 } });
    await expect(
      verifyWebhook({
        payload: tamperedBody,
        signatureHeader: await sign(signedBody),
        jwks: jwks(),
        now,
      }),
    ).rejects.toMatchObject({ code: 'payload_mismatch' });
  });

  it('stale created outside toleranceSec → expired (replay defense)', async () => {
    const body = envelopeJson({ created: createdSec - 3600 });
    await expect(
      verifyWebhook({ payload: body, signatureHeader: await sign(body), jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('missing created or id → malformed (fail closed on legacy shapes)', async () => {
    const noCreated = JSON.stringify({ type: 'assessment.completed', id: 'del_1', data: {} });
    await expect(
      verifyWebhook({ payload: noCreated, signatureHeader: await sign(noCreated), jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'malformed' });

    const noId = JSON.stringify({ type: 'assessment.completed', created: createdSec, data: {} });
    await expect(
      verifyWebhook({ payload: noId, signatureHeader: await sign(noId), jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('bad signature → invalid_signature', async () => {
    const body = envelopeJson();
    const { privateKey: otherKey } = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const forged = await new CompactSign(encoder.encode(body))
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'application/vc+jws' })
      .sign(otherKey as CryptoKey);
    await expect(
      verifyWebhook({ payload: body, signatureHeader: forged, jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('algorithm confusion in webhook → invalid_signature', async () => {
    const body = envelopeJson();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid })).toString('base64url');
    const payload = Buffer.from(body).toString('base64url');
    const forged = `${header}.${payload}.AAAA`;
    await expect(
      verifyWebhook({ payload: body, signatureHeader: forged, jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('error message never contains the signature header', async () => {
    const body = envelopeJson();
    const jwsHeader = await sign(envelopeJson({ data: { other: true } }));
    try {
      await verifyWebhook({ payload: body, signatureHeader: jwsHeader, jwks: jwks(), now });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FidacyVerificationError);
      expect((err as Error).message).not.toContain(jwsHeader);
      expect((err as Error).message.length).toBeLessThan(200);
    }
  });
});
