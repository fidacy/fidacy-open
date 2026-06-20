# Versioning Policy

This document defines how the **Fidacy open formats** — the signed Risk Payload, the `risk_data`
container, the KYA identity binding, and the A2A metadata block — are versioned and evolved.

## Format version vs. `model_version`

Two independent version axes exist; do not conflate them:

| Axis              | What it versions                                              | Where it lives                          |
| ----------------- | ------------------------------------------------------------ | --------------------------------------- |
| **Format version** | The *shape* of the signed/transmitted documents (these schemas) | This `spec/` directory; package versions |
| **`model_version`** | The *scoring model* that produced a given verdict           | The `model_version` claim in each Risk Payload |

`model_version` changes whenever Fidacy updates its scoring — frequently, and with **no** wire-format
implications. A new `model_version` never requires verifier changes. The **format version** changes
only when these schemas change.

## Semantic versioning of the formats

The formats follow [Semantic Versioning](https://semver.org/):

- **PATCH** — editorial/clarification changes; no wire impact.
- **MINOR** — **additive, backward-compatible** changes: new *optional* fields, new advisory
  `signals` keys, new enum-adjacent extensions that older verifiers can ignore.
- **MAJOR** — **breaking** changes: removing or renaming a required field, changing a field's type,
  tightening an enum, or changing signing/encoding semantics.

The format version tracks the published spec/package versions (e.g. the `fidacy-spec` docs and the
[`@fidacy/verify`](../packages/verify) / `@fidacy/sdk` package versions). Consult each package's
`CHANGELOG` for the concrete history.

## Forward-compatibility rule (normative)

> **Verifiers and decoders MUST ignore fields they do not recognize.**

Every schema in this directory sets `additionalProperties: true` precisely to encode this rule.
A conforming implementation:

- MUST NOT reject a document because it contains unknown members.
- MUST NOT depend on the absence of a field.
- MUST treat the `signals` object as fully opaque (see [`risk-payload.md`](./risk-payload.md)).
- MUST always treat the verified signature (`vc_jws`) as authoritative over any convenience copies.

This is what lets Fidacy ship **MINOR** additions without breaking existing verifiers.

## Deprecation policy

- A field marked deprecated remains present and valid for at least one **MAJOR** version after the
  release that deprecates it.
- Deprecations are announced in the spec docs and the relevant package `CHANGELOG` before removal.
- Removal of a required field, or any other breaking change, only occurs in a **MAJOR** bump.
- The signing algorithm (`EdDSA` / Ed25519) and the JWKS discovery URL are treated as stable wire
  contracts; changing either is a **MAJOR**, pre-announced event.
