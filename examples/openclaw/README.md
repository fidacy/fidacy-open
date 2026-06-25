# Fidacy guard for OpenClaw

Put a signed, independently verifiable Fidacy verdict on every OpenClaw tool action, using [`@fidacy/agent/openclaw`](../../packages/agent).

OpenClaw is a self-hosted agent application that runs tools (files, browser, code, messages, payments) on the user's behalf. `createOpenClawGuard().beforeAction(action)` maps one OpenClaw tool execution to the universal Fidacy `AgentAction`, asks Fidacy for a cryptographically signed verdict, and verifies it. The local OpenClaw flow stays yours; the signed verdict travels.

## Wiring note

Call `beforeAction` from OpenClaw's pre-action / tool-execution hook (the moment OpenClaw is about to run a tool but has not yet run it). Gate on `verdict.allowed` (block on `deny`, hold on `review`), or just annotate the run with the signed `verdict.riskPayloadJws`. This example does not import any OpenClaw package: the action is structurally typed (`{ tool, args }`), so the adapter works against whatever shape your hook provides.

## Run it

```bash
pnpm install
pnpm -r build
export FIDACY_API_KEY=fky_live_…      # required; a real key (calls live /v1/assess)
node examples/openclaw/guard.mjs
```

It prints the OpenClaw action, the Fidacy verdict (decision / allowed / score / verified / reasons), and the "verify it yourself" JWS re-checked with [`@fidacy/verify`](../../packages/verify). Without `FIDACY_API_KEY` it exits with a clear one-line message (no stack, no secret).
