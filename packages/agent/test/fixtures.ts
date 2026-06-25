/**
 * Test fixtures — a fake `Fidacy` client returning canned `AssessResult`s, so
 * the guard can be exercised with zero network. No real keys, no real API.
 *
 * The fake is structurally compatible with the bits of `@fidacy/sdk`'s `Fidacy`
 * the guard actually uses (`assess`), and records the last mandate it received
 * so tests can assert the universal `custom` mapping is built correctly.
 */
import type { AssessParams, AssessResult, Fidacy } from '@fidacy/sdk';

export interface FakeFidacy extends Pick<Fidacy, 'assess'> {
  /** The last `assess` params the fake received (for mapping assertions). */
  lastParams: AssessParams | undefined;
  /** How many times `assess` was called. */
  calls: number;
}

/** Build a canned `AssessResult` with a given decision. */
export function cannedResult(
  decision: 'approve' | 'review' | 'deny',
  overrides: Partial<AssessResult> = {},
): AssessResult {
  const score = decision === 'deny' ? 91 : decision === 'review' ? 55 : 8;
  const outcome =
    decision === 'approve'
      ? {}
      : {
          rejection_reasons: [
            { key: 'amount_over_limit', message: 'amount exceeds the per-transaction policy limit' },
          ],
        };
  return {
    decision,
    score,
    assessmentId: `asmt_${decision}_1`,
    mandateId: `mnd_${decision}_1`,
    riskPayloadJws: `header.${decision}.signature`,
    riskPayload: { decision, score },
    signingKeyId: 'kid_demo_1',
    signals: {},
    mandate: {},
    outcome,
    ...overrides,
  };
}

/**
 * A fake `Fidacy` that always returns `result` (or a per-call function of the
 * params). It implements only `assess`; cast to `Fidacy` at the injection point.
 */
export function fakeFidacy(
  result: AssessResult | ((params: AssessParams) => AssessResult),
): FakeFidacy {
  const fake: FakeFidacy = {
    lastParams: undefined,
    calls: 0,
    async assess(params: AssessParams): Promise<AssessResult> {
      fake.lastParams = params;
      fake.calls += 1;
      return typeof result === 'function' ? result(params) : result;
    },
  };
  return fake;
}

/** The `custom` mandate shape, for typed assertions in tests. */
export interface CustomMandateShape {
  kind: 'custom';
  actor_agent: string;
  principal: string;
  payload_hash: string;
  scope?: string;
  requested_at?: number;
  cnf?: { jwk: unknown };
  iss?: string;
}
