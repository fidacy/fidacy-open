/**
 * Spec conformance — code and spec MUST NOT diverge (spec §4).
 *
 * Loads each published JSON Schema from `spec/` and validates a real fixture
 * against it. The risk-payload fixture is the EXACT claims object that
 * `@fidacy/verify` signs and returns (built from the test fixtures' freshly
 * generated Ed25519 key), so the schema is checked against the real wire shape.
 *
 * Each schema must ACCEPT its valid fixture and REJECT an invalid one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { sampleClaims } from './fixtures.js';

const SPEC_DIR = fileURLToPath(new URL('../../../spec/', import.meta.url));

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, `file://${SPEC_DIR}`), 'utf8'));
}

const riskPayloadSchema = loadSchema('risk-payload.schema.json');
const riskDataSchema = loadSchema('risk-data.schema.json');
const kyaSchema = loadSchema('kya.schema.json');
const a2aSchema = loadSchema('a2a-metadata.schema.json');

/** Fresh Ajv with all spec schemas registered (so cross-schema $ref resolves). */
function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // Register by $id so risk-data's $ref to risk-payload resolves.
  ajv.addSchema(riskPayloadSchema, riskPayloadSchema.$id as string);
  ajv.addSchema(riskDataSchema, riskDataSchema.$id as string);
  ajv.addSchema(kyaSchema, kyaSchema.$id as string);
  ajv.addSchema(a2aSchema, a2aSchema.$id as string);
  return ajv;
}

const ajv = makeAjv();

describe('spec/risk-payload.schema.json', () => {
  const validate = ajv.getSchema(riskPayloadSchema.$id as string)!;

  it('accepts the real signed claims object', () => {
    // Same claims shape @fidacy/verify produces/returns.
    const claims = sampleClaims();
    expect(validate(claims)).toBe(true);
  });

  it('accepts forward-compat unknown fields', () => {
    expect(validate(sampleClaims({ future_field: 'ignored' } as never))).toBe(true);
  });

  it('rejects a bad decision enum', () => {
    expect(validate(sampleClaims({ decision: 'maybe' } as never))).toBe(false);
  });

  it('rejects a score out of range', () => {
    expect(validate(sampleClaims({ score: 101 }))).toBe(false);
  });

  it('rejects a non-Fidacy issuer DID', () => {
    expect(validate(sampleClaims({ issuer: 'did:web:evil.example#k' }))).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { model_version, ...rest } = sampleClaims();
    void model_version;
    expect(validate(rest)).toBe(false);
  });
});

describe('spec/risk-data.schema.json', () => {
  const validate = ajv.getSchema(riskDataSchema.$id as string)!;

  const validContainer = {
    fidacy: {
      decision: 'approve',
      score: 12,
      vc_jws: 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhZ2VudCJ9.c2ln',
      signing_key_id: 'key-2026-06',
      payload: sampleClaims(),
    },
  };

  it('accepts a valid container (and the embedded payload via $ref)', () => {
    expect(validate(validContainer)).toBe(true);
  });

  it('rejects when the embedded payload is invalid', () => {
    const bad = {
      fidacy: { ...validContainer.fidacy, payload: sampleClaims({ score: 999 }) },
    };
    expect(validate(bad)).toBe(false);
  });

  it('rejects a malformed vc_jws', () => {
    const bad = { fidacy: { ...validContainer.fidacy, vc_jws: 'not-a-jws' } };
    expect(validate(bad)).toBe(false);
  });

  it('rejects a missing fidacy block', () => {
    expect(validate({})).toBe(false);
  });
});

describe('spec/kya.schema.json', () => {
  const validate = ajv.getSchema(kyaSchema.$id as string)!;

  it('accepts a real cnf key binding with matching thumbprint', async () => {
    const { publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const jwk = await exportJWK(publicKey);
    const thumbprint = await calculateJwkThumbprint(jwk);
    expect(validate({ cnf: { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } }, thumbprint })).toBe(
      true,
    );
  });

  it('rejects a non-Ed25519 cnf.jwk', () => {
    expect(validate({ cnf: { jwk: { kty: 'EC', crv: 'P-256', x: 'abc' } } })).toBe(false);
  });

  it('rejects a missing cnf', () => {
    expect(validate({})).toBe(false);
  });
});

describe('spec/a2a-metadata.schema.json', () => {
  const validate = ajv.getSchema(a2aSchema.$id as string)!;

  it('accepts a valid metadata block', () => {
    expect(validate({ fidacy_assessment: { decision: 'approve' } })).toBe(true);
  });

  it('rejects a missing fidacy_assessment', () => {
    expect(validate({ other: true })).toBe(false);
  });

  it('rejects a non-object fidacy_assessment', () => {
    expect(validate({ fidacy_assessment: 'approve' })).toBe(false);
  });
});
