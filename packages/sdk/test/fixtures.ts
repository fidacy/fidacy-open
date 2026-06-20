/**
 * Test fixtures for @fidacy/sdk.
 *
 * NO real network, NO real API key. The "api key" is a fake string. Every
 * `fetch` is a mock that records calls. Webhook signing reuses freshly
 * generated Ed25519 keys via `jose` (same approach as @fidacy/verify tests).
 */
import {
  CompactSign,
  type JWK,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose';

/** A fake, non-secret API key. Never a real Fidacy key. */
export const FAKE_KEY = 'fky_test_example';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A planned response: either an HTTP Response or a thrown error (network/abort). */
export type Plan =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'throw'; error: Error }
  | { kind: 'hang' };

/**
 * Build a fetch mock that returns/throws according to a queue of plans. Once the
 * queue is exhausted, the LAST plan repeats. Records every call.
 */
export function fetchMock(plans: Plan[]): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fn = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, init: init ?? {} });
    const plan = plans[Math.min(i, plans.length - 1)];
    i += 1;
    if (plan.kind === 'throw') throw plan.error;
    if (plan.kind === 'hang') {
      // Never resolves on its own — respects AbortSignal if present.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }
    return new Response(JSON.stringify(plan.body), {
      status: plan.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

const enc = new TextEncoder();

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

/** Fresh Ed25519 keypair shaped like the Fidacy JWKS. */
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

/** Sign a JSON event as a compact EdDSA JWS (the x-fidacy-signature header value). */
export async function signEvent(key: TestKey, event: unknown): Promise<string> {
  return new CompactSign(enc.encode(JSON.stringify(event)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'application/json' })
    .sign(key.privateKey);
}

/** A JWKS fetch mock returning the given keys (used by webhook verification). */
export function jwksFetch(...keys: TestKey[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ keys: keys.map((k) => k.publicJwk) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** A minimal AssessResult-shaped 200 body. */
export function sampleAssess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision: 'approve',
    score: 91,
    assessmentId: 'asmt_123',
    mandateId: 'mnd_123',
    riskPayload: { decision: 'approve' },
    riskPayloadJws: 'eyJ...jws',
    signingKeyId: 'key-1',
    signals: { velocity: 'ok' },
    mandate: { amount: 100 },
    outcome: { status: 'approved' },
    ...overrides,
  };
}
