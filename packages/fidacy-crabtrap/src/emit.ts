/**
 * emit.ts — assemble the "Verdict Container" record and the transport header.
 *
 * `attachVerdict` joins the original CrabTrap decision with the Fidacy verdict.
 * When `attachHeader` is on, it also exposes the signed JWS as an
 * `X-Fidacy-Verdict` HTTP header value so a proxy/gateway can forward it.
 */
import type { CrabTrapDecision, FidacyVerdict, VerdictRecord } from './types.js';

export const VERDICT_HEADER = 'X-Fidacy-Verdict';

/** Build a record carrying both the CrabTrap decision and the Fidacy verdict. */
export function attachVerdict(
  crabtrap: CrabTrapDecision,
  verdict: FidacyVerdict,
  options: { attachHeader?: boolean } = {},
): VerdictRecord {
  const record: VerdictRecord = {
    crabtrap,
    fidacy: verdict,
  };
  if (options.attachHeader) {
    record.header = { [VERDICT_HEADER]: verdict.riskPayloadJws };
  }
  return record;
}

/**
 * Build the fail-safe record for when the assessor failed. The CrabTrap flow is
 * never altered; the adapter's fallback semantic decision is `review` (floor).
 */
export function fallbackRecord(
  crabtrap: CrabTrapDecision,
  error: string,
): VerdictRecord {
  return {
    crabtrap,
    fidacy: null,
    fallback: 'review',
    error,
  };
}
