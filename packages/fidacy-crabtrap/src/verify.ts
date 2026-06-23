/**
 * verify.ts — verify a Fidacy-signed verdict, and (optionally) assert the
 * signing key is published in Fidacy's signed trust list.
 *
 * Thin wrapper over `@fidacy/verify`'s `verifyRiskPayload` (EdDSA-only is
 * enforced inside it). The adapter only ever CALLS /v1/assess and VERIFIES
 * public JWS — the engine's private key is never referenced here.
 */
import {
  type RiskPayloadClaims,
  type VerifyOptions,
  verifyRiskPayload,
} from '@fidacy/verify';
import { assertPublicUrl } from './ssrf.js';

const DEFAULT_TRUST_LIST_URL = 'https://api.fidacy.com/.well-known/fidacy-trust-list.json';

export interface VerifyVerdictResult {
  valid: true;
  claims: RiskPayloadClaims;
  kid: string;
}

/**
 * Verify a Fidacy risk-payload JWS. Pass `jwks` to stay fully offline (the
 * offline example does this); otherwise the keys are fetched from Fidacy's
 * public JWKS. EdDSA-only is enforced by `@fidacy/verify`.
 */
export async function verifyVerdict(
  jws: string,
  opts: VerifyOptions = {},
): Promise<VerifyVerdictResult> {
  const res = await verifyRiskPayload(jws, opts);
  return { valid: true, claims: res.claims, kid: res.kid };
}

export interface TrustListKey {
  kid: string;
  [k: string]: unknown;
}

export interface TrustList {
  keys: TrustListKey[];
  proof?: { jws: string };
  [k: string]: unknown;
}

export interface AssertKidOptions {
  /** Provide the trust list inline → no network access. */
  trustList?: TrustList;
  /** Or fetch it. Default: Fidacy's public trust list. SSRF-guarded. */
  trustListUrl?: string;
  /** Override the fetch implementation. */
  fetch?: typeof fetch;
  /** Allow loopback/private hosts (local dev / the example). */
  allowInsecureHosts?: boolean;
}

export class TrustListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustListError';
  }
}

/**
 * Assert that `kid` is present in Fidacy's signed trust list. Throws
 * `TrustListError` when the kid is absent or the list cannot be resolved. The
 * trust-list fetch is SSRF-guarded.
 *
 * NOTE: this checks LIST MEMBERSHIP of the kid. The trust list's own `proof.jws`
 * should be verified by the caller/registry tooling; here we gate on membership,
 * which is the property the adapter needs (is this key one Fidacy publishes?).
 */
export async function assertKidInTrustList(
  kid: string,
  opts: AssertKidOptions = {},
): Promise<void> {
  const list = opts.trustList ?? (await fetchTrustList(opts));
  const keys = Array.isArray(list.keys) ? list.keys : [];
  const found = keys.some((k) => k && k.kid === kid);
  if (!found) {
    throw new TrustListError(`Signing key "${kid}" is not in the Fidacy trust list`);
  }
}

async function fetchTrustList(opts: AssertKidOptions): Promise<TrustList> {
  const url = opts.trustListUrl ?? DEFAULT_TRUST_LIST_URL;
  assertPublicUrl(url, opts.allowInsecureHosts ?? false);
  const fetchImpl = opts.fetch ?? fetch;

  let body: unknown;
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new TrustListError(`Trust list fetch returned HTTP ${res.status}`);
    }
    body = await res.json();
  } catch (e) {
    if (e instanceof TrustListError) throw e;
    throw new TrustListError('Trust list fetch failed');
  }

  if (typeof body !== 'object' || body === null || !Array.isArray((body as TrustList).keys)) {
    throw new TrustListError('Trust list body is malformed');
  }
  return body as TrustList;
}
