import { describe, expect, it } from 'vitest';
import {
  TrustListError,
  assertKidInTrustList,
  verifyVerdict,
} from '../src/verify.js';
import { demoClaims, forgeNonEddsaToken, jwksOf, makeDemoKey, signClaims } from './fixtures.js';

describe('verifyVerdict', () => {
  it('valid EdDSA verdict + injected jwks → valid:true with matching claims', async () => {
    const key = await makeDemoKey();
    const claims = demoClaims(key, { subject: 'agent@company.com', decision: 'deny', score: 90 });
    const jws = await signClaims(key, claims);

    const res = await verifyVerdict(jws, {
      jwks: jwksOf(key),
      issuer: 'did:web:fidacy.com#',
    });

    expect(res.valid).toBe(true);
    expect(res.kid).toBe(key.kid);
    expect(res.claims.subject).toBe('agent@company.com');
    expect(res.claims.decision).toBe('deny');
    expect(res.claims.score).toBe(90);
  });

  it('EdDSA-only is enforced: a non-EdDSA jws throws', async () => {
    const key = await makeDemoKey();
    const token = forgeNonEddsaToken(key.kid, demoClaims(key));
    await expect(
      verifyVerdict(token, { jwks: jwksOf(key), issuer: 'did:web:fidacy.com#' }),
    ).rejects.toThrow();
  });
});

describe('assertKidInTrustList', () => {
  it('passes when the kid is in the (inline) trust list', async () => {
    await expect(
      assertKidInTrustList('kid-A', {
        trustList: { keys: [{ kid: 'kid-A' }, { kid: 'kid-B' }], proof: { jws: 'x' } },
      }),
    ).resolves.toBeUndefined();
  });

  it('throws TrustListError when the kid is absent', async () => {
    await expect(
      assertKidInTrustList('kid-Z', {
        trustList: { keys: [{ kid: 'kid-A' }] },
      }),
    ).rejects.toBeInstanceOf(TrustListError);
  });

  it('fetches the trust list (mock fetch) and passes when present', async () => {
    const fetchMock = (async () =>
      new Response(JSON.stringify({ keys: [{ kid: 'kid-A' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    await expect(
      assertKidInTrustList('kid-A', {
        trustListUrl: 'https://api.fidacy.com/.well-known/fidacy-trust-list.json',
        fetch: fetchMock,
      }),
    ).resolves.toBeUndefined();
  });
});
