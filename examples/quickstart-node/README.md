# Fidacy quickstart (Node)

A minimal, runnable example of the Fidacy **"don't trust us — verify"** loop:

1. Call the public Fidacy API to **assess** a payment mandate.
2. Independently **verify** the signed verdict against Fidacy's public JWKS — no
   trust in us required.

Requires Node 18+.

## Run

```bash
# 1. Install workspace deps (from the repo root)
pnpm install

# 2. Set a test API key (from app.fidacy.com)
export FIDACY_API_KEY=fky_test_…

# 3. Run the example
pnpm --filter @fidacy/quickstart-node start
```

Expected output:

```
decision: approve
signature valid: true
decisions match: true
```

## Notes

- This hits the **production API** at `api.fidacy.com` in **test mode** (any
  `fky_test_…` key). No charges, no real settlement.
- The verify step uses [`@fidacy/verify`](../../packages/verify) to check the
  Ed25519 signature on the returned risk payload against Fidacy's public JWKS.
  This proves the verdict is genuinely Fidacy's and untampered — entirely
  client-side, with no callback to us.
- The API key is read from `process.env.FIDACY_API_KEY` and is never hardcoded.
