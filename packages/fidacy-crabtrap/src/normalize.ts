/**
 * normalize.ts — turn a raw CrabTrap audit entry into a `CrabTrapDecision`.
 *
 * Responsibilities:
 *  - lowercase the decision (`ALLOW|DENY|TIMEOUT` → `allow|deny|timeout`)
 *  - derive a human `reason` (llm_reason, else a label from approved_by)
 *  - DEFENSIVELY redact sensitive headers (even though SSE pre-redacts, so the
 *    same normalizer is safe for the future Postgres/REST sources)
 *  - map `llm_policy_id` → `policyId` (only present when channel === 'llm')
 */
import type { CrabTrapAuditEntry, CrabTrapDecision } from './types.js';

/** Header NAMES that are always secret. */
const EXACT_SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;
/** Header NAMES that contain a sensitive substring. */
const SUBSTRING_SENSITIVE = /token|secret|api[-_]?key|bearer|auth|cookie|session/i;

const REDACTED = '[REDACTED]';

/** Strip any header whose name looks like a credential. Never forwards secrets. */
export function redactHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    if (EXACT_SENSITIVE.test(name) || SUBSTRING_SENSITIVE.test(name)) {
      out[name] = REDACTED;
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** Lowercase CrabTrap's UPPERCASE decision; default unknowns to `timeout` (fail-closed-ish). */
function normalizeDecision(raw: string | undefined): CrabTrapDecision['decision'] {
  switch ((raw ?? '').toUpperCase()) {
    case 'ALLOW':
      return 'allow';
    case 'DENY':
      return 'deny';
    case 'TIMEOUT':
      return 'timeout';
    default:
      // Unknown/absent → treat as a timeout (no clean allow/deny signal).
      return 'timeout';
  }
}

/** Derive a label from `approved_by` when there is no `llm_reason`. */
function reasonFromApprovedBy(approvedBy: string | undefined): string {
  switch (approvedBy) {
    case 'llm-static-rule':
      return 'matched static rule';
    case 'passthrough':
    case 'llm-fallback':
      return 'llm judge unavailable, passthrough';
    case 'cache':
      return 'cache hit';
    case 'llm':
      return 'llm judge decision';
    case 'system':
      return 'system decision';
    default:
      return '';
  }
}

/** Map a raw CrabTrap SSE audit entry to the adapter's internal contract. */
export function normalizeAuditEntry(raw: CrabTrapAuditEntry): CrabTrapDecision {
  const reason =
    typeof raw.llm_reason === 'string' && raw.llm_reason.length > 0
      ? raw.llm_reason
      : reasonFromApprovedBy(raw.approved_by);

  const decision: CrabTrapDecision = {
    agentId: typeof raw.user_id === 'string' ? raw.user_id : '',
    request: {
      method: typeof raw.method === 'string' ? raw.method : '',
      url: typeof raw.url === 'string' ? raw.url : '',
      headersRedacted: redactHeaders(raw.request_headers),
    },
    decision: normalizeDecision(raw.decision),
    reason,
    occurredAt: typeof raw.timestamp === 'string' ? raw.timestamp : '',
    source: 'crabtrap',
    meta: {
      ...(typeof raw.request_id === 'string' ? { requestId: raw.request_id } : {}),
      ...(typeof raw.approved_by === 'string' ? { approvedBy: raw.approved_by } : {}),
      ...(typeof raw.channel === 'string' ? { channel: raw.channel } : {}),
    },
  };

  // policyId only exists when CrabTrap routed through the LLM channel.
  if (typeof raw.llm_policy_id === 'string' && raw.llm_policy_id.length > 0) {
    decision.policyId = raw.llm_policy_id;
  }

  return decision;
}
