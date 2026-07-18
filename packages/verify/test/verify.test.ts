import { CompactSign, calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { FidacyVerificationError, verifyRiskPayload, verifyWebhook } from '../src/index';

/**
 * Hardening tests: https-only JWKS fetch (no redirects), raw-body binding and
 * freshness window on webhooks. Self-contained — generates an Ed25519 keypair
 * and signs real JWS tokens; no network (fetch is always injected or unused).
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

/** A minimal valid risk payload for the JWKS-source tests. */
function riskPayloadJson(): string {
  return JSON.stringify({
    issuer: `did:web:fidacy.com#${kid}`,
    subject: 'agt_1',
    decision: 'approve',
    score: 12,
    signals: {},
    model_version: 'test',
    assessed_at: new Date().toISOString(),
  });
}

describe('JWKS fetch hardening', () => {
  it('rejects a non-https jwksUrl without ever calling fetch', async () => {
    let called = 0;
    const fetchSpy = (async () => {
      called += 1;
      return new Response('{}');
    }) as typeof fetch;
    const jws = await sign(riskPayloadJson());
    await expect(
      verifyRiskPayload(jws, { jwksUrl: 'http://api.fidacy.com/jwks-a.json', fetch: fetchSpy }),
    ).rejects.toMatchObject({ code: 'jwks_unavailable' });
    expect(called).toBe(0);
  });

  it('rejects http even for localhost (no exception; inject jwks instead)', async () => {
    const jws = await sign(riskPayloadJson());
    await expect(
      verifyRiskPayload(jws, { jwksUrl: 'http://localhost:3000/jwks-b.json' }),
    ).rejects.toMatchObject({ code: 'jwks_unavailable' });
  });

  it('rejects a malformed jwksUrl', async () => {
    const jws = await sign(riskPayloadJson());
    await expect(
      verifyRiskPayload(jws, { jwksUrl: 'not a url' }),
    ).rejects.toMatchObject({ code: 'jwks_unavailable' });
  });

  it('passes redirect: "error" to fetch so redirects fail instead of being followed', async () => {
    let seenInit: RequestInit | undefined;
    const fetchSpy = (async (_url: unknown, init?: RequestInit) => {
      seenInit = init;
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const jws = await sign(riskPayloadJson());
    const out = await verifyRiskPayload(jws, {
      jwksUrl: 'https://api.fidacy.com/jwks-c.json',
      fetch: fetchSpy,
    });
    expect(out.valid).toBe(true);
    expect(seenInit?.redirect).toBe('error');
  });

  it('with inline jwks there is zero network access', async () => {
    let called = 0;
    const fetchSpy = (async () => {
      called += 1;
      return new Response('{}');
    }) as typeof fetch;
    const jws = await sign(riskPayloadJson());
    const out = await verifyRiskPayload(jws, { jwks: jwks(), fetch: fetchSpy });
    expect(out.valid).toBe(true);
    expect(called).toBe(0);
  });
});

describe('verifyWebhook — raw-body binding + freshness', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  const createdSec = Math.floor(now.getTime() / 1000);

  function envelopeJson(overrides: Record<string, unknown> = {}): string {
    // Canonical enough for tests: what matters is that the BODY string equals
    // the SIGNED string byte for byte, which the tests control directly.
    return JSON.stringify({
      created: createdSec,
      data: { agent_id: 'agt_1', score: 12 },
      id: 'del_123',
      type: 'assessment.completed',
      ...overrides,
    });
  }

  it('accepts a fresh, untampered delivery and returns the typed event', async () => {
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

  it('rejects when the raw body differs from the signed payload', async () => {
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

  it('rejects an event outside the tolerance window (replay of an old delivery)', async () => {
    const body = envelopeJson({ created: createdSec - 3600 });
    await expect(
      verifyWebhook({
        payload: body,
        signatureHeader: await sign(body),
        jwks: jwks(),
        now,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('honours a custom toleranceSec', async () => {
    const body = envelopeJson({ created: createdSec - 120 });
    const params = {
      payload: body,
      signatureHeader: await sign(body),
      jwks: jwks(),
      now,
    };
    await expect(verifyWebhook({ ...params, toleranceSec: 60 })).rejects.toMatchObject({
      code: 'expired',
    });
    const ok = await verifyWebhook({ ...params, toleranceSec: 300 });
    expect(ok.id).toBe('del_123');
  });

  it('fails closed when created is missing (legacy pre-envelope deliveries)', async () => {
    const body = JSON.stringify({ type: 'assessment.completed', id: 'del_1', data: {} });
    await expect(
      verifyWebhook({ payload: body, signatureHeader: await sign(body), jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('fails closed when id is missing', async () => {
    const body = JSON.stringify({ type: 'assessment.completed', created: createdSec, data: {} });
    await expect(
      verifyWebhook({ payload: body, signatureHeader: await sign(body), jwks: jwks(), now }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('still enforces the EdDSA-only and known-kid rules on the webhook path', async () => {
    const body = envelopeJson();
    const wrongKeys = { keys: [{ ...publicJwk, kid: 'other-kid' }] };
    await expect(
      verifyWebhook({ payload: body, signatureHeader: await sign(body), jwks: wrongKeys, now }),
    ).rejects.toBeInstanceOf(FidacyVerificationError);
  });
});
