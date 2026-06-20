import { describe, expect, it } from 'vitest';
import {
  Fidacy,
  FidacyError,
  verifyRiskPayload,
  verifyWebhook,
} from '../src/index.js';
import {
  FAKE_KEY,
  type Plan,
  fetchMock,
  jwksFetch,
  makeTestKey,
  sampleAssess,
  signEvent,
} from './fixtures.js';

const BASE = 'https://api.fidacy.com';

describe('Fidacy.assess', () => {
  it('sends Bearer auth, correct url/method, and idempotency_key in the BODY (not header)', async () => {
    const { fetch, calls } = fetchMock([{ kind: 'json', status: 200, body: sampleAssess() }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    const result = await client.assess({
      mandate: { amount: 100 },
      idempotencyKey: 'idem-abc',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(`${BASE}/v1/assess`);
    expect(call.init.method).toBe('POST');

    const headers = call.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(headers['content-type']).toBe('application/json');
    // idempotency must NOT be a header
    expect(headers['idempotency-key']).toBeUndefined();
    expect(headers['Idempotency-Key']).toBeUndefined();

    const body = JSON.parse(call.init.body as string);
    expect(body.kind).toBe('ap2_payment');
    expect(body.mandate).toEqual({ amount: 100 });
    expect(body.idempotency_key).toBe('idem-abc');

    expect(result.decision).toBe('approve');
    expect(result.assessmentId).toBe('asmt_123');
  });

  it('omits optional body fields when not provided', async () => {
    const { fetch, calls } = fetchMock([{ kind: 'json', status: 200, body: sampleAssess() }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    await client.assess({ mandate: { amount: 1 } });

    const body = JSON.parse(calls[0].init.body as string);
    expect('idempotency_key' in body).toBe(false);
    expect('spending_mandate' in body).toBe(false);
    expect('mandateType' in body).toBe(false);
    expect('a2a' in body).toBe(false);
  });

  it('maps spendingMandate -> spending_mandate and includes a2a/mandateType', async () => {
    const { fetch, calls } = fetchMock([{ kind: 'json', status: 200, body: sampleAssess() }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    await client.assess({
      mandate: { amount: 1 },
      mandateType: 'ap2',
      a2a: { task_id: 'task-1' },
      spendingMandate: { cap: 500 },
    });

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.mandateType).toBe('ap2');
    expect(body.a2a).toEqual({ task_id: 'task-1' });
    expect(body.spending_mandate).toEqual({ cap: 500 });
  });

  it('sets A2A-Version header when opts.a2aVersion is provided and returns the a2a block', async () => {
    const a2a = { recommended_task_state: 'completed', task_metadata: { x: 1 } };
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 200, body: sampleAssess({ a2a }) },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    const result = await client.assess(
      { mandate: { amount: 1 }, a2a: { task_id: 't1' } },
      { a2aVersion: '1.0' },
    );

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['A2A-Version']).toBe('1.0');
    expect(result.a2a).toEqual(a2a);
  });

  it('throws FidacyError on non-2xx with type/status/details, never leaking the api key', async () => {
    const { fetch } = fetchMock([
      {
        kind: 'json',
        status: 422,
        body: { error: 'invalid_mandate', details: [{ path: 'amount' }] },
      },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    await expect(client.assess({ mandate: {} })).rejects.toMatchObject({
      name: 'FidacyError',
      type: 'invalid_mandate',
      status: 422,
    });

    try {
      await client.assess({ mandate: {} });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FidacyError);
      const e = err as FidacyError;
      expect(e.type).toBe('invalid_mandate');
      expect(e.status).toBe(422);
      expect(e.details).toEqual([{ path: 'amount' }]);
      // SECURITY: the api key must never appear in the error message or stack.
      expect(e.message).not.toContain(FAKE_KEY);
      expect(String(e.stack ?? '')).not.toContain(FAKE_KEY);
    }
  });

  it('surfaces rejection_reasons from a deny outcome', async () => {
    const { fetch } = fetchMock([
      {
        kind: 'json',
        status: 403,
        body: {
          error: 'forbidden',
          rejection_reasons: [{ key: 'cap', category: 'limit', description: 'too big' }],
        },
      },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    try {
      await client.assess({ mandate: {} });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as FidacyError;
      expect(e.rejection_reasons).toEqual([
        { key: 'cap', category: 'limit', description: 'too big' },
      ]);
    }
  });

  it('falls back to http_error when the body has no error field', async () => {
    const { fetch } = fetchMock([{ kind: 'json', status: 500, body: {} }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, maxRetries: 0 });
    await expect(client.assess({ mandate: {} })).rejects.toMatchObject({
      type: 'http_error',
      status: 500,
    });
  });
});

describe('Fidacy retries', () => {
  // Instant backoff for tests.
  const noBackoff = { backoffMs: () => 0 };

  it('billing.get retries on failure then resolves (3 calls)', async () => {
    const plans: Plan[] = [
      { kind: 'throw', error: Object.assign(new Error('network'), { name: 'FetchError' }) },
      { kind: 'json', status: 500, body: { error: 'database_unavailable' } },
      { kind: 'json', status: 200, body: { tier: 'startup', billing_configured: true, usage: {} } },
    ];
    const { fetch, calls } = fetchMock(plans);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, ...noBackoff });

    const status = await client.billing.get();
    expect(status.tier).toBe('startup');
    expect(calls).toHaveLength(3);
  });

  it('assess WITHOUT idempotencyKey does NOT retry on a 500 (1 call)', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 500, body: { error: 'database_unavailable' } },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, ...noBackoff });

    await expect(client.assess({ mandate: {} })).rejects.toBeInstanceOf(FidacyError);
    expect(calls).toHaveLength(1);
  });

  it('assess WITH idempotencyKey retries on 5xx then resolves', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 503, body: { error: 'signing_key_unavailable' } },
      { kind: 'json', status: 200, body: sampleAssess() },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, ...noBackoff });

    const result = await client.assess({ mandate: {}, idempotencyKey: 'k1' });
    expect(result.decision).toBe('approve');
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry 4xx (e.g. 422)', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 422, body: { error: 'invalid_mandate' } },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, ...noBackoff });

    await expect(client.assess({ mandate: {}, idempotencyKey: 'k1' })).rejects.toBeInstanceOf(
      FidacyError,
    );
    expect(calls).toHaveLength(1);
  });

  it('checkout never retries even on 5xx', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 500, body: { error: 'database_unavailable' } },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, ...noBackoff });

    await expect(client.billing.checkout({ tier: 'startup' })).rejects.toBeInstanceOf(FidacyError);
    expect(calls).toHaveLength(1);
  });

  it('respects maxRetries (caps the number of attempts)', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 500, body: { error: 'database_unavailable' } },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, maxRetries: 2, ...noBackoff });

    await expect(client.billing.get()).rejects.toBeInstanceOf(FidacyError);
    // 1 initial + 2 retries = 3 attempts
    expect(calls).toHaveLength(3);
  });
});

describe('Fidacy timeout', () => {
  it('aborts when the request exceeds timeoutMs', async () => {
    const { fetch } = fetchMock([{ kind: 'hang' }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch, timeoutMs: 20, maxRetries: 0 });

    await expect(client.assess({ mandate: {} })).rejects.toBeTruthy();
  });
});

describe('Fidacy.billing', () => {
  it('get() returns the billing status', async () => {
    const { fetch, calls } = fetchMock([
      {
        kind: 'json',
        status: 200,
        body: { tier: 'growth', status: 'active', billing_configured: true, usage: { assessments: 5 }, over_quota: false },
      },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    const status = await client.billing.get();
    expect(calls[0].url).toBe(`${BASE}/v1/billing`);
    expect(calls[0].init.method ?? 'GET').toBe('GET');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(status.tier).toBe('growth');
    expect(status.billing_configured).toBe(true);
  });

  it('checkout() posts the tier and returns the url', async () => {
    const { fetch, calls } = fetchMock([
      { kind: 'json', status: 200, body: { url: 'https://checkout.stripe.com/x' } },
    ]);
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch });

    const out = await client.billing.checkout({ tier: 'growth' });
    expect(calls[0].url).toBe(`${BASE}/v1/billing/checkout`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ tier: 'growth' });
    expect(out.url).toBe('https://checkout.stripe.com/x');
  });
});

describe('Fidacy.webhooks', () => {
  it('constructEvent delegates to verifyWebhook and returns the event', async () => {
    const key = await makeTestKey();
    const event = { type: 'assessment.created', id: 'evt_1', data: { assessmentId: 'a1' } };
    const sig = await signEvent(key, event);

    // The SDK derives jwksUrl from baseUrl; inject a JWKS fetch matching that host.
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch: jwksFetch(key) });

    const out = await client.webhooks.constructEvent(JSON.stringify(event), sig);
    expect(out.type).toBe('assessment.created');
    expect(out.id).toBe('evt_1');
  });

  it('rejects a tampered signature', async () => {
    const key = await makeTestKey();
    const other = await makeTestKey();
    const event = { type: 'assessment.created', data: {} };
    const sig = await signEvent(key, event);

    // JWKS only contains `other` — signature won't verify.
    const client = new Fidacy({ apiKey: FAKE_KEY, fetch: jwksFetch(other) });
    await expect(
      client.webhooks.constructEvent(JSON.stringify(event), sig),
    ).rejects.toBeTruthy();
  });
});

describe('verify re-export', () => {
  it('exposes verifyRiskPayload and verifyWebhook at the top level', () => {
    expect(typeof verifyRiskPayload).toBe('function');
    expect(typeof verifyWebhook).toBe('function');
  });

  it('instance.verify is the verifyRiskPayload function', () => {
    const client = new Fidacy({ apiKey: FAKE_KEY });
    expect(client.verify).toBe(verifyRiskPayload);
  });
});

describe('baseUrl override', () => {
  it('uses a custom baseUrl for assess and derives the JWKS host', async () => {
    const { fetch, calls } = fetchMock([{ kind: 'json', status: 200, body: sampleAssess() }]);
    const client = new Fidacy({ apiKey: FAKE_KEY, baseUrl: 'https://eu.fidacy.com', fetch });
    await client.assess({ mandate: {} });
    expect(calls[0].url).toBe('https://eu.fidacy.com/v1/assess');
  });
});
