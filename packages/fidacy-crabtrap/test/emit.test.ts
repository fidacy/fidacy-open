import { describe, expect, it } from 'vitest';
import { VERDICT_HEADER, attachVerdict, fallbackRecord } from '../src/emit.js';
import { normalizeAuditEntry } from '../src/normalize.js';
import type { FidacyVerdict } from '../src/types.js';
import { denyAuditEntry } from './fixtures.js';

const verdict: FidacyVerdict = {
  decision: 'deny',
  score: 90,
  riskPayloadJws: 'header.payload.sig',
  signingKeyId: 'kid-1',
};

describe('attachVerdict', () => {
  it('record has both crabtrap and fidacy sections', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const rec = attachVerdict(d, verdict);
    expect(rec.crabtrap).toBe(d);
    expect(rec.fidacy).toBe(verdict);
    expect(rec.fallback).toBeUndefined();
    expect(rec.header).toBeUndefined();
  });

  it('header X-Fidacy-Verdict equals the jws when attachHeader is on', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const rec = attachVerdict(d, verdict, { attachHeader: true });
    expect(rec.header).toEqual({ [VERDICT_HEADER]: 'header.payload.sig' });
    expect(VERDICT_HEADER).toBe('X-Fidacy-Verdict');
  });
});

describe('fallbackRecord', () => {
  it('emits a review fallback with fidacy:null and the error', () => {
    const d = normalizeAuditEntry(denyAuditEntry());
    const rec = fallbackRecord(d, 'assess timed out');
    expect(rec.fidacy).toBeNull();
    expect(rec.fallback).toBe('review');
    expect(rec.error).toBe('assess timed out');
  });
});
