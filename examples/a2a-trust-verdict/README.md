# A2A Trust-Verdict Extension — reference example

A runnable end-to-end demo of the
[Fidacy Trust-Verdict Extension (A2A)](https://fidacy.com/a2a/extensions/trust-verdict/v1): a Fidacy
verdict rides an **A2A** flow inside `Task.metadata`, and the client **verifies the signed JWS
itself** — no trust in Fidacy required.

## Run in 5 lines

```bash
export FIDACY_API_KEY=fky_test_…   # a TEST key from app.fidacy.com → API Keys (mode: test, sandbox, never billed)
pnpm install
pnpm start
```

Expected output: the A2A recommended Task state, confirmation that the verdict rides in
`Task.metadata.fidacy_assessment`, and the **independently verified** decision (`signature valid:
true`).

## What it shows

1. **Declare** — how a buying agent advertises the extension in its Agent Card
   (`capabilities.extensions[]`), typed with the official A2A SDK ([`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk)).
2. **Assess** — the agent assesses a payment mandate through Fidacy inside an A2A flow
   (`A2A-Version: 1.0`). Fidacy returns the verdict the A2A way: in `Task.metadata` under
   `fidacy_assessment`, carrying the signed EdDSA JWS, plus a recommended official A2A Task state.
3. **Verify** — the client checks the JWS with [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify)
   against the public JWKS. The convenience fields are untrusted hints until the JWS verifies.

## Where the verdict rides

| Flow | Container | Schema |
| --- | --- | --- |
| Plain A2A | `Task.metadata.fidacy_assessment` | [a2a-metadata.schema.json](../../spec/a2a-metadata.schema.json) |
| AP2 over A2A | `risk_data.fidacy` | [risk-data.schema.json](../../spec/risk-data.schema.json) |

The signed `vc_jws` is the source of truth in both. See the
[extension spec](../../spec/a2a-trust-verdict-extension.md).
