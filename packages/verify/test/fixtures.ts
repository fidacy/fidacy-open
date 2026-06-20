/**
 * Test fixtures — freshly generated Ed25519 keys ONLY. No real Fidacy keys here.
 *
 * Every keypair is generated at runtime via `jose.generateKeyPair`. Nothing in
 * this file is, or has ever been, a production signing key.
 */
import {
  CompactSign,
  type JWK,
  base64url,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose';
import type { RiskPayloadClaims } from '../src/index.js';

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK; // OKP/Ed25519 public JWK with kid/alg/use
}

const enc = new TextEncoder();

/** Generate a fresh Ed25519 keypair and a public JWK shaped like the Fidacy JWKS. */
export async function makeTestKey(): Promise<TestKey> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const pub = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(pub);
  const publicJwk: JWK = { ...pub, kid, alg: 'EdDSA', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

/** A minimal-but-valid Risk Payload claims object. Override anything. */
export function sampleClaims(overrides: Partial<RiskPayloadClaims> = {}): RiskPayloadClaims {
  return {
    issuer: 'did:web:fidacy.com#key-1',
    subject: 'agent_test_123',
    decision: 'approve',
    score: 88,
    signals: { velocity: 'ok', reputation: 'high' },
    model_version: 'risk-1.4.2',
    assessed_at: '2026-06-20T12:00:00.000Z',
    ...overrides,
  };
}

/** Sign an arbitrary JSON payload as a compact EdDSA JWS (typ application/vc+jws). */
export async function signPayload(
  key: TestKey,
  payload: unknown,
  typ = 'application/vc+jws',
): Promise<string> {
  return new CompactSign(enc.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ })
    .sign(key.privateKey);
}

/** A JWKS document containing the given test keys' public JWKs. */
export function jwksOf(...keys: TestKey[]): { keys: JWK[] } {
  return { keys: keys.map((k) => k.publicJwk) };
}

/**
 * Forge a compact JWS-looking token whose protected header advertises a
 * non-EdDSA alg. Not actually a verifiable signature — used to prove the
 * algorithm lock rejects it BEFORE any verification.
 */
export function forgeToken(alg: 'HS256' | 'none', kid: string, payload: unknown): string {
  const header = base64url.encode(enc.encode(JSON.stringify({ alg, kid })));
  const body = base64url.encode(enc.encode(JSON.stringify(payload)));
  const sig = alg === 'none' ? '' : base64url.encode(enc.encode('forged-signature'));
  return `${header}.${body}.${sig}`;
}

/** A fetch mock that returns the given JWKS and counts calls. */
export function jwksFetchMock(jwks: { keys: JWK[] }): {
  fetch: typeof fetch;
  calls: () => number;
} {
  let count = 0;
  const fn = (async () => {
    count += 1;
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls: () => count };
}

/** A fetch mock that always fails (network down / non-200). */
export function failingFetchMock(status = 503): typeof fetch {
  return (async () =>
    new Response('upstream down', { status })) as unknown as typeof fetch;
}
