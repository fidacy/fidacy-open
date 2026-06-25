import type { Fidacy } from '@fidacy/sdk';
import { describe, expect, it } from 'vitest';
import {
  type AgentAction,
  FidacyDenied,
  FidacyGuard,
  FidacyReview,
  buildMandate,
} from '../src/index.js';
import { type CustomMandateShape, cannedResult, fakeFidacy } from './fixtures.js';

function guardWith(
  result: Parameters<typeof fakeFidacy>[0],
  opts: { verify?: boolean } = {},
): { guard: FidacyGuard; fake: ReturnType<typeof fakeFidacy> } {
  const fake = fakeFidacy(result);
  const guard = new FidacyGuard({
    apiKey: 'fky_test_unused',
    fidacy: fake as unknown as Fidacy,
    verify: opts.verify ?? false, // no real JWKS fetch in unit tests
  });
  return { guard, fake };
}

const ACTION: AgentAction = {
  agent: 'did:web:acme.com#agent-1',
  principal: 'org_acme',
  type: 'tool',
  payload: { tool: 'send_email', args: { to: 'x@y.com' } },
};

describe('FidacyGuard.check', () => {
  it('returns a Verdict with decision/allowed/score/reasons mapped (approve)', async () => {
    const { guard } = guardWith(cannedResult('approve'));
    const v = await guard.check(ACTION);
    expect(v.decision).toBe('approve');
    expect(v.allowed).toBe(true);
    expect(v.score).toBe(8);
    expect(v.assessmentId).toBe('asmt_approve_1');
    expect(v.signingKeyId).toBe('kid_demo_1');
    expect(v.reasons).toEqual([]);
    expect(v.raw.decision).toBe('approve');
  });

  it('maps rejection_reasons (key/message) to reasons on deny', async () => {
    const { guard } = guardWith(cannedResult('deny'));
    const v = await guard.check(ACTION);
    expect(v.decision).toBe('deny');
    expect(v.allowed).toBe(false);
    expect(v.reasons).toEqual(['amount exceeds the per-transaction policy limit']);
  });

  it('sets verified=false when verify:false (no JWKS fetch)', async () => {
    const { guard } = guardWith(cannedResult('approve'), { verify: false });
    const v = await guard.check(ACTION);
    expect(v.verified).toBe(false);
  });

  it('builds a custom mandate with actor_agent / principal / payload_hash', async () => {
    const { guard, fake } = guardWith(cannedResult('approve'));
    await guard.check(ACTION);
    const params = fake.lastParams;
    expect(params?.kind).toBe('custom');
    const mandate = params?.mandate as CustomMandateShape;
    expect(mandate.actor_agent).toBe(ACTION.agent);
    expect(mandate.principal).toBe(ACTION.principal);
    expect(mandate.payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(typeof mandate.requested_at).toBe('number');
  });

  it('honors a precomputed payloadHash over hashing the payload', async () => {
    const mandate = await buildMandate({
      agent: 'a',
      principal: 'p',
      payloadHash: 'sha256:deadbeef',
    });
    expect(mandate.payload_hash).toBe('sha256:deadbeef');
  });

  it('folds scope / cnf / iss into the mandate when present', async () => {
    const mandate = await buildMandate({
      agent: 'a',
      principal: 'p',
      payload: { x: 1 },
      scope: 'write:vendor',
      cnf: { jwk: { kty: 'OKP' } },
      iss: 'did:web:acme.com',
    });
    expect(mandate.scope).toBe('write:vendor');
    expect(mandate.cnf).toEqual({ jwk: { kty: 'OKP' } });
    expect(mandate.iss).toBe('did:web:acme.com');
  });

  it('produces a deterministic payload_hash regardless of key order', async () => {
    const a = await buildMandate({ agent: 'a', principal: 'p', payload: { x: 1, y: 2 } });
    const b = await buildMandate({ agent: 'a', principal: 'p', payload: { y: 2, x: 1 } });
    expect(a.payload_hash).toBe(b.payload_hash);
  });
});

describe('FidacyGuard.guard', () => {
  it('runs proceed and returns its value on approve', async () => {
    const { guard } = guardWith(cannedResult('approve'));
    const out = await guard.guard(ACTION, () => 'did-it');
    expect(out).toBe('did-it');
  });

  it('throws FidacyDenied on deny (and does not run proceed)', async () => {
    const { guard } = guardWith(cannedResult('deny'));
    let ran = false;
    await expect(
      guard.guard(ACTION, () => {
        ran = true;
        return 'nope';
      }),
    ).rejects.toBeInstanceOf(FidacyDenied);
    expect(ran).toBe(false);
  });

  it('attaches the verdict to FidacyDenied', async () => {
    const { guard } = guardWith(cannedResult('deny'));
    const err = await guard.guard(ACTION, () => 'x').catch((e) => e);
    expect(err).toBeInstanceOf(FidacyDenied);
    expect((err as FidacyDenied).verdict.decision).toBe('deny');
  });

  it('throws FidacyReview on review by default', async () => {
    const { guard } = guardWith(cannedResult('review'));
    await expect(guard.guard(ACTION, () => 'x')).rejects.toBeInstanceOf(FidacyReview);
  });

  it('runs proceed on review when onReview:allow', async () => {
    const { guard } = guardWith(cannedResult('review'));
    const out = await guard.guard(ACTION, () => 'allowed-under-review', { onReview: 'allow' });
    expect(out).toBe('allowed-under-review');
  });
});
