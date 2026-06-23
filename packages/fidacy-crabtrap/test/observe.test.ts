import { describe, expect, it } from 'vitest';
import { observe } from '../src/index.js';
import { normalizeAuditEntry } from '../src/normalize.js';
import type { CrabTrapDecision, Logger, VerdictRecord } from '../src/types.js';
import {
  arraySource,
  demoAssessor,
  denyAuditEntry,
  makeDemoKey,
  staticRuleAuditEntry,
  throwingAssessor,
} from './fixtures.js';

function captureLogger(): { logger: Logger; warns: string[]; errors: string[] } {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warns,
    errors,
    logger: {
      warn: (m) => warns.push(m),
      error: (m) => errors.push(m),
    },
  };
}

describe('observe (happy path)', () => {
  it('emits a signed verdict record per decision with header when enabled', async () => {
    const key = await makeDemoKey();
    const decisions: CrabTrapDecision[] = [normalizeAuditEntry(denyAuditEntry())];
    const records: VerdictRecord[] = [];

    await observe({
      source: arraySource(decisions),
      assessor: demoAssessor(key),
      attachHeader: true,
      onVerdict: (r) => {
        records.push(r);
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0].fidacy).not.toBeNull();
    expect(records[0].fidacy?.decision).toBe('deny');
    expect(records[0].header?.['X-Fidacy-Verdict']).toBe(records[0].fidacy?.riskPayloadJws);
  });
});

describe('observe (fail-safe)', () => {
  it('a throwing assessor does NOT reject observe; logs + emits fallback review; loop survives', async () => {
    const decisions: CrabTrapDecision[] = [
      normalizeAuditEntry(denyAuditEntry()),
      normalizeAuditEntry(staticRuleAuditEntry()),
    ];
    const records: VerdictRecord[] = [];
    const cap = captureLogger();

    // observe must resolve, not throw, even though assess always throws.
    await expect(
      observe({
        source: arraySource(decisions),
        assessor: throwingAssessor('engine down'),
        logger: cap.logger,
        onVerdict: (r) => {
          records.push(r);
        },
      }),
    ).resolves.toBeUndefined();

    // Both events still produced a (fallback) record — the loop survived.
    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.fidacy).toBeNull();
      expect(r.fallback).toBe('review');
      expect(r.error).toBe('engine down');
    }
    expect(cap.warns.length).toBe(2);
  });

  it('a good event after a failed one still processes (mixed stream)', async () => {
    const key = await makeDemoKey();
    let calls = 0;
    const flakyAssessor = {
      async assess(params: Parameters<ReturnType<typeof demoAssessor>['assess']>[0]) {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return demoAssessor(key).assess(params);
      },
    };
    const decisions: CrabTrapDecision[] = [
      normalizeAuditEntry(denyAuditEntry()),
      normalizeAuditEntry(staticRuleAuditEntry()),
    ];
    const records: VerdictRecord[] = [];

    await observe({
      source: arraySource(decisions),
      assessor: flakyAssessor,
      logger: captureLogger().logger,
      onVerdict: (r) => {
        records.push(r);
      },
    });

    expect(records).toHaveLength(2);
    expect(records[0].fidacy).toBeNull(); // first failed → fallback
    expect(records[1].fidacy).not.toBeNull(); // second succeeded
  });

  it('a throwing onVerdict handler does not kill the loop', async () => {
    const key = await makeDemoKey();
    const cap = captureLogger();
    let seen = 0;

    await expect(
      observe({
        source: arraySource([
          normalizeAuditEntry(denyAuditEntry()),
          normalizeAuditEntry(staticRuleAuditEntry()),
        ]),
        assessor: demoAssessor(key),
        logger: cap.logger,
        onVerdict: () => {
          seen += 1;
          throw new Error('consumer blew up');
        },
      }),
    ).resolves.toBeUndefined();

    expect(seen).toBe(2);
    expect(cap.errors.length).toBe(2);
  });
});
