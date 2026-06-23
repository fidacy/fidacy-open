# Example: CrabTrap observe-mode

Take one [Brex CrabTrap](https://github.com/brexhq/crabtrap) audit decision, put a neutral, **signed** Fidacy verdict on top, and verify that signature yourself. Observe-mode is non-blocking — it never alters CrabTrap's flow.

This is an independent complement to CrabTrap. It is **not** endorsed by, official to, or partnered with Brex.

## Run it in 5 lines

```bash
git clone https://github.com/fidacy/fidacy-open
cd fidacy-open
pnpm install
pnpm --filter @fidacy/crabtrap... build   # build the adapter the example imports
pnpm --filter @fidacy/example-crabtrap-observe start
```

You'll see the **Verdict Container** (the CrabTrap decision + the Fidacy verdict + the `X-Fidacy-Verdict` header) and:

```
signing_valid: true
```

## What it does

- **Offline (default, no creds):** a stub CrabTrap `audit_entry` (a `DENY` with an `llm_reason`) → `normalizeAuditEntry` → `toCustomMandate` → a **DEMO signer** that signs a real-shaped Fidacy verdict with a freshly generated Ed25519 key → verified offline with `@fidacy/verify`.

  > The DEMO signer exists only to make the offline example self-verifying. **Real verdicts are signed by api.fidacy.com; the private key never leaves the engine.**

- **Live (opt-in):** set `FIDACY_API_KEY` and it uses the real `sdkAssessor` → live `/v1/assess` → verifies the returned verdict against Fidacy's public JWKS **and** asserts the signing key is in the signed trust list.

  ```bash
  FIDACY_API_KEY=fky_live_… pnpm --filter @fidacy/example-crabtrap-observe start
  ```

## License

MIT.
