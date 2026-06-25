# Fidacy guard for Hermes Agent

Seal every Hermes autonomous payment with a signed, independently verifiable Fidacy authorization verdict, using [`@fidacy/agent/hermes`](../../packages/agent).

Hermes Agent (Nous Research) is a self-hosted autonomous agent that, notably, pays autonomously (L402 / Lightning, on-chain). `createHermesGuard().beforePayment(payment)` maps the payment to the universal Fidacy `AgentAction`, asks Fidacy for a cryptographically signed verdict (who authorized it, and the payment's provenance), and verifies it. Every autonomous payment then carries a seal anyone can re-check.

## Wiring note

Call `beforePayment` right before Hermes settles an L402 invoice or sends a Lightning / on-chain payment, and gate on `verdict.allowed`. Use `beforeAction` for non-payment Hermes tools. This example imports no Hermes package: the payment is structurally typed (`{ amount, recipient, invoice, memo }`), so the adapter works against whatever shape your hook provides.

## Run it

```bash
pnpm install
pnpm -r build
export FIDACY_API_KEY=fky_live_…      # required; a real key (calls live /v1/assess)
node examples/hermes/pay.mjs
```

It prints the Hermes payment, the Fidacy authorization verdict, and the "verify it yourself" JWS re-checked with [`@fidacy/verify`](../../packages/verify). Without `FIDACY_API_KEY` it exits with a clear one-line message (no stack, no secret).
