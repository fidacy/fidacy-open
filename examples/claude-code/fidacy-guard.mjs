#!/usr/bin/env node
/**
 * Fidacy trust guard as a Claude Code PreToolUse hook.
 *
 * Claude Code is an AI agent that runs tools (Bash, Edit, Write, WebFetch, ...)
 * on your behalf. This hook sits in front of EVERY tool call: it builds a
 * universal Fidacy AgentAction from the pending tool call, asks Fidacy for a
 * cryptographically signed verdict (approve / review / deny), verifies that
 * signature against the public JWKS, and tells Claude Code whether to proceed.
 *
 * This is the universal connector in action: the same @fidacy/agent guard that
 * wraps OpenClaw and Hermes also wraps Claude Code, with no Claude-Code-specific
 * Fidacy logic. The action is mapped the same way every adapter maps it.
 *
 * Protocol (Claude Code hooks):
 *  - stdin: a JSON object with at least { tool_name, tool_input, session_id, cwd }.
 *  - stdout: a JSON object. For PreToolUse we emit
 *      { hookSpecificOutput: { hookEventName: 'PreToolUse',
 *                              permissionDecision: 'allow' | 'deny' | 'ask',
 *                              permissionDecisionReason: string } }
 *    and exit 0. 'allow' lets the tool run; 'deny' blocks it; 'ask' defers to
 *    the user. A non-approve Fidacy verdict maps to 'deny' (deny) or 'ask'
 *    (review).
 *
 * Wiring: see settings.json in this folder and the README.
 *
 * Requires FIDACY_API_KEY in the environment. The principal (on whose behalf
 * the agent acts) is FIDACY_PRINCIPAL, defaulting to the OS user.
 */
import { FidacyGuard } from '@fidacy/agent';

const AGENT = 'claude-code';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // If nothing is piped in, don't hang forever.
    if (process.stdin.isTTY) resolve('');
  });
}

/** Emit a PreToolUse decision and exit 0 (never block Claude Code with a crash). */
function decide(permissionDecision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

async function main() {
  const apiKey = process.env.FIDACY_API_KEY;
  if (!apiKey) {
    // Fail SAFE and LOUD, but never leak a secret or a stack trace.
    decide(
      'ask',
      'Fidacy guard not configured: set FIDACY_API_KEY to enable signed verdicts. Deferring to the user.',
    );
    return;
  }

  const raw = await readStdin();
  let event = {};
  try {
    event = raw ? JSON.parse(raw) : {};
  } catch {
    decide('ask', 'Fidacy guard could not parse the tool call. Deferring to the user.');
    return;
  }

  const toolName = typeof event.tool_name === 'string' ? event.tool_name : 'unknown';
  const principal = process.env.FIDACY_PRINCIPAL ?? process.env.USER ?? 'local-user';

  const guard = new FidacyGuard({ apiKey });

  let verdict;
  try {
    verdict = await guard.check({
      agent: AGENT,
      principal,
      type: 'tool',
      payload: { tool: toolName, args: event.tool_input },
      meta: { session_id: event.session_id, cwd: event.cwd },
    });
  } catch {
    // Transport / auth failure: do not hard-block the agent, ask the user.
    decide('ask', 'Fidacy assessment failed (network or auth). Deferring to the user.');
    return;
  }

  const verifiedNote = verdict.verified ? 'signature verified' : 'signature NOT verified';
  const base = `Fidacy ${verdict.decision} (score ${verdict.score}, ${verifiedNote})`;

  if (verdict.decision === 'approve') {
    decide('allow', base);
  } else if (verdict.decision === 'deny') {
    const why = verdict.reasons.length ? `: ${verdict.reasons.join('; ')}` : '';
    decide('deny', `${base}${why}`);
  } else {
    // 'review' -> ask the user to confirm.
    const why = verdict.reasons.length ? `: ${verdict.reasons.join('; ')}` : '';
    decide('ask', `${base}${why}`);
  }
}

main().catch(() => {
  // Absolute last resort: never throw a stack with anything sensitive.
  decide('ask', 'Fidacy guard hit an unexpected error. Deferring to the user.');
});
