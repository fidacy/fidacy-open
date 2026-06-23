/**
 * @fidacy/example-crabtrap-observe
 *
 * Observe-mode in ~5 lines: take ONE Brex CrabTrap audit decision, put a
 * neutral, portable, SIGNED Fidacy verdict on top, then verify that signature
 * yourself. Observe-mode is non-blocking — it never alters CrabTrap's flow.
 *
 * Two modes:
 *  - DEFAULT (offline, no creds): a stub CrabTrap audit_entry → a DEMO signer
 *    that signs a real-shaped verdict with a freshly generated Ed25519 key →
 *    verified offline with @fidacy/verify. Prints `signing_valid: true`.
 *  - LIVE (set FIDACY_API_KEY): the real sdkAssessor calls api.fidacy.com's
 *    /v1/assess, and the returned verdict is verified against the public JWKS
 *    + asserted against the signed trust list.
 *
 * This example is an independent complement to Brex CrabTrap. It is NOT
 * endorsed by, official to, or partnered with Brex.
 */
import {
  CompactSign,
  type JWK,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { verifyRiskPayload } from '@fidacy/verify';
import {
  type CrabTrapAuditEntry,
  type FidacyAssessor,
  type VerdictRecord,
  assertKidInTrustList,
  attachVerdict,
  normalizeAuditEntry,
  observe,
  sdkAssessor,
  toCustomMandate,
  verifyVerdict,
} from '@fidacy/crabtrap';

// ---------------------------------------------------------------------------
// A stub CrabTrap SSE audit_entry: a DENY with an llm_reason.
// (Over real SSE the heavy/sensitive fields are redacted; we include a secret
//  header here only to show the adapter strips it defensively.)
// ---------------------------------------------------------------------------
const STUB_AUDIT_ENTRY: CrabTrapAuditEntry = {
  id: 'evt_demo_1',
  timestamp: '2026-06-22T10:00:00Z',
  user_id: 'agent@company.com',
  request_id: 'req_demo_abc',
  method: 'POST',
  url: 'https://api.vendor.com/v1/charges',
  operation: 'WRITE',
  decision: 'DENY',
  cache_hit: false,
  approved_by: 'llm',
  channel: 'llm',
  response_status: 403,
  duration_ms: 118,
  request_headers: { Authorization: 'Bearer super-secret', 'content-type': 'application/json' },
  request_body: '',
  llm_reason: 'amount exceeds the per-transaction policy limit for this vendor',
  llm_policy_id: 'pol_42',
};

// ---------------------------------------------------------------------------
// DEMO signer — real verdicts are signed by api.fidacy.com; the private key
// never leaves the engine. This local key exists ONLY to make the offline
// example self-verifying. It mirrors the real verdict shape.
// ---------------------------------------------------------------------------
async function demoSignerAssessor(): Promise<{ assessor: FidacyAssessor; jwks: { keys: JWK[] } }> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const pub = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(pub);
  const publicJwk: JWK = { ...pub, kid, alg: 'EdDSA', use: 'sig' };
  const enc = new TextEncoder();

  const assessor: FidacyAssessor = {
    async assess({ mandate }) {
      // Demonstrate Fidacy issuing its OWN verdict over the custom mandate.
      const decision = mandate.upstream?.local_decision === 'deny' ? 'deny' : 'review';
      const claims = {
        issuer: `did:web:fidacy.com#${kid}`,
        subject: mandate.actor_agent,
        decision,
        score: decision === 'deny' ? 90 : 55,
        signals: { source: 'crabtrap', upstream_reason: mandate.upstream?.local_reason },
        model_version: 'risk-demo-1.0.0',
        policy_version: 'policy-demo-1',
        assessed_at: new Date().toISOString(),
      };
      const jws = await new CompactSign(enc.encode(JSON.stringify(claims)))
        .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'application/vc+jws' })
        .sign(privateKey);
      return { decision, score: claims.score, riskPayloadJws: jws, signingKeyId: kid };
    },
  };

  return { assessor, jwks: { keys: [publicJwk] } };
}

function printContainer(record: VerdictRecord, signingValid: boolean): void {
  console.log('\n=== Verdict Container ===');
  console.log(
    JSON.stringify(
      {
        crabtrap: {
          agentId: record.crabtrap.agentId,
          decision: record.crabtrap.decision,
          reason: record.crabtrap.reason,
          policyId: record.crabtrap.policyId ?? null,
          request: record.crabtrap.request,
        },
        fidacy: record.fidacy
          ? {
              decision: record.fidacy.decision,
              score: record.fidacy.score,
              signingKeyId: record.fidacy.signingKeyId,
              riskPayloadJws: `${record.fidacy.riskPayloadJws.slice(0, 32)}…`,
            }
          : null,
        fallback: record.fallback ?? null,
        header: record.header ?? null,
      },
      null,
      2,
    ),
  );
  console.log(`\nsigning_valid: ${signingValid}`);
}

async function runOffline(): Promise<void> {
  console.log('mode: OFFLINE (DEMO signer — no Fidacy account needed)');
  const { assessor, jwks } = await demoSignerAssessor();

  // The 5-line core: one decision → normalize → map → assess → verify.
  const decision = normalizeAuditEntry(STUB_AUDIT_ENTRY);
  const mandate = toCustomMandate(decision, {});
  const verdict = await assessor.assess({ kind: 'custom', mandate });
  const record = attachVerdict(decision, verdict, { attachHeader: true });

  // Verify the signature yourself — offline, keys injected, no network.
  const verified = await verifyRiskPayload(verdict.riskPayloadJws, {
    jwks,
    issuer: 'did:web:fidacy.com#',
  });
  printContainer(record, verified.valid === true);
}

async function runLive(apiKey: string): Promise<void> {
  console.log('mode: LIVE (api.fidacy.com /v1/assess)');
  const assessor = sdkAssessor({ apiKey });
  let valid = false;
  let captured: VerdictRecord | null = null;

  await observe({
    source: oneDecisionSource(),
    assessor,
    attachHeader: true,
    onVerdict: async (record) => {
      captured = record;
      if (record.fidacy) {
        // Verify against the REAL public JWKS + assert the kid is published.
        const res = await verifyVerdict(record.fidacy.riskPayloadJws);
        await assertKidInTrustList(res.kid);
        valid = res.valid === true;
      }
    },
  });

  if (captured) printContainer(captured, valid);
}

async function* oneDecisionSource() {
  yield normalizeAuditEntry(STUB_AUDIT_ENTRY);
}

async function main(): Promise<void> {
  const apiKey = process.env.FIDACY_API_KEY;
  if (apiKey) {
    await runLive(apiKey);
  } else {
    await runOffline();
  }
}

main().catch((err) => {
  console.error('example failed:', err);
  process.exitCode = 1;
});
