/**
 * assessor.ts — the LIVE Fidacy assessor, wrapping `@fidacy/sdk`.
 *
 * `observe()` depends on the `FidacyAssessor` interface, not the SDK directly,
 * so tests and the offline example can inject a stub. This module is the only
 * place that touches the real SDK; the live path calls `/v1/assess` with the
 * org-scoped API key and returns the signed verdict.
 */
import { Fidacy, type FidacyOptions } from '@fidacy/sdk';
import type { CustomMandate, FidacyAssessor, FidacyVerdict } from './types.js';

export interface SdkAssessorOptions extends FidacyOptions {
  /** Provide a pre-built client instead of constructing one (tests / reuse). */
  client?: Fidacy;
}

/**
 * Build a `FidacyAssessor` backed by the real Fidacy SDK.
 *
 * The SDK's `assess()` types `kind` for `ap2_payment`; the public API accepts
 * `kind:'custom'` too, so we cast the params at this single, audited boundary.
 */
export function sdkAssessor(options: SdkAssessorOptions): FidacyAssessor {
  const { client, ...fidacyOptions } = options;
  const fidacy = client ?? new Fidacy(fidacyOptions);

  return {
    async assess(params: {
      kind: 'custom';
      mandate: CustomMandate;
      idempotencyKey?: string;
    }): Promise<FidacyVerdict> {
      const result = await fidacy.assess({
        // `kind:'custom'` is a valid public action; the SDK's static type is
        // narrower than the API, so we widen at this single boundary.
        kind: 'custom' as unknown as 'ap2_payment',
        mandate: params.mandate,
        ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
      });

      return {
        decision: result.decision,
        score: result.score,
        riskPayloadJws: result.riskPayloadJws,
        signingKeyId: result.signingKeyId,
      };
    },
  };
}
