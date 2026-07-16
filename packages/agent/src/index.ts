/**
 * @fidacy/agent
 *
 * A universal Fidacy trust guard for any AI agent runtime. You give it an agent
 * ACTION (who is acting, on whose behalf, and what the action is); it asks Fidacy
 * for a cryptographically signed verdict (approve / review / deny) and verifies
 * that signature against Fidacy's public JWKS before handing it back. Anyone can
 * re-check the verdict later with `@fidacy/verify`, without trusting you and
 * without a Fidacy account.
 *
 * Framework-agnostic by design: the action is structurally typed and the only
 * runtime dependency is `@fidacy/sdk`. Hashing uses Web Crypto
 * (`crypto.subtle.digest`), which is available in Node 18+, the browser, and
 * edge runtimes, so this package imports no Node-only modules.
 *
 * The API key is held by the underlying SDK client and is NEVER logged, included
 * in any error, or folded into a verdict.
 */
import {
  type AssessResult,
  Fidacy,
  type FidacyOptions as SdkFidacyOptions,
  verifyRiskPayload,
} from '@fidacy/sdk';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One agent action to be assessed. This is the universal mapping every adapter
 * (OpenClaw, Hermes, Claude Code, ...) reduces its native action to.
 */
export interface AgentAction {
  /** The agent taking the action (DID / id / key id). Maps to `actor_agent`. */
  agent: string;
  /** On whose behalf the action runs (org / user / wallet). Maps to `principal`. */
  principal: string;
  /** Semantic label for the action. Default `'custom'`. */
  type?: 'payment' | 'message' | 'tool' | 'custom';
  /** The action payload. Hashed (sha-256, hex, prefixed `sha256:`) to `payload_hash`. */
  payload?: unknown;
  /** A precomputed `payload_hash` (takes precedence over hashing `payload`). */
  payloadHash?: string;
  /** Optional authorized scope. */
  scope?: string;
  /** Optional RFC 7800 key-binding (proof of possession). */
  cnf?: { jwk: unknown };
  /** Optional declared issuer DID. */
  iss?: string;
  /** Free-form context; folded into the hashed payload. */
  meta?: Record<string, unknown>;
}

/** The signed, verified verdict for one action. */
export interface Verdict {
  decision: 'approve' | 'review' | 'deny';
  /** `true` iff `decision === 'approve'`. */
  allowed: boolean;
  score: number;
  assessmentId: string;
  /** The signed verdict (compact EdDSA JWS). Hand this to anyone to re-verify. */
  riskPayloadJws: string;
  signingKeyId: string;
  /** `verifyRiskPayload(jws)` succeeded against the public JWKS. */
  verified: boolean;
  /** Rejection reasons from the outcome (`key` or `message`); `[]` if none. */
  reasons: string[];
  /** The full underlying SDK result, untouched. */
  raw: AssessResult;
}

export interface FidacyGuardOptions {
  /** Public API key, e.g. `fky_live_…` / `fky_test_…`. Held by the SDK client. */
  apiKey: string;
  /** API base URL. Default `https://api.fidacy.com`. */
  baseUrl?: string;
  /** Verify each verdict's signature against the public JWKS. Default `true`. */
  verify?: boolean;
  /** Inject a pre-built `Fidacy` client (tests / reuse). Takes precedence. */
  fidacy?: Fidacy;
}

/** Thrown by `guard()` when the verdict is `deny`. */
export class FidacyDenied extends Error {
  readonly verdict: Verdict;
  constructor(verdict: Verdict) {
    super(`Fidacy denied the action (score ${verdict.score})`);
    this.name = 'FidacyDenied';
    this.verdict = verdict;
  }
}

/** Thrown by `guard()` when the verdict is `review` and `onReview` is not `'allow'`. */
export class FidacyReview extends Error {
  readonly verdict: Verdict;
  constructor(verdict: Verdict) {
    super(`Fidacy flagged the action for review (score ${verdict.score})`);
    this.name = 'FidacyReview';
    this.verdict = verdict;
  }
}

// ---------------------------------------------------------------------------
// The custom mandate the engine accepts for non-payment agent actions
// ---------------------------------------------------------------------------

interface CustomMandate {
  kind: 'custom';
  actor_agent: string;
  principal: string;
  payload_hash: string;
  scope?: string;
  requested_at?: number;
  cnf?: { jwk: unknown };
  iss?: string;
}

// ---------------------------------------------------------------------------
// Universal, dependency-free hashing helpers (Web Crypto)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted recursively so two structurally equal
 * payloads always hash to the same digest. `undefined` members are dropped (as
 * `JSON.stringify` already does for object values).
 */
function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** sha-256 of a string, hex-encoded, using Web Crypto (no node:crypto import). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

// ---------------------------------------------------------------------------
// Mapping + verdict assembly
// ---------------------------------------------------------------------------

/**
 * Build the universal `custom` mandate from an `AgentAction`. Exported so callers
 * and adapters can inspect (or log, sans secrets) exactly what will be assessed.
 */
export async function buildMandate(action: AgentAction): Promise<CustomMandate> {
  const payloadHash =
    action.payloadHash ??
    `sha256:${await sha256Hex(
      canonicalJSON({
        type: action.type ?? 'custom',
        payload: action.payload,
        meta: action.meta,
      }),
    )}`;

  const mandate: CustomMandate = {
    kind: 'custom',
    actor_agent: action.agent,
    principal: action.principal,
    payload_hash: payloadHash,
  };
  if (action.scope !== undefined) mandate.scope = action.scope;
  if (action.cnf !== undefined) mandate.cnf = action.cnf;
  if (action.iss !== undefined) mandate.iss = action.iss;
  mandate.requested_at = Math.floor(Date.now() / 1000);
  return mandate;
}

function extractReasons(outcome: unknown): string[] {
  if (typeof outcome !== 'object' || outcome === null) return [];
  const raw = (outcome as { rejection_reasons?: unknown }).rejection_reasons;
  if (!Array.isArray(raw)) return [];
  const reasons: string[] = [];
  for (const r of raw) {
    if (typeof r === 'string') {
      reasons.push(r);
    } else if (r !== null && typeof r === 'object') {
      const obj = r as { key?: unknown; message?: unknown };
      const value =
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.key === 'string'
            ? obj.key
            : undefined;
      if (value !== undefined) reasons.push(value);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export class FidacyGuard {
  private readonly fidacy: Fidacy;
  private readonly shouldVerify: boolean;

  constructor(opts: FidacyGuardOptions) {
    this.shouldVerify = opts.verify !== false;
    if (opts.fidacy) {
      this.fidacy = opts.fidacy;
    } else {
      const sdkOptions: SdkFidacyOptions = { apiKey: opts.apiKey };
      if (opts.baseUrl !== undefined) sdkOptions.baseUrl = opts.baseUrl;
      this.fidacy = new Fidacy(sdkOptions);
    }
  }

  /**
   * Assess one action and return the signed, verified verdict. Never throws on a
   * `deny` or `review`: that is a verdict, not an error. Throws only on transport
   * or auth errors raised by the SDK.
   */
  async check(action: AgentAction): Promise<Verdict> {
    const mandate = await buildMandate(action);
    const result = await this.fidacy.assess({ kind: 'custom', mandate });

    let verified = false;
    if (this.shouldVerify) {
      try {
        const v = await verifyRiskPayload(result.riskPayloadJws);
        verified = v.valid === true;
      } catch {
        // A failed verification is a property of the verdict, not a thrown error.
        verified = false;
      }
    }

    return {
      decision: result.decision,
      allowed: result.decision === 'approve',
      score: result.score,
      assessmentId: result.assessmentId,
      riskPayloadJws: result.riskPayloadJws,
      signingKeyId: result.signingKeyId,
      verified,
      reasons: extractReasons(result.outcome),
      raw: result,
    };
  }

  /**
   * Gate an action: run `proceed` only when the verdict allows it.
   *  - `approve` → run `proceed`, return its value.
   *  - `deny`    → throw `FidacyDenied`.
   *  - `review`  → throw `FidacyReview`, unless `opts.onReview === 'allow'`.
   */
  async guard<T>(
    action: AgentAction,
    proceed: () => Promise<T> | T,
    opts?: { onReview?: 'allow' | 'block' },
  ): Promise<T> {
    const verdict = await this.check(action);
    if (verdict.decision === 'deny') throw new FidacyDenied(verdict);
    if (verdict.decision === 'review' && opts?.onReview !== 'allow') {
      throw new FidacyReview(verdict);
    }
    return proceed();
  }
}

// Injected at build time from package.json (see tsup.config.ts define) so it can
// never drift from the published version. Dev/test runs fall back to "dev".
declare const __PKG_VERSION__: string | undefined;
export const VERSION: string =
  typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : 'dev';
