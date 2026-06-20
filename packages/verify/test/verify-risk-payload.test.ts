import { describe, expect, it } from 'vitest';
import {
  FidacyVerificationError,
  verifyRiskPayload,
} from '../src/index.js';
import {
  failingFetchMock,
  forgeToken,
  jwksFetchMock,
  jwksOf,
  makeTestKey,
  sampleClaims,
  signPayload,
} from './fixtures.js';

describe('verifyRiskPayload', () => {
  it('happy path: valid JWS + injected jwks → valid:true, claims + kid match', async () => {
    const key = await makeTestKey();
    const claims = sampleClaims();
    const jws = await signPayload(key, claims);

    const res = await verifyRiskPayload(jws, { jwks: jwksOf(key) });

    expect(res.valid).toBe(true);
    expect(res.kid).toBe(key.kid);
    expect(res.protectedHeader.alg).toBe('EdDSA');
    expect(res.protectedHeader.kid).toBe(key.kid);
    expect(res.protectedHeader.typ).toBe('application/vc+jws');
    expect(res.claims).toEqual(claims);
    expect(res.claims.decision).toBe('approve');
    expect(res.claims.score).toBe(88);
    // signals stay opaque (passed through untouched)
    expect(res.claims.signals).toEqual({ velocity: 'ok', reputation: 'high' });
  });

  it('fetched jwks works (mock fetch)', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());
    const mock = jwksFetchMock(jwksOf(key));

    const res = await verifyRiskPayload(jws, { fetch: mock.fetch });

    expect(res.valid).toBe(true);
    expect(mock.calls()).toBe(1);
  });

  it('JWKS cache: a second verify with same url does not re-fetch', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());
    const mock = jwksFetchMock(jwksOf(key));
    const url = 'https://cache-test.example/.well-known/jwks.json';

    await verifyRiskPayload(jws, { fetch: mock.fetch, jwksUrl: url, cacheTtlMs: 60_000 });
    await verifyRiskPayload(jws, { fetch: mock.fetch, jwksUrl: url, cacheTtlMs: 60_000 });

    expect(mock.calls()).toBe(1);
  });

  it('injected jwks bypasses network entirely (fetch must not be called)', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());
    let called = false;
    const fetchSpy = (async () => {
      called = true;
      return new Response('nope', { status: 500 });
    }) as unknown as typeof fetch;

    const res = await verifyRiskPayload(jws, { jwks: jwksOf(key), fetch: fetchSpy });

    expect(res.valid).toBe(true);
    expect(called).toBe(false);
  });

  it('fetch failure → jwks_unavailable', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());

    await expect(
      verifyRiskPayload(jws, {
        fetch: failingFetchMock(503),
        jwksUrl: 'https://down.example/jwks.json',
      }),
    ).rejects.toMatchObject({
      name: 'FidacyVerificationError',
      code: 'jwks_unavailable',
    });
  });

  it('unknown kid → unknown_kid', async () => {
    const signer = await makeTestKey();
    const other = await makeTestKey();
    const jws = await signPayload(signer, sampleClaims());

    await expect(verifyRiskPayload(jws, { jwks: jwksOf(other) })).rejects.toMatchObject({
      code: 'unknown_kid',
    });
  });

  it('wrong key (kid collides but key differs) → invalid_signature', async () => {
    const signer = await makeTestKey();
    const impostor = await makeTestKey();
    // Give the impostor's published JWK the signer's kid → resolves, but verify fails.
    const impostorJwkWithSignerKid = { ...impostor.publicJwk, kid: signer.kid };
    const jws = await signPayload(signer, sampleClaims());

    await expect(
      verifyRiskPayload(jws, { jwks: { keys: [impostorJwkWithSignerKid] } }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('tampered payload → invalid_signature', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());
    // Flip a character in the payload segment.
    const parts = jws.split('.');
    const tampered = `${parts[0]}.${parts[1]}X.${parts[2]}`;

    await expect(verifyRiskPayload(tampered, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });

  it('algorithm confusion: alg HS256 → invalid_signature (never verified)', async () => {
    const key = await makeTestKey();
    const forged = forgeToken('HS256', key.kid, sampleClaims());

    await expect(verifyRiskPayload(forged, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });

  it('algorithm confusion: alg none → invalid_signature (never verified)', async () => {
    const key = await makeTestKey();
    const forged = forgeToken('none', key.kid, sampleClaims());

    await expect(verifyRiskPayload(forged, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });

  it('wrong issuer prefix → wrong_issuer', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims({ issuer: 'did:web:evil.com#key-1' }));

    await expect(verifyRiskPayload(jws, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'wrong_issuer',
    });
  });

  it('custom issuer prefix is honored (prefix match, not equality)', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims({ issuer: 'did:web:staging.fidacy.com#k9' }));

    const res = await verifyRiskPayload(jws, {
      jwks: jwksOf(key),
      issuer: 'did:web:staging.fidacy.com#',
    });
    expect(res.valid).toBe(true);
  });

  it('malformed JWS → malformed', async () => {
    const key = await makeTestKey();
    await expect(
      verifyRiskPayload('not-a-jws', { jwks: jwksOf(key) }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('non-JSON payload → malformed', async () => {
    const key = await makeTestKey();
    // Sign a raw string that is not a JSON object.
    const jws = await signPayload(key, 'just a string');
    await expect(verifyRiskPayload(jws, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('missing required claims → malformed', async () => {
    const key = await makeTestKey();
    const { score: _score, ...partial } = sampleClaims();
    const jws = await signPayload(key, partial);
    await expect(verifyRiskPayload(jws, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('unparseable assessed_at → malformed', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims({ assessed_at: 'not-a-date' }));
    await expect(verifyRiskPayload(jws, { jwks: jwksOf(key) })).rejects.toMatchObject({
      code: 'malformed',
    });
  });

  it('exp in the past → expired (with now injection)', async () => {
    const key = await makeTestKey();
    const past = Math.floor(Date.parse('2026-06-20T11:00:00.000Z') / 1000);
    const jws = await signPayload(key, sampleClaims({ exp: past }));

    await expect(
      verifyRiskPayload(jws, {
        jwks: jwksOf(key),
        now: new Date('2026-06-20T12:00:00.000Z'),
        maxClockSkewSec: 60,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('exp in the past but within clock skew → still valid', async () => {
    const key = await makeTestKey();
    const exp = Math.floor(Date.parse('2026-06-20T11:59:30.000Z') / 1000);
    const jws = await signPayload(key, sampleClaims({ exp }));

    const res = await verifyRiskPayload(jws, {
      jwks: jwksOf(key),
      now: new Date('2026-06-20T12:00:00.000Z'),
      maxClockSkewSec: 60,
    });
    expect(res.valid).toBe(true);
  });

  it('assessed_at in the future is NOT rejected (no exp semantics)', async () => {
    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims({ assessed_at: '2099-01-01T00:00:00.000Z' }));
    const res = await verifyRiskPayload(jws, { jwks: jwksOf(key) });
    expect(res.valid).toBe(true);
  });

  it('error messages NEVER contain the JWS string', async () => {
    const key = await makeTestKey();
    const other = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());

    let caught: unknown;
    try {
      await verifyRiskPayload(jws, { jwks: jwksOf(other) }); // unknown_kid
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FidacyVerificationError);
    const err = caught as FidacyVerificationError;
    expect(err.message).not.toContain(jws);
    // also check no payload segment leaks
    expect(err.message).not.toContain(jws.split('.')[1]);
  });

  it('FidacyVerificationError shape: name + code', async () => {
    const err = new FidacyVerificationError('malformed', 'bad token');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FidacyVerificationError');
    expect(err.code).toBe('malformed');
  });
});
