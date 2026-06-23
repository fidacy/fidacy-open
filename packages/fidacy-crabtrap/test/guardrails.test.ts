import { describe, expect, it } from 'vitest';
import { sseSource } from '../src/ingest.js';
import { isBlockedHost } from '../src/ssrf.js';
import { assertKidInTrustList } from '../src/verify.js';

const BLOCKED = [
  'http://169.254.169.254/admin/events', // cloud metadata
  'http://127.0.0.1:8080/admin/events', // loopback
  'http://10.0.0.5/admin/events', // RFC1918
  'http://192.168.1.1/admin/events', // RFC1918
  'http://172.16.0.1/admin/events', // RFC1918
  'http://[::1]/admin/events', // IPv6 loopback
  'http://localhost/admin/events', // loopback name
];

function neverFetch(): typeof fetch {
  return (async () => {
    throw new Error('fetch must not be called when SSRF-blocked');
  }) as unknown as typeof fetch;
}

describe('isBlockedHost', () => {
  it('flags loopback / private / link-local literals and names', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('10.1.2.3')).toBe(true);
    expect(isBlockedHost('172.20.0.1')).toBe(true);
    expect(isBlockedHost('192.168.0.1')).toBe(true);
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('localhost')).toBe(true);
    // Public hosts pass.
    expect(isBlockedHost('api.fidacy.com')).toBe(false);
    expect(isBlockedHost('8.8.8.8')).toBe(false);
    expect(isBlockedHost('172.32.0.1')).toBe(false); // just outside 172.16/12
  });
});

describe('sseSource SSRF guard', () => {
  for (const url of BLOCKED) {
    it(`rejects internal/link-local/loopback host: ${url}`, async () => {
      const it = sseSource({ url, fetch: neverFetch() })[Symbol.asyncIterator]();
      await expect(it.next()).rejects.toThrow();
    });
  }

  it('allows a blocked host when allowInsecureHosts:true (then fails at fetch, not the guard)', async () => {
    const calls: string[] = [];
    const fetchMock = (async (u: string) => {
      calls.push(u);
      // Return a tiny SSE stream with one audit_entry to prove the guard passed.
      const body = `event: audit_entry\ndata: ${JSON.stringify({
        decision: 'ALLOW',
        method: 'GET',
        url: 'https://api.vendor.com/v1/ping',
        timestamp: '2026-06-22T10:00:00Z',
        user_id: 'a@b.co',
        approved_by: 'llm-static-rule',
      })}\n\n`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;

    const iter = sseSource({
      url: 'http://127.0.0.1:9999/admin/events',
      fetch: fetchMock,
      allowInsecureHosts: true,
    });
    const first = await iter[Symbol.asyncIterator]().next();
    expect(calls.length).toBe(1);
    expect(first.value?.decision).toBe('allow');
  });
});

describe('assertKidInTrustList SSRF guard', () => {
  it('rejects a non-public trustListUrl and never fetches', async () => {
    await expect(
      assertKidInTrustList('kid-A', {
        trustListUrl: 'http://169.254.169.254/trust-list.json',
        fetch: neverFetch(),
      }),
    ).rejects.toThrow();
  });
});
