/**
 * @fidacy/crabtrap — shared types.
 *
 * The adapter is SOURCE-AGNOSTIC. Its internal contract is `CrabTrapDecision`
 * (the normalized shape). The SSE client over CrabTrap's `/admin/events` is one
 * pluggable ingest; a Postgres/REST source could feed the same normalizer
 * later. The core `observe()` only ever sees `CrabTrapDecision` values.
 */

// ---------------------------------------------------------------------------
// Raw CrabTrap audit entry (the JSON inside an `event: audit_entry` SSE frame)
// ---------------------------------------------------------------------------

/**
 * A raw CrabTrap AuditEntry as delivered over `GET /admin/events`.
 *
 * Over SSE, CrabTrap REDACTS the heavy/sensitive fields: `request_headers` and
 * `request_body`/`response_body` arrive as `null`/`""`. We still strip
 * defensively in the normalizer (see `normalize.ts`) so the same path is safe
 * for the non-SSE sources.
 *
 * Only the fields the adapter reads are typed precisely; everything else is
 * kept permissive via the index signature (forward-compat with CrabTrap).
 */
export interface CrabTrapAuditEntry {
  id?: string;
  timestamp?: string; // RFC3339
  user_id?: string; // agent identity — an EMAIL/STRING; may be empty for ADMIN ops
  request_id?: string;
  method?: string;
  url?: string;
  operation?: 'READ' | 'WRITE' | 'ADMIN' | string;
  decision?: 'ALLOW' | 'DENY' | 'TIMEOUT' | string; // UPPERCASE on the wire
  cache_hit?: boolean;
  approved_by?:
    | 'llm'
    | 'llm-static-rule'
    | 'passthrough'
    | 'cache'
    | 'llm-fallback'
    | 'system'
    | string;
  approved_at?: string;
  channel?: 'llm' | 'cache' | 'passthrough' | 'system' | string;
  response_status?: number;
  duration_ms?: number;
  error?: string;
  request_headers?: Record<string, string> | null; // null/absent over SSE
  request_body?: string; // "" over SSE
  response_headers?: Record<string, string> | null;
  response_body?: string;
  api_info?: unknown;
  llm_reason?: string; // may be empty
  llm_response_id?: string;
  llm_policy_id?: string; // only set when channel === 'llm'
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalized decision — the adapter's internal contract
// ---------------------------------------------------------------------------

export interface CrabTrapDecision {
  /** From `user_id`; `''` if absent. An email/string, NOT cryptographic. */
  agentId: string;
  request: {
    method: string;
    url: string;
    headersRedacted: Record<string, string>;
  };
  decision: 'allow' | 'deny' | 'timeout';
  reason: string;
  policyId?: string;
  /** ISO8601 (from `timestamp`). */
  occurredAt: string;
  source: 'crabtrap';
  meta?: {
    requestId?: string;
    approvedBy?: string;
    channel?: string;
  };
}

// ---------------------------------------------------------------------------
// Fidacy assessor — the dependency-injected verdict source
// ---------------------------------------------------------------------------

/** The Fidacy `custom` mandate produced from a CrabTrapDecision (see `map.ts`). */
export interface CustomMandate {
  kind: 'custom';
  actor_agent: string;
  principal: string;
  payload_hash: string;
  scope?: string;
  requested_at?: number;
  upstream?: {
    source: 'crabtrap';
    local_decision: 'allow' | 'deny' | 'timeout';
    local_reason: string;
    policy_id: string | null;
    approved_by: string | null;
  };
  [k: string]: unknown;
}

/** The subset of a Fidacy assessment the adapter depends on. */
export interface FidacyVerdict {
  decision: 'approve' | 'review' | 'deny';
  score: number;
  riskPayloadJws: string;
  signingKeyId: string;
  [k: string]: unknown;
}

/**
 * The injected verdict source. The live path wraps `@fidacy/sdk`'s
 * `Fidacy.assess`; tests and the offline example inject a stub (e.g. a DEMO
 * signer). `observe()` depends on this interface, never on the SDK directly.
 */
export interface FidacyAssessor {
  assess(params: {
    kind: 'custom';
    mandate: CustomMandate;
    idempotencyKey?: string;
  }): Promise<FidacyVerdict>;
}

// ---------------------------------------------------------------------------
// Emitted record — what `observe()` hands to `onVerdict`
// ---------------------------------------------------------------------------

/**
 * The "Verdict Container": the original CrabTrap decision plus the Fidacy
 * verdict (or `null` + a fallback when the assessor failed). Non-blocking: a
 * failed assessment never throws out of the observe loop.
 */
export interface VerdictRecord {
  crabtrap: CrabTrapDecision;
  fidacy: FidacyVerdict | null;
  /** Adapter fallback semantic when `fidacy` is null. The floor is `review`. */
  fallback?: 'review';
  /** Error message when the assessor failed (never includes secrets). */
  error?: string;
  /** Optional HTTP-style header carrying the signed verdict. */
  header?: { 'X-Fidacy-Verdict': string };
}

// ---------------------------------------------------------------------------
// observe() dependencies
// ---------------------------------------------------------------------------

export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ObserveDeps {
  /** A normalized stream of CrabTrap decisions (e.g. `sseSource(...)`). */
  source: AsyncIterable<CrabTrapDecision>;
  /** The injected verdict source. */
  assessor: FidacyAssessor;
  /** Options forwarded to `toCustomMandate` (e.g. an explicit `principal`). */
  mapOptions?: { principal?: string };
  /** Called for every produced record. May be async. */
  onVerdict?: (record: VerdictRecord) => void | Promise<void>;
  /** Attach the signed verdict as an `X-Fidacy-Verdict` header on the record. */
  attachHeader?: boolean;
  /** Optional structured logger. Defaults to a console-backed logger. */
  logger?: Logger;
}
