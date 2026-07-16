/**
 * @fidacy/crabtrap
 *
 * Observe-mode adapter that puts a neutral, portable, signed Fidacy verdict on
 * top of Brex CrabTrap's LOCAL audit decisions. It is NON-BLOCKING: a failed
 * assessment never throws out of the loop and the CrabTrap flow is never
 * altered. The adapter only CALLS Fidacy's public `/v1/assess` and VERIFIES the
 * returned public JWS — the engine's private key is never referenced here.
 *
 * Architecture:
 *  - `observe()` is SOURCE-AGNOSTIC: it consumes a normalized stream of
 *    `CrabTrapDecision`s. The SSE client (`sseSource`) is one pluggable ingest.
 *  - The Fidacy assessor is DEPENDENCY-INJECTED (the `FidacyAssessor` iface), so
 *    tests + the offline example inject a stub and the live path injects
 *    `sdkAssessor` (the real `@fidacy/sdk`).
 *
 * NOTE ON BREX: this is an independent, MIT, complement to Brex CrabTrap. It is
 * NOT endorsed by, official to, or partnered with Brex. It does not claim Brex
 * uses Fidacy.
 */
import { attachVerdict, fallbackRecord } from './emit.js';
import { toCustomMandate } from './map.js';
import type { Logger, ObserveDeps, VerdictRecord } from './types.js';

const consoleLogger: Logger = {
  warn: (message, meta) => console.warn(`[crabtrap] ${message}`, meta ?? ''),
  error: (message, meta) => console.error(`[crabtrap] ${message}`, meta ?? ''),
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Observe CrabTrap decisions and emit a signed Fidacy verdict for each.
 *
 * For each decision: normalize (done by the source) → map to a `custom`
 * mandate → `assessor.assess(...)` → `attachVerdict` → `onVerdict`.
 *
 * FAIL-SAFE: if `assess` throws/times out, the error is logged and a fallback
 * `review` record (`fidacy:null`) is emitted; the loop survives and keeps
 * processing later events. `observe()` never rejects on a single bad event.
 *
 * Resolves when the source is exhausted (a bounded source) — a live SSE source
 * runs until aborted.
 */
export async function observe(deps: ObserveDeps): Promise<void> {
  const logger = deps.logger ?? consoleLogger;

  for await (const decision of deps.source) {
    let record: VerdictRecord;
    try {
      const mandate = toCustomMandate(decision, deps.mapOptions ?? {});
      const verdict = await deps.assessor.assess({ kind: 'custom', mandate });
      record = attachVerdict(decision, verdict, { attachHeader: deps.attachHeader });
    } catch (err) {
      const message = errorMessage(err);
      logger.warn('assess failed; emitting fallback review verdict', {
        agentId: decision.agentId,
        requestId: decision.meta?.requestId,
        error: message,
      });
      record = fallbackRecord(decision, message);
    }

    if (deps.onVerdict) {
      try {
        await deps.onVerdict(record);
      } catch (err) {
        // A throwing consumer must not kill the observe loop either.
        logger.error('onVerdict handler threw', { error: errorMessage(err) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API re-exports.
// ---------------------------------------------------------------------------

export { normalizeAuditEntry, redactHeaders } from './normalize.js';
export { toCustomMandate, sha256Hex, canonicalJson } from './map.js';
export type { MapOptions } from './map.js';
export { sseSource, parseSseBlock } from './ingest.js';
export type { SseSourceOptions } from './ingest.js';
export { attachVerdict, fallbackRecord, VERDICT_HEADER } from './emit.js';
export {
  verifyVerdict,
  assertKidInTrustList,
  TrustListError,
} from './verify.js';
export type {
  VerifyVerdictResult,
  TrustList,
  TrustListKey,
  AssertKidOptions,
} from './verify.js';
export { sdkAssessor } from './assessor.js';
export type { SdkAssessorOptions } from './assessor.js';
export { assertPublicUrl, isBlockedHost, SsrfBlockedError } from './ssrf.js';

export type {
  CrabTrapAuditEntry,
  CrabTrapDecision,
  CustomMandate,
  FidacyAssessor,
  FidacyVerdict,
  VerdictRecord,
  Logger,
  ObserveDeps,
} from './types.js';

// Injected at build time from package.json (see tsup.config.ts define) so it can
// never drift from the published version. Dev/test runs fall back to "dev".
declare const __PKG_VERSION__: string | undefined;
export const VERSION: string =
  typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : 'dev';
