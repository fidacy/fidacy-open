import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, toCustomMandate } from '../src/map.js';
import { normalizeAuditEntry } from '../src/normalize.js';
import { denyAuditEntry } from './fixtures.js';

// The REAL custom.v1.json required list (packages/action-schemas/schemas/custom.v1.json).
const CUSTOM_REQUIRED = ['kind', 'actor_agent', 'principal', 'payload_hash'] as const;

describe('toCustomMandate', () => {
  it('produces a valid custom mandate with all required fields non-empty', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const m = toCustomMandate(d, {});

    expect(m.kind).toBe('custom');
    for (const field of CUSTOM_REQUIRED) {
      expect(field in m).toBe(true);
      expect(typeof (m as Record<string, unknown>)[field]).toBe('string');
      expect(((m as Record<string, unknown>)[field] as string).length).toBeGreaterThan(0);
    }
    expect(m.actor_agent).toBe('agent@company.com');
    expect(m.principal).toBe('agent@company.com');
    // requested_at is epoch seconds.
    expect(m.requested_at).toBe(Math.floor(Date.parse('2026-06-22T10:00:00Z') / 1000));
    // scope is "METHOD host" (host only).
    expect(m.scope).toBe('POST api.vendor.com');
  });

  it('payload_hash is 64-char hex and deterministic for the same input', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const a = toCustomMandate(d, {});
    const b = toCustomMandate(d, {});
    expect(a.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.payload_hash).toBe(b.payload_hash);
  });

  it('different request → different payload_hash', () => {
    const d1 = normalizeAuditEntry(denyAuditEntry());
    const d2 = normalizeAuditEntry({ ...denyAuditEntry(), url: 'https://api.vendor.com/other' });
    expect(toCustomMandate(d1).payload_hash).not.toBe(toCustomMandate(d2).payload_hash);
  });

  it('upstream carries the CrabTrap local decision / reason / policy', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const m = toCustomMandate(d, {});
    expect(m.upstream).toEqual({
      source: 'crabtrap',
      local_decision: 'deny',
      local_reason: 'amount exceeds per-transaction policy limit',
      policy_id: 'pol_42',
      approved_by: 'llm',
    });
  });

  it('explicit principal overrides the agent id', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const m = toCustomMandate(d, { principal: 'org:acme' });
    expect(m.principal).toBe('org:acme');
    expect(m.actor_agent).toBe('agent@company.com');
  });

  it('empty agentId falls back to "unknown" for actor_agent + principal', () => {
    const d = normalizeAuditEntry({ decision: 'ADMIN', timestamp: '2026-06-22T10:00:00Z', method: 'GET', url: 'https://x.test/' });
    const m = toCustomMandate(d, {});
    expect(m.actor_agent).toBe('unknown');
    expect(m.principal).toBe('unknown');
  });

  it('guards an invalid URL in scope instead of throwing', () => {
    const d = normalizeAuditEntry({ decision: 'ALLOW', method: 'GET', url: 'not a url', timestamp: '2026-06-22T10:00:00Z', user_id: 'a@b.co' });
    expect(() => toCustomMandate(d)).not.toThrow();
    expect(toCustomMandate(d).scope).toBe('GET not a url');
  });
});

describe('canonicalJson', () => {
  it('is key-order independent (deterministic)', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1}}');
  });
});

describe('sha256Hex', () => {
  it('is a 64-char lowercase hex digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
