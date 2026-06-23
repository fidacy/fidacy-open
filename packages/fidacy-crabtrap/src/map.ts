/**
 * map.ts — turn a `CrabTrapDecision` into a Fidacy `custom` mandate.
 *
 * Mapping = Option A (risk-zero): we map the CrabTrap decision to a Fidacy
 * `kind:'custom'` action and let Fidacy issue its OWN signed verdict. The
 * CrabTrap local decision/reason/policy travel as CONTEXT in `upstream` — they
 * pass validation because the `custom` schema does not set
 * `additionalProperties:false`. NO engine change, NO redeploy.
 *
 * The `payload_hash` is the sha-256 of a deterministic (key-sorted) JSON of the
 * request, so the same request hashes identically every time.
 */
import { createHash } from 'node:crypto';
import type { CrabTrapDecision, CustomMandate } from './types.js';

/** A tiny, dependency-free, deterministic JSON serializer (keys sorted recursively). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

/** sha-256 of `input`, lowercase hex (64 chars). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Best-effort host extraction. CrabTrap urls are normally absolute, but we
 * guard an invalid/relative URL rather than throwing inside the mapper.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface MapOptions {
  /** Override the `principal`. Defaults to the agent id (or 'unknown'). */
  principal?: string;
}

/** Map a normalized decision to a Fidacy `custom` mandate. */
export function toCustomMandate(d: CrabTrapDecision, opts: MapOptions = {}): CustomMandate {
  const actorAgent = d.agentId || 'unknown';
  const requestedAt = Math.floor(Date.parse(d.occurredAt) / 1000);

  return {
    kind: 'custom',
    actor_agent: actorAgent,
    principal: opts.principal ?? actorAgent,
    payload_hash: sha256Hex(
      canonicalJson({
        method: d.request.method,
        url: d.request.url,
        headers: d.request.headersRedacted,
      }),
    ),
    scope: `${d.request.method} ${hostOf(d.request.url)}`.trim(),
    ...(Number.isFinite(requestedAt) ? { requested_at: requestedAt } : {}),
    upstream: {
      source: 'crabtrap',
      local_decision: d.decision,
      local_reason: d.reason,
      policy_id: d.policyId ?? null,
      approved_by: d.meta?.approvedBy ?? null,
    },
  };
}
