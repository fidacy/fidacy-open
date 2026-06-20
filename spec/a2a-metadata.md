# A2A `Task.metadata` Block

**Schema:** [`a2a-metadata.schema.json`](./a2a-metadata.schema.json) (JSON Schema, draft 2020-12)

When Fidacy assesses a request inside an **A2A** (Agent-to-Agent) flow, it returns a metadata block
the A2A client copies verbatim into the Task's `metadata` field, plus a **recommended Task state**
derived from the decision. Fidacy never invents new A2A Task fields — the verdict rides in standard
`Task.metadata`, and the recommended state is always one of A2A's official states.

## The metadata block

```jsonc
{
  "fidacy_assessment": { /* the assessment outcome, carried verbatim */ }
}
```

| Field               | Type   | Required | Notes                                                        |
| ------------------- | ------ | -------- | ------------------------------------------------------------ |
| `fidacy_assessment` | object | yes      | The assessment outcome. Opaque to the A2A layer; the signed verdict (`vc_jws`) inside it is the authoritative, verifiable result. |

The client **MUST** copy this object into `Task.metadata` and **MUST NOT** map it onto new,
non-standard Task fields.

## Decision → recommended Task state

Fidacy maps its decision onto an **official A2A Task state** — it does not introduce new states:

| `decision` | `recommended_task_state`   | Meaning                                   |
| ---------- | -------------------------- | ----------------------------------------- |
| `approve`  | `TASK_STATE_WORKING`       | The Task proceeds.                        |
| `review`   | `TASK_STATE_AUTH_REQUIRED` | Additional authorization is required.     |
| `deny`     | `TASK_STATE_REJECTED`      | The Task is rejected.                     |

The recommended state is advisory: it tells the calling agent how to drive the Task based on the
verdict. The authoritative verdict remains the signed [Risk Payload](./risk-payload.md) inside the
assessment outcome, verifiable against the public JWKS.

## Forward compatibility

`additionalProperties: true`. Unknown members MUST be ignored. See [`VERSIONING.md`](./VERSIONING.md).
