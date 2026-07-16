/**
 * @fidacy/verify
 *
 * Isomorphic, client-safe signature verification for Fidacy signed payloads
 * (Risk Payload verdicts + webhooks), checked against Fidacy's public JWKS.
 *
 * Runs in Node 18+, the browser, and edge runtimes. The only dependency is
 * `jose`. This package contains NO Fidacy proprietary logic and never imports
 * private/engine code. It only ever VERIFIES signatures.
 *
 * Security properties:
 *  - EdDSA (Ed25519) only. The verifier locks `{ algorithms: ['EdDSA'] }`, so a
 *    forged `alg: HS256` / `alg: none` token is rejected without verification
 *    (algorithm-confusion defense).
 *  - Errors never include the raw JWS or any payload bytes.
 *  - JWKS is injectable: when `jwks` is provided there is zero network access.
 */
import {
  type JWK,
  compactVerify,
  decodeProtectedHeader,
  importJWK,
} from 'jose';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The signed Risk Payload claims. `signals` is OPAQUE — treat it as an
 * uninterpreted bag; do not enumerate or depend on its internal shape. The
 * index signature keeps the contract forward-compatible.
 */
export interface RiskPayloadClaims {
  issuer: string; // "did:web:fidacy.com#<kid>"
  subject: string;
  decision: 'approve' | 'review' | 'deny';
  score: number; // 0..100
  signals: Record<string, unknown>; // OPAQUE — do not interpret
  model_version: string;
  assessed_at: string; // ISO8601
  [k: string]: unknown; // forward-compat
}

export interface VerifyOptions {
  /** JWKS endpoint. Default: Fidacy's public JWKS. */
  jwksUrl?: string;
  /** Inject a JWKS document → no network access at all. */
  jwks?: { keys: JWK[] };
  /** Required issuer PREFIX (not equality). Default: 'did:web:fidacy.com#'. */
  issuer?: string;
  /** Clock skew tolerance, seconds, for the optional `exp` claim. Default 60. */
  maxClockSkewSec?: number;
  /** Override "now" (tests). */
  now?: Date;
  /** In-memory JWKS cache TTL, ms. Default 300000. */
  cacheTtlMs?: number;
  /** Override the fetch implementation (tests / custom runtimes). */
  fetch?: typeof fetch;
}

export interface VerifiedRiskPayload {
  valid: true;
  claims: RiskPayloadClaims;
  protectedHeader: { alg: 'EdDSA'; kid: string; typ?: string };
  kid: string;
}

export type FidacyVerificationCode =
  | 'invalid_signature'
  | 'expired'
  | 'wrong_issuer'
  | 'unknown_kid'
  | 'jwks_unavailable'
  | 'malformed';

export class FidacyVerificationError extends Error {
  readonly code: FidacyVerificationCode;
  constructor(code: FidacyVerificationCode, message: string) {
    super(message);
    this.name = 'FidacyVerificationError';
    this.code = code;
  }
}

export interface WebhookEvent {
  type: string;
  id?: string;
  created?: number;
  data: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_JWKS_URL = 'https://api.fidacy.com/.well-known/jwks.json';
const DEFAULT_ISSUER_PREFIX = 'did:web:fidacy.com#';
const DEFAULT_SKEW_SEC = 60;
const DEFAULT_CACHE_TTL_MS = 300_000;
const WEBHOOK_TOLERANCE_SEC = 300;

const REQUIRED_CLAIMS = [
  'issuer',
  'subject',
  'decision',
  'score',
  'model_version',
  'assessed_at',
] as const;

// ---------------------------------------------------------------------------
// JWKS cache (simple in-memory, keyed by URL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  keys: JWK[];
  expiresAt: number;
}
const jwksCache = new Map<string, CacheEntry>();

async function resolveJwks(
  jwksUrl: string,
  cacheTtlMs: number,
  fetchImpl: typeof fetch,
  now: number,
): Promise<JWK[]> {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > now) return cached.keys;

  let body: unknown;
  try {
    const res = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new FidacyVerificationError(
        'jwks_unavailable',
        `JWKS fetch returned HTTP ${res.status}`,
      );
    }
    body = await res.json();
  } catch (e) {
    if (e instanceof FidacyVerificationError) throw e;
    throw new FidacyVerificationError('jwks_unavailable', 'JWKS fetch failed');
  }

  const keys = extractKeys(body);
  if (!keys) {
    throw new FidacyVerificationError('jwks_unavailable', 'JWKS body malformed');
  }
  jwksCache.set(jwksUrl, { keys, expiresAt: now + cacheTtlMs });
  return keys;
}

function extractKeys(body: unknown): JWK[] | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { keys?: unknown }).keys)
  ) {
    return (body as { keys: JWK[] }).keys;
  }
  return null;
}

/** Find the JWK matching `kid`, or throw `unknown_kid`. */
function selectKey(keys: JWK[], kid: string): JWK {
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    throw new FidacyVerificationError('unknown_kid', 'No JWKS key matches the token kid');
  }
  return jwk;
}

// ---------------------------------------------------------------------------
// Shared verification core
// ---------------------------------------------------------------------------

interface KeySource {
  jwks?: { keys: JWK[] };
  jwksUrl?: string;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
}

interface VerifiedCompact {
  header: { alg: 'EdDSA'; kid: string; typ?: string };
  payloadBytes: Uint8Array;
}

const decoder = new TextDecoder();

/**
 * Decode the protected header, enforce the EdDSA algorithm lock, resolve the
 * signing key by kid, and cryptographically verify the compact JWS. Returns the
 * verified header + raw payload bytes. Throws FidacyVerificationError only —
 * never leaks the token.
 */
async function verifyCompact(token: string, src: KeySource, now: number): Promise<VerifiedCompact> {
  // 1) Protected header.
  let rawHeader: ReturnType<typeof decodeProtectedHeader>;
  try {
    rawHeader = decodeProtectedHeader(token);
  } catch {
    throw new FidacyVerificationError('malformed', 'Token protected header is undecodable');
  }

  // Algorithm lock — reject anything that isn't EdDSA BEFORE verifying.
  if (rawHeader.alg !== 'EdDSA') {
    throw new FidacyVerificationError(
      'invalid_signature',
      'Unsupported signature algorithm (EdDSA required)',
    );
  }
  const kid = rawHeader.kid;
  if (typeof kid !== 'string' || kid.length === 0) {
    throw new FidacyVerificationError('malformed', 'Token is missing a key id (kid)');
  }

  // 2) Resolve key by kid.
  const keys = src.jwks
    ? src.jwks.keys
    : await resolveJwks(
        src.jwksUrl ?? DEFAULT_JWKS_URL,
        src.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
        src.fetch ?? fetch,
        now,
      );
  const jwk = selectKey(keys, kid);

  let key: Awaited<ReturnType<typeof importJWK>>;
  try {
    key = await importJWK(jwk, 'EdDSA');
  } catch {
    throw new FidacyVerificationError('unknown_kid', 'JWKS key could not be imported');
  }

  // 3) Cryptographic verification — algorithm lock reinforced here.
  let payloadBytes: Uint8Array;
  try {
    const result = await compactVerify(token, key, { algorithms: ['EdDSA'] });
    payloadBytes = result.payload;
  } catch {
    throw new FidacyVerificationError('invalid_signature', 'Signature verification failed');
  }

  return {
    header: {
      alg: 'EdDSA',
      kid,
      ...(typeof rawHeader.typ === 'string' ? { typ: rawHeader.typ } : {}),
    },
    payloadBytes,
  };
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new FidacyVerificationError('malformed', 'Payload is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FidacyVerificationError('malformed', 'Payload is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyRiskPayload(
  jws: string,
  options: VerifyOptions = {},
): Promise<VerifiedRiskPayload> {
  const now = (options.now ?? new Date()).getTime();
  const { header, payloadBytes } = await verifyCompact(jws, options, now);

  const obj = parseJsonObject(payloadBytes);

  // Required claims present?
  for (const claim of REQUIRED_CLAIMS) {
    if (!(claim in obj)) {
      throw new FidacyVerificationError('malformed', 'Payload is missing required claims');
    }
  }

  // Issuer prefix match.
  const issuerPrefix = options.issuer ?? DEFAULT_ISSUER_PREFIX;
  if (typeof obj.issuer !== 'string' || !obj.issuer.startsWith(issuerPrefix)) {
    throw new FidacyVerificationError('wrong_issuer', 'Payload issuer is not trusted');
  }

  // Optional forward-compat `exp` (seconds since epoch).
  if (typeof obj.exp === 'number') {
    const skewMs = (options.maxClockSkewSec ?? DEFAULT_SKEW_SEC) * 1000;
    if (now > obj.exp * 1000 + skewMs) {
      throw new FidacyVerificationError('expired', 'Payload has expired');
    }
  }

  // assessed_at must be a parseable date (no future-rejection — signature is the guarantee).
  if (typeof obj.assessed_at !== 'string' || Number.isNaN(Date.parse(obj.assessed_at))) {
    throw new FidacyVerificationError('malformed', 'Payload assessed_at is not a valid date');
  }

  return {
    valid: true,
    claims: obj as RiskPayloadClaims,
    protectedHeader: header,
    kid: header.kid,
  };
}

export async function verifyWebhook(params: {
  payload: string; // raw body — accepted for API symmetry; the SIGNED payload is trusted
  signatureHeader: string; // x-fidacy-signature: a compact EdDSA JWS over the event JSON
  jwksUrl?: string;
  jwks?: { keys: JWK[] };
  toleranceSec?: number;
  now?: Date;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
}): Promise<WebhookEvent> {
  // `payload` (raw body) and `toleranceSec` are accepted for API symmetry; the
  // authentic event is the SIGNED payload, so we trust that, not the raw body.
  void params.payload;
  void (params.toleranceSec ?? WEBHOOK_TOLERANCE_SEC);

  const now = (params.now ?? new Date()).getTime();
  const { payloadBytes } = await verifyCompact(
    params.signatureHeader,
    {
      jwks: params.jwks,
      jwksUrl: params.jwksUrl,
      cacheTtlMs: params.cacheTtlMs,
      fetch: params.fetch,
    },
    now,
  );

  const obj = parseJsonObject(payloadBytes);
  if (typeof obj.type !== 'string') {
    throw new FidacyVerificationError('malformed', 'Webhook event is missing a type');
  }
  return obj as WebhookEvent;
}

// Injected at build time from package.json (see tsup.config.ts define) so it can
// never drift from the published version. Dev/test runs fall back to "dev".
declare const __PKG_VERSION__: string | undefined;
export const VERSION: string =
  typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : 'dev';
