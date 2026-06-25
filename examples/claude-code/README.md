# Fidacy guard for Claude Code (PreToolUse hook)

A universal connector for any agent, shown on the Claude Code agent. This `PreToolUse` hook puts a cryptographically signed, independently verifiable Fidacy verdict in front of every tool call Claude Code makes (Bash, Edit, Write, WebFetch, and the rest), using [`@fidacy/agent`](../../packages/agent)'s universal trust guard.

The same guard wraps OpenClaw and Hermes. Claude Code is just another agent: the hook maps the pending tool call to the universal `AgentAction`, asks Fidacy, and gates on the signed verdict. No Claude-Code-specific Fidacy logic.

## How it gates a tool call

1. Claude Code is about to run a tool. It runs this hook first, passing the tool call as JSON on stdin (`tool_name`, `tool_input`, `session_id`, `cwd`, ...).
2. The hook builds an `AgentAction` (`agent: 'claude-code'`, `principal` from `FIDACY_PRINCIPAL` or your OS user, `type: 'tool'`, `payload: { tool, args }`) and calls `FidacyGuard.check`.
3. Fidacy returns a signed verdict; the guard verifies the signature against the public JWKS.
4. The hook prints a `PreToolUse` decision to stdout and exits 0:
   - `approve` to `allow` (the tool runs)
   - `deny` to `deny` (the tool is blocked, with the rejection reasons)
   - `review` to `ask` (Claude Code asks you to confirm)

It fails safe: if `FIDACY_API_KEY` is unset, or the assessment errors, it emits `ask` (defers to you) rather than crashing. It never prints a secret or a stack trace.

## Run it

This example uses the package via `workspace:*`. From the repo root:

```bash
pnpm install
pnpm -r build         # build @fidacy/agent (+ sdk, verify)
export FIDACY_API_KEY=fky_live_…      # required; a real key
export FIDACY_PRINCIPAL=org_acme      # optional; defaults to your OS user

# Simulate a Claude Code tool call on stdin:
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/scratch"},"session_id":"demo","cwd":"/tmp"}' \
  | node examples/claude-code/fidacy-guard.mjs
```

You will get a JSON `PreToolUse` decision, for example:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Fidacy approve (score 8, signature verified)"}}
```

## Wire it into Claude Code

Copy the snippet in [`settings.json`](./settings.json) into your Claude Code settings (`~/.claude/settings.json` or a project `.claude/settings.json`), replacing `/ABSOLUTE/PATH/TO` with the real path to `fidacy-guard.mjs`. The `"matcher": "*"` runs the guard before every tool. Narrow it (for example `"Bash"`, or `"Bash|Write|Edit"`) to gate only specific tools.

## Verify it yourself

Every verdict is an EdDSA-signed JWS. The hook already verifies it (`signature verified` in the reason), and anyone can re-check it with [`@fidacy/verify`](../../packages/verify) against the public JWKS, without a Fidacy account. The verdict travels.
