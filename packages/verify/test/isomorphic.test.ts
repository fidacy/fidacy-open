import { describe, expect, it } from 'vitest';
import { verifyRiskPayload } from '../src/index.js';
import { jwksOf, makeTestKey, sampleClaims, signPayload } from './fixtures.js';

/**
 * Guard against accidental Node-only dependencies. In the default vitest node
 * environment `globalThis.window` is undefined — assert that holds, and that
 * verification still works without any DOM/Node-specific global.
 */
describe('isomorphic', () => {
  it('runs with no window global (browser/edge-shaped environment)', async () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();

    const key = await makeTestKey();
    const jws = await signPayload(key, sampleClaims());
    const res = await verifyRiskPayload(jws, { jwks: jwksOf(key) });
    expect(res.valid).toBe(true);
  });
});
