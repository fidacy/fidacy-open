import { describe, expect, it } from 'vitest';
import { normalizeAuditEntry, redactHeaders } from '../src/normalize.js';
import { denyAuditEntry, staticRuleAuditEntry, timeoutAuditEntry } from './fixtures.js';

describe('normalizeAuditEntry', () => {
  it('DENY + llm_reason + secret header → deny, reason from llm_reason, header redacted', () => {
    const d = normalizeAuditEntry(denyAuditEntry());

    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('amount exceeds per-transaction policy limit');
    expect(d.agentId).toBe('agent@company.com');
    expect(d.source).toBe('crabtrap');
    expect(d.occurredAt).toBe('2026-06-22T10:00:00Z');
    expect(d.policyId).toBe('pol_42');
    expect(d.request.method).toBe('POST');
    expect(d.request.url).toBe('https://api.vendor.com/v1/charges');
    // Authorization stripped; safe header preserved.
    expect(d.request.headersRedacted.Authorization).toBe('[REDACTED]');
    expect(d.request.headersRedacted['content-type']).toBe('application/json');
    expect(d.meta?.requestId).toBe('req_abc');
    expect(d.meta?.approvedBy).toBe('llm');
    expect(d.meta?.channel).toBe('llm');
  });

  it('TIMEOUT entry → decision timeout; passthrough reason from approved_by', () => {
    const d = normalizeAuditEntry(timeoutAuditEntry());
    expect(d.decision).toBe('timeout');
    // empty llm_reason + approved_by 'llm-fallback' → passthrough label
    expect(d.reason).toBe('llm judge unavailable, passthrough');
    expect(d.policyId).toBeUndefined();
  });

  it('static-rule ALLOW with empty llm_reason → reason derived from approved_by', () => {
    const d = normalizeAuditEntry(staticRuleAuditEntry());
    expect(d.decision).toBe('allow');
    expect(d.reason).toBe('matched static rule');
    expect(d.policyId).toBeUndefined();
  });

  it('absent user_id → empty agentId', () => {
    const d = normalizeAuditEntry({ decision: 'ALLOW', operation: 'ADMIN' });
    expect(d.agentId).toBe('');
  });
});

describe('redactHeaders', () => {
  it('redacts exact + substring sensitive names, keeps the rest', () => {
    const out = redactHeaders({
      Authorization: 'Bearer t',
      'Proxy-Authorization': 'x',
      Cookie: 'sid=1',
      'X-Api-Key': 'k',
      'X-Session-Token': 't',
      'X-Auth-Foo': 'a',
      Accept: 'application/json',
      'user-agent': 'crabtrap/1',
    });
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out['Proxy-Authorization']).toBe('[REDACTED]');
    expect(out.Cookie).toBe('[REDACTED]');
    expect(out['X-Api-Key']).toBe('[REDACTED]');
    expect(out['X-Session-Token']).toBe('[REDACTED]');
    expect(out['X-Auth-Foo']).toBe('[REDACTED]');
    expect(out.Accept).toBe('application/json');
    expect(out['user-agent']).toBe('crabtrap/1');
  });

  it('null/undefined → empty object', () => {
    expect(redactHeaders(null)).toEqual({});
    expect(redactHeaders(undefined)).toEqual({});
  });
});
