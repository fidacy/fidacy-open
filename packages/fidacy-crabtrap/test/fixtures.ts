/**
 * Test fixtures — freshly generated Ed25519 keys ONLY. No real Fidacy keys.
 *
 * The DEMO signer here mirrors the real verdict shape (EdDSA, typ
 * application/vc+jws, issuer did:web:fidacy.com#<kid>) so the verify path can be
 * exercised end-to-end offline. Nothing here is, or ever was, a production key.
 */
import {
  CompactSign,
  type JWK,
  base64url,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose';
import type {
  CrabTrapAuditEntry,
  CrabTrapDecision,
  CustomMandate,
  FidacyAssessor,
  FidacyVerdict,
} from '../src/types.js';

export interface DemoKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

const enc = new TextEncoder();

/** Generate a fresh Ed25519 keypair + a JWKS-shaped public JWK. */
export async function makeDemoKey(): Promise<DemoKey> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const pub = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(pub);
  const publicJwk: JWK = { ...pub, kid, alg: 'EdDSA', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

export function jwksOf(...keys: DemoKey[]): { keys: JWK[] } {
  return { keys: keys.map((k) => k.publicJwk) };
}

/** Sign a risk-payload claims object as a compact EdDSA JWS (typ application/vc+jws). */
export async function signClaims(key: DemoKey, claims: unknown): Promise<string> {
  return new CompactSign(enc.encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'application/vc+jws' })
    .sign(key.privateKey);
}

/** Build a real-shaped risk-payload claims object for `subject`/`decision`. */
export function demoClaims(
  key: DemoKey,
  overrides: Partial<{
    subject: string;
    decision: 'approve' | 'review' | 'deny';
    score: number;
    signals: Record<string, unknown>;
  }> = {},
): Record<string, unknown> {
  return {
    issuer: `did:web:fidacy.com#${key.kid}`,
    subject: overrides.subject ?? 'agent@company.com',
    decision: overrides.decision ?? 'review',
    score: overrides.score ?? 55,
    signals: overrides.signals ?? { source: 'crabtrap' },
    model_version: 'risk-demo-1.0.0',
    policy_version: 'policy-demo-1',
    assessed_at: new Date().toISOString(),
  };
}

/**
 * A DEMO `FidacyAssessor` that signs a real-shaped verdict with a local key.
 * Mirrors what api.fidacy.com does — except the real private key never leaves
 * the engine. Maps the upstream CrabTrap local decision to a Fidacy decision
 * for demonstration (deny→deny, timeout→review, allow→approve).
 */
export function demoAssessor(key: DemoKey): FidacyAssessor {
  return {
    async assess({ mandate }: { mandate: CustomMandate }): Promise<FidacyVerdict> {
      const local = mandate.upstream?.local_decision;
      const decision: 'approve' | 'review' | 'deny' =
        local === 'deny' ? 'deny' : local === 'allow' ? 'approve' : 'review';
      const claims = demoClaims(key, {
        subject: mandate.actor_agent,
        decision,
        score: decision === 'deny' ? 90 : decision === 'approve' ? 10 : 55,
      });
      const jws = await signClaims(key, claims);
      return {
        decision,
        score: claims.score as number,
        riskPayloadJws: jws,
        signingKeyId: key.kid,
      };
    },
  };
}

/** An assessor that always throws — for the fail-safe test. */
export function throwingAssessor(message = 'boom'): FidacyAssessor {
  return {
    async assess(): Promise<FidacyVerdict> {
      throw new Error(message);
    },
  };
}

/** Forge a compact JWS-looking token advertising a non-EdDSA alg. */
export function forgeNonEddsaToken(kid: string, payload: unknown): string {
  const header = base64url.encode(enc.encode(JSON.stringify({ alg: 'HS256', kid })));
  const body = base64url.encode(enc.encode(JSON.stringify(payload)));
  const sig = base64url.encode(enc.encode('forged'));
  return `${header}.${body}.${sig}`;
}

/** An async iterable over the given decisions (a bounded test source). */
export async function* arraySource(
  decisions: CrabTrapDecision[],
): AsyncIterable<CrabTrapDecision> {
  for (const d of decisions) yield d;
}

// ---------------------------------------------------------------------------
// Real-shaped raw SSE audit entries
// ---------------------------------------------------------------------------

/** A DENY routed through the LLM, with an llm_reason and a secret header. */
export function denyAuditEntry(): CrabTrapAuditEntry {
  return {
    id: 'evt_1',
    timestamp: '2026-06-22T10:00:00Z',
    user_id: 'agent@company.com',
    request_id: 'req_abc',
    method: 'POST',
    url: 'https://api.vendor.com/v1/charges',
    operation: 'WRITE',
    decision: 'DENY',
    cache_hit: false,
    approved_by: 'llm',
    approved_at: '2026-06-22T10:00:00Z',
    channel: 'llm',
    response_status: 403,
    duration_ms: 120,
    error: '',
    // Over real SSE this is null; here we include a secret to prove redaction.
    request_headers: { Authorization: 'Bearer xyz', 'content-type': 'application/json' },
    request_body: '',
    response_headers: null,
    response_body: '',
    llm_reason: 'amount exceeds per-transaction policy limit',
    llm_response_id: 'llm_1',
    llm_policy_id: 'pol_42',
  };
}

/** A TIMEOUT entry. */
export function timeoutAuditEntry(): CrabTrapAuditEntry {
  return {
    id: 'evt_2',
    timestamp: '2026-06-22T10:01:00Z',
    user_id: 'agent@company.com',
    request_id: 'req_def',
    method: 'GET',
    url: 'https://api.vendor.com/v1/balance',
    operation: 'READ',
    decision: 'TIMEOUT',
    cache_hit: false,
    approved_by: 'llm-fallback',
    channel: 'passthrough',
    response_status: 0,
    duration_ms: 45000,
    error: 'llm judge timed out',
    request_headers: null,
    request_body: '',
    llm_reason: '',
  };
}

/** A static-rule ALLOW with empty llm_reason (reason derived from approved_by). */
export function staticRuleAuditEntry(): CrabTrapAuditEntry {
  return {
    id: 'evt_3',
    timestamp: '2026-06-22T10:02:00Z',
    user_id: 'agent@company.com',
    request_id: 'req_ghi',
    method: 'GET',
    url: 'https://api.vendor.com/v1/ping',
    operation: 'READ',
    decision: 'ALLOW',
    cache_hit: false,
    approved_by: 'llm-static-rule',
    channel: 'system',
    response_status: 200,
    duration_ms: 3,
    error: '',
    request_headers: null,
    request_body: '',
    llm_reason: '',
    // No llm_policy_id (not the llm channel).
  };
}
