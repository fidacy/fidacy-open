#!/usr/bin/env node
/**
 * Guard a sample OpenClaw tool action with a signed Fidacy verdict.
 *
 * OpenClaw is a self-hosted agent application that runs tools (files, browser,
 * code, messages, payments) on the user's behalf. Wire `beforeAction` into
 * OpenClaw's pre-action / tool-execution hook: it maps the action to the
 * universal Fidacy AgentAction, asks Fidacy for a cryptographically signed
 * verdict, and verifies it. Gate on `verdict.allowed`, or just annotate the
 * action with the signed `verdict.riskPayloadJws`.
 *
 * Requires FIDACY_API_KEY. Fails gracefully (no stack, no secret) if it is unset.
 */
import { verifyRiskPayload } from '@fidacy/sdk';
import { createOpenClawGuard } from '@fidacy/agent/openclaw';

async function main() {
  const apiKey = process.env.FIDACY_API_KEY;
  if (!apiKey) {
    console.error(
      'Set FIDACY_API_KEY (a real Fidacy key) to run this example. It calls the live /v1/assess.',
    );
    process.exitCode = 1;
    return;
  }

  const guard = createOpenClawGuard({
    apiKey,
    agent: 'did:web:acme.com#openclaw-1',
    principal: process.env.FIDACY_PRINCIPAL ?? 'org_acme',
  });

  // A sample OpenClaw action: send a Slack message via a tool.
  const action = {
    tool: 'slack.postMessage',
    args: { channel: '#finance', text: 'Vendor invoice INV-4821 is approved for payment.' },
  };

  const verdict = await guard.beforeAction(action);

  console.log('=== OpenClaw action ===');
  console.log(JSON.stringify(action, null, 2));
  console.log('\n=== Fidacy verdict ===');
  console.log(
    JSON.stringify(
      {
        decision: verdict.decision,
        allowed: verdict.allowed,
        score: verdict.score,
        verified: verdict.verified,
        reasons: verdict.reasons,
        signingKeyId: verdict.signingKeyId,
        assessmentId: verdict.assessmentId,
      },
      null,
      2,
    ),
  );

  // Verify it yourself: the JWS anyone can re-check against the public JWKS.
  console.log('\n=== Verify it yourself ===');
  console.log(`riskPayloadJws: ${verdict.riskPayloadJws.slice(0, 48)}...`);
  const checked = await verifyRiskPayload(verdict.riskPayloadJws);
  console.log(`verifyRiskPayload -> valid: ${checked.valid}, decision: ${checked.claims.decision}`);

  if (!verdict.allowed) {
    console.log('\nOpenClaw would BLOCK or hold this action on the verdict above.');
  }
}

main().catch((err) => {
  console.error('Example failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
