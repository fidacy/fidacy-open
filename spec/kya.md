# KYA — Know-Your-Agent Identity Binding

**Schema:** [`kya.schema.json`](./kya.schema.json) (JSON Schema, draft 2020-12)

**KYA** ("Know Your Agent") answers a single public question: *which key is acting behind this
mandate?* This document specifies only the **public, transmitted identity binding** — the
proof-of-possession key that ties a mandate to an agent. It does **not** describe any trust graph,
reputation, or scoring; those are out of scope for this specification.

## The thumbprint contract

An agent is identified by an **Ed25519 public key**. Its stable, portable reference is the
**RFC 7638 JWK Thumbprint** of that key:

- Take the public JWK's required members for an OKP key — `crv`, `kty`, `x`.
- Serialize them as a JSON object with members in **lexicographic order** and **no whitespace**:

  ```
  {"crv":"Ed25519","kty":"OKP","x":"<base64url>"}
  ```

- Hash with **SHA-256** and `base64url`-encode the digest.

The result is the agent's key thumbprint — a deterministic identifier that any party can recompute
from the public key alone. No secret material is involved.

## Key binding in mandates (`cnf`)

For mandates that carry proof of possession (e.g. AP2 Open mandates), the agent's key is presented
in the **`cnf`** (confirmation) member, per **RFC 7800**:

```jsonc
{
  "cnf": {
    "jwk": {
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "<base64url 32-byte public point>"
    }
  }
}
```

The holder proves possession of the private key matching `cnf.jwk`. A verifier identifies the agent
by computing the RFC 7638 thumbprint of `cnf.jwk` and matching it against the agent's known active
Ed25519 public key(s).

| Field         | Type   | Required | Notes                                                                 |
| ------------- | ------ | -------- | --------------------------------------------------------------------- |
| `cnf`         | object | yes      | RFC 7800 confirmation member                                          |
| `cnf.jwk`     | object | yes      | Ed25519 public JWK (`kty: OKP`, `crv: Ed25519`, `x`)                  |
| `thumbprint`  | string | no       | *Informative.* RFC 7638 thumbprint of `cnf.jwk` (must match if given) |

## Status of this document

The `cnf`/`thumbprint` binding above is the **normative** public KYA surface. Anything labelled
*informative* (including the standalone `thumbprint` convenience field) is provided to aid
implementers and is not a guaranteed wire field. Engine-internal identity resolution (how Fidacy
maps a thumbprint to an agent record, validity windows, status) is intentionally **not** specified
here.

## Forward compatibility

`additionalProperties: true`. Unknown members MUST be ignored. See [`VERSIONING.md`](./VERSIONING.md).
