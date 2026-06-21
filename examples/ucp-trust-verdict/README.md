# UCP Trust-Verdict Binding, reference example

A runnable end-to-end demo of the
[Fidacy Trust-Verdict Binding (UCP)](https://fidacy.com/ucp/extensions/trust-verdict/v1): a Fidacy
verdict rides a UCP flow as a `com.fidacy.trust_verdict` signal, and the client verifies the signed
JWS itself, with no trust in Fidacy.

## Run in 5 lines

```bash
export FIDACY_API_KEY=fky_test_…   # a TEST key from app.fidacy.com (mode: test, sandbox, never billed)
pnpm install
pnpm start
```

Expected output ends with `signature valid: true` and `decisions match: true`. The verdict rode in
`ucp.signals["com.fidacy.trust_verdict"]`; verification used only the public JWKS.

## What it shows

1. Assess a payment inside a UCP flow (a `ucp` block engages UCP).
2. Fidacy returns the verdict as a `com.fidacy.trust_verdict` signal carrying the signed EdDSA JWS,
   plus an advisory `recommended_action`.
3. The client checks the JWS with [`@fidacy/verify`](https://www.npmjs.com/package/@fidacy/verify)
   against the public JWKS. The convenience fields are untrusted hints until the JWS verifies.

See the [binding spec](../../spec/ucp-trust-verdict-binding.md).
