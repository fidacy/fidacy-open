# Decision-Provenance Claim Type v1 (draft)

**Claim type:** `decision-provenance`
**UCP signal name:** `com.fidacy.decision_provenance`
**Schema:** [`decision-provenance-receipt.schema.json`](./decision-provenance-receipt.schema.json)
**Status:** draft, proposed for the third-party verifier envelope of
[UCP #534](https://github.com/Universal-Commerce-Protocol/ucp/discussions/534), following the
decision-provenance use case that motivated that thread (UCP #56). Field-level alignment tracks
the envelope as it settles; everything below documents a format shipping in production today.

## What this claim answers

Not "who is this agent" (identity) and not "should this transaction happen" (risk). It answers,
months later and to a party who trusts nobody's server logs:

> Prove that this specific decision existed, with exactly this content, at this moment, and was
> not rewritten afterwards.

That is the question auditors, insurers and dispute processes ask after the fact. It has three
requirements the other claim types do not share, and they are **normative for any issuer of this
claim type**:

1. **Non-party issuer.** The issuer MUST NOT operate, meter, settle, or take a fee on the
   transaction whose decision it attests. A rail attesting to its own decision log is exactly
   what the after-the-fact consumer distrusts. This is the same structural-neutrality rule as
   the risk-verdict conformance clause on record in
   [UCP #535](https://github.com/Universal-Commerce-Protocol/ucp/discussions/535).
2. **Long-horizon evidence.** The attestation MUST remain verifiable for years. Short TTLs are
   correct for identity credentials; they answer nothing in a dispute two quarters later.
3. **Issuer-independent anchoring.** Existence-by-time MUST be provable without trusting the
   issuer: an external, publicly verifiable timestamp. This format anchors to Bitcoin.

## The attestation: a signed receipt

A decision-provenance attestation is a **compact JWS (RFC 7515)**, EdDSA (Ed25519), `kid` in the
protected header resolving against the issuer's published JWKS, with payload keys JCS-sorted. It
verifies with any JOSE library; no vendor verifier is required.

Protected header (real, from the live example below):

```json
{ "alg": "EdDSA", "kid": "1zoM57brjllufNTzCwI5-j5jFkiAslyzVDbPAcR_f-M", "typ": "fidacy-artifact-receipt+jws" }
```

Claims:

| field | meaning |
|---|---|
| `v` | format version, `fidacy.artifact.v1` |
| `artifactId` | issuer-side id of the anchored record |
| `sha256` | SHA-256 of the decision-record bytes. The record itself is NEVER uploaded; the issuer sees only this hash |
| `subject` | the agent / mandate the decision was about |
| `kind` | record kind (`custom`, `conversation`, `invoice`, ...) |
| `ts` | ISO 8601 moment of attestation |
| `audit.seq` | position of this attestation in the issuer's hash-chained audit |
| `audit.hash` | the chain entry's hash (commits to every prior entry) |
| `digest` | the audit-leaf digest the chain entry commits to |
| `org` | issuing account scope |

## Two independent trust legs

- **Signature leg:** the JWS proves the issuer attested to `sha256` at `ts`. Verifiable offline
  against the issuer JWKS (`https://api.fidacy.com/.well-known/jwks.json` for Fidacy).
- **Anchor leg:** `audit.seq` places the attestation in a hash-chained audit whose Merkle roots
  are checkpointed into **Bitcoin transactions**. The checkpoint's `txid` is verifiable on any
  Bitcoin node or explorer; the block height bounds the attestation's existence in time without
  trusting the issuer at all. Checkpoint status is public
  (`https://fidacy-core.vercel.app/v1/anchor/latest`), and each anchored record's trail is
  browsable at [fidacy.com/proof](https://fidacy.com/proof).

Consumers who may need to verify after the issuer is gone SHOULD store the receipt together with
its Merkle inclusion proof once the covering checkpoint confirms; from then on verification needs
the issuer for nothing.

## Verification (normative)

1. Verify the JWS against the issuer's JWKS, resolving the protected-header `kid`. Pin
   `typ: fidacy-artifact-receipt+jws`. Reject `alg: none` and non-EdDSA algorithms.
2. Recompute SHA-256 over the decision-record bytes in hand and compare to the `sha256` claim.
   **A mismatch is the tampering signal**: the record changed since attestation.
3. To bound existence in time without trusting the issuer, resolve `audit.seq` to its covering
   Bitcoin checkpoint and verify the Merkle inclusion against the on-chain `txid`.
4. Semantics of a fresh receipt: between issuance and its first covering checkpoint
   (`anchor.status` `queued`/`pending`), only the signature leg holds. Consumers requiring the
   anchor leg MUST wait for `confirmed`.

## How it rides UCP / the envelope

As a sibling signal, same container shape as the other claim types:

```jsonc
"signals": {
  "com.fidacy.decision_provenance": {
    "format": "fidacy-artifact-receipt+jws",
    "jws": "<the signed receipt — source of truth>",
    "kid": "<protected-header kid, convenience copy>",
    "provider_jwks": "https://api.fidacy.com/.well-known/jwks.json"
  }
}
```

Everything outside `jws` is an untrusted hint until the signature verifies. The surrounding
envelope structure is #534's to define; this claim type adds nothing to and changes nothing in it.

## Live example

[`examples/decision-record.json`](./examples/decision-record.json) is a decision record (its
content is itself a real signed Fidacy risk verdict, closing the loop: the decision being proven
is a verdict). [`examples/decision-provenance-receipt.json`](./examples/decision-provenance-receipt.json)
is the REAL receipt the production engine signed for it (audit seq 158). Reproduced checks:

```
1. EdDSA signature against the live JWKS: OK
2. sha256 of the record matches the receipt claim: OK
3. one flipped byte in the record -> hash mismatch -> tampering detected: OK
4. anchor leg: covered by checkpoint 29 (merkleRoot ea462153fa54ac90...,
   seqStart=seqEnd=158) within one anchor cycle of issuance; the checkpoint's
   Bitcoin txid lands with confirmation and is then verifiable on any explorer
```

The lifecycle this example walked is the claim type's whole point: at issuance
only the signature leg held; one cycle later the audit position gained its
Merkle checkpoint; confirmation pins it to a Bitcoin block. Each stage is
independently checkable at
[`/v1/anchor/latest`](https://fidacy-core.vercel.app/v1/anchor/latest).

## Conformance vectors

To land with the envelope PR, mirroring the risk and identity packs: `valid` (the live example),
`tampered-record` (hash mismatch), `bad-signature`, `rotated-key` (kid absent from JWKS),
`pre-checkpoint` (signature leg valid, anchor leg pending — the consumer decides which legs it
requires, the same authenticity-versus-scope separation the other claim types draw).

## References

- Audit chain + Bitcoin checkpoints, public record: https://fidacy.com/proof
- Issuer JWKS: https://api.fidacy.com/.well-known/jwks.json
- Sibling claim-type specs: [risk](./risk-payload.md) · [UCP binding](./ucp-trust-verdict-binding.md) · [AP2 binding](./ap2-trust-verdict-binding.md) · [A2A extension](./a2a-trust-verdict-extension.md)
