/**
 * @fidacy/sdk
 *
 * Thin, typed client for the public Fidacy API. Uses native `fetch` (Node 18+,
 * browser, edge) and re-exports `@fidacy/verify` so you can "verify it yourself".
 *
 * This package only calls the public API and verifies signatures. It NEVER
 * imports private/engine code. The API key is sent as a Bearer token and is
 * NEVER included in any error message or stack.
 */
import {
  type WebhookEvent,
  verifyRiskPayload,
  verifyWebhook,
} from '@fidacy/verify';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FidacyOptions {
  /** Public API key, e.g. `fky_live_…` / `fky_test_…`. Sent as a Bearer token. */
  apiKey: string;
  /** API base URL. Default `https://api.fidacy.com`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Max retries for idempotent calls. Default 2. */
  maxRetries?: number;
  /** Inject a `fetch` implementation (tests / custom runtimes). */
  fetch?: typeof fetch;
  /**
   * Override the backoff schedule (ms) for retry attempt `n` (0-based). Internal
   * hook, mainly for tests; defaults to exponential backoff with a small cap.
   */
  backoffMs?: (attempt: number) => number;
}

export type Decision = 'approve' | 'review' | 'deny';

export interface AssessParams {
  kind?: 'ap2_payment' | 'message_send' | 'voice_call' | 'custom' | 'claim_document';
  mandate: unknown;
  mandateType?: string;
  a2a?: { task_id: string };
  spendingMandate?: unknown;
  idempotencyKey?: string;
}

export interface RejectionReason {
  key: string;
  category?: string;
  message?: string;
  description?: string;
}

export interface AssessResult {
  decision: Decision;
  score: number;
  assessmentId: string;
  mandateId: string;
  riskPayloadJws: string;
  riskPayload: Record<string, unknown>;
  signingKeyId: string;
  signals: Record<string, unknown>;
  mandate: Record<string, unknown>;
  outcome: Record<string, unknown>;
  billing?: { tier: string; over_quota: boolean; usage: Record<string, unknown> };
  spend_guard?: Record<string, unknown>;
  a2a?: { recommended_task_state: string; task_metadata: Record<string, unknown> };
  [k: string]: unknown;
}

export interface BillingStatus {
  tier: string;
  billing_configured: boolean;
  usage: Record<string, unknown>;
  [k: string]: unknown;
}

export class FidacyError extends Error {
  readonly type: string;
  readonly status: number;
  readonly details?: unknown;
  readonly rejection_reasons?: RejectionReason[];

  constructor(args: {
    type: string;
    status: number;
    details?: unknown;
    rejection_reasons?: RejectionReason[];
  }) {
    // Static message — NEVER include the API key, body, or any secret.
    super(`Fidacy API error (${args.type}, HTTP ${args.status})`);
    this.name = 'FidacyError';
    this.type = args.type;
    this.status = args.status;
    this.details = args.details;
    this.rejection_reasons = args.rejection_reasons;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.fidacy.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 200;
const BACKOFF_CAP_MS = 2_000;

function defaultBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Extra headers (e.g. A2A-Version). */
  extraHeaders?: Record<string, string>;
  /** Whether this call may be retried on transient failures. */
  idempotent: boolean;
}

export class Fidacy {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly backoff: (attempt: number) => number;

  /** Re-export of `@fidacy/verify`'s `verifyRiskPayload` — "verify it yourself". */
  readonly verify: typeof verifyRiskPayload = verifyRiskPayload;

  readonly billing: {
    get(): Promise<BillingStatus>;
    checkout(p: { tier: 'startup' | 'growth' }): Promise<{ url: string }>;
  };

  readonly webhooks: {
    constructEvent(payload: string, signatureHeader: string): Promise<WebhookEvent>;
  };

  constructor(options: FidacyOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? fetch;
    this.backoff = options.backoffMs ?? defaultBackoff;

    this.billing = {
      get: () =>
        this.request<BillingStatus>({ method: 'GET', path: '/v1/billing', idempotent: true }),
      checkout: (p) =>
        this.request<{ url: string }>({
          method: 'POST',
          path: '/v1/billing/checkout',
          body: { tier: p.tier },
          // Checkout is NEVER retried — it may create a Stripe session.
          idempotent: false,
        }),
    };

    this.webhooks = {
      constructEvent: (payload, signatureHeader) =>
        verifyWebhook({
          payload,
          signatureHeader,
          jwksUrl: `${this.baseUrl}/.well-known/jwks.json`,
          fetch: this.fetchImpl,
        }),
    };
  }

  async assess(params: AssessParams, opts?: { a2aVersion?: string }): Promise<AssessResult> {
    const body: Record<string, unknown> = {
      kind: params.kind ?? 'ap2_payment',
      mandate: params.mandate,
    };
    if (params.mandateType !== undefined) body.mandateType = params.mandateType;
    if (params.a2a !== undefined) body.a2a = params.a2a;
    if (params.spendingMandate !== undefined) body.spending_mandate = params.spendingMandate;
    if (params.idempotencyKey !== undefined) body.idempotency_key = params.idempotencyKey;

    const extraHeaders = opts?.a2aVersion ? { 'A2A-Version': opts.a2aVersion } : undefined;

    return this.request<AssessResult>({
      method: 'POST',
      path: '/v1/assess',
      body,
      extraHeaders,
      // Retry ONLY when the caller supplied an idempotency key.
      idempotent: params.idempotencyKey !== undefined,
    });
  }

  private async request<T>(spec: RequestSpec): Promise<T> {
    const url = `${this.baseUrl}${spec.path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
      ...spec.extraHeaders,
    };

    const maxAttempts = spec.idempotent ? this.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: spec.method,
          headers,
          ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        // Network/abort error — retry if idempotent and attempts remain.
        if (spec.idempotent && attempt < maxAttempts - 1) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw err;
      }
      clearTimeout(timer);

      if (res.ok) {
        return (await res.json()) as T;
      }

      // Non-2xx — decide whether to retry on transient server errors.
      const retryable = res.status >= 500 || res.status === 429;
      if (spec.idempotent && retryable && attempt < maxAttempts - 1) {
        await sleep(this.backoff(attempt));
        continue;
      }

      throw await toFidacyError(res);
    }

    // Exhausted retries without a definitive HTTP error (e.g. repeated network failures).
    throw lastError ?? new Error('Fidacy request failed');
  }
}

async function toFidacyError(res: Response): Promise<FidacyError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body — fall through with empty object. NEVER echo raw body.
  }

  const type = typeof body.error === 'string' ? body.error : 'http_error';
  const rejection_reasons = Array.isArray(body.rejection_reasons)
    ? (body.rejection_reasons as RejectionReason[])
    : undefined;

  return new FidacyError({
    type,
    status: res.status,
    details: body.details,
    rejection_reasons,
  });
}

// ---------------------------------------------------------------------------
// Re-exports — "verify it yourself".
// ---------------------------------------------------------------------------

export { verifyRiskPayload, verifyWebhook } from '@fidacy/verify';
export type { WebhookEvent } from '@fidacy/verify';

export const VERSION = '0.0.0';
