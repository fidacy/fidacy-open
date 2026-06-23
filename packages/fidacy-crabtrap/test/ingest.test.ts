import { describe, expect, it } from 'vitest';
import { parseSseBlock, sseSource } from '../src/ingest.js';

describe('parseSseBlock', () => {
  it('returns the data for an audit_entry block', () => {
    const block = 'event: audit_entry\ndata: {"decision":"ALLOW"}';
    expect(parseSseBlock(block)).toBe('{"decision":"ALLOW"}');
  });

  it('ignores non-audit_entry events', () => {
    expect(parseSseBlock('event: heartbeat\ndata: {}')).toBeNull();
  });

  it('ignores comment/heartbeat lines and strips one leading data space', () => {
    const block = ': keep-alive\nevent: audit_entry\ndata: {"x":1}';
    expect(parseSseBlock(block)).toBe('{"x":1}');
  });
});

describe('sseSource streaming', () => {
  it('yields normalized decisions across chunk boundaries and skips bad frames', async () => {
    const f1 = JSON.stringify({
      decision: 'DENY',
      method: 'POST',
      url: 'https://api.vendor.com/charge',
      timestamp: '2026-06-22T10:00:00Z',
      user_id: 'a@b.co',
      llm_reason: 'too big',
      channel: 'llm',
      llm_policy_id: 'pol_1',
    });
    const f2 = JSON.stringify({
      decision: 'TIMEOUT',
      method: 'GET',
      url: 'https://api.vendor.com/balance',
      timestamp: '2026-06-22T10:01:00Z',
      user_id: 'a@b.co',
      approved_by: 'llm-fallback',
    });

    // Frame 1, then a malformed frame, then frame 2 — split mid-frame to test buffering.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`event: audit_entry\ndata: ${f1}\n\n`));
        controller.enqueue(enc.encode('event: audit_entry\ndata: {not json}\n\nevent: audit_'));
        controller.enqueue(enc.encode(`entry\ndata: ${f2}\n\n`));
        controller.close();
      },
    });

    const fetchMock = (async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const out = [];
    for await (const d of sseSource({ url: 'https://crabtrap.example/admin/events', fetch: fetchMock })) {
      out.push(d);
    }

    expect(out).toHaveLength(2);
    expect(out[0].decision).toBe('deny');
    expect(out[0].policyId).toBe('pol_1');
    expect(out[1].decision).toBe('timeout');
    expect(out[1].reason).toBe('llm judge unavailable, passthrough');
  });

  it('throws on a non-2xx connect', async () => {
    const fetchMock = (async () =>
      new Response('nope', { status: 401 })) as unknown as typeof fetch;
    const iter = sseSource({ url: 'https://crabtrap.example/admin/events', fetch: fetchMock });
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toThrow();
  });
});
