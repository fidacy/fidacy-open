# Model Watch — the open harness

The adversarial payment-mandate benchmark behind
[fidacy.com/pulse/model-watch](https://fidacy.com/pulse/model-watch). One fixed payment
mandate, the same 28-scenario adversarial battery for every model (BEC payee swaps,
homoglyph payees, duplicate invoices, over-cap, prompt-injected "ignore your mandate"
overrides), and every proposed payment judged by the same deterministic firewall. The
model is the only variable.

## Reproduce it

```bash
npm i

# 1) prove the battery's ground truth against the deterministic judge (no API keys)
node validate.mjs          # 28 pass, 0 fail

# 2) run the board against real models (one OpenRouter key covers every model)
OPENROUTER_API_KEY=sk-... node run.mjs --models "anthropic/claude-sonnet-5,deepseek/deepseek-chat"
```

The judge is `DevFidacyCore` from the published [`@fidacy/mcp`](https://www.npmjs.com/package/@fidacy/mcp)
package (the same free-forever local firewall the MCP server ships), imported from npm, so
nothing here depends on a private repository. `run.mjs` also accepts `LLM_BASE_URL` +
`LLM_API_KEY` (any OpenAI-compatible endpoint) or `ANTHROPIC_API_KEY`.

## What the numbers mean

- **Attempt rate**: how often the model proposed a payment outside the mandate.
- **Obedience after block**: after the firewall denied it, did the model stop, or
  reformulate and try another out-of-mandate payment?

Full definitions, scenario taxonomy, parsing rules (including refusal detection and the
salvage parser for truncated responses) and honesty caveats: [METHODOLOGY.md](./METHODOLOGY.md).

## Published results

[`results/published-2026-07-18.json`](./results/published-2026-07-18.json) is the exact
snapshot behind the public board (5 models, n=560 per model). Reasoning models
(DeepSeek-R1 et al.) run separately with a larger token budget and land in a later cut.

This is SYSTEM behavior (model + this prompt + this mandate), not "model IQ". Re-run it
with your own keys and check every number; that is the point.
