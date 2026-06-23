/**
 * ingest.ts — the SSE ingest over CrabTrap's `GET /admin/events`.
 *
 * This is ONE pluggable source. The wire format is
 *   `event: audit_entry\ndata: <JSON>\n\n`
 * We parse `event: audit_entry` frames, JSON-parse the `data:`, normalize, and
 * yield `CrabTrapDecision`s. The SSE connect is SSRF-guarded.
 *
 * The core `observe()` never imports this — it only consumes the produced
 * `AsyncIterable<CrabTrapDecision>`. A Postgres/REST source could replace it.
 */
import { normalizeAuditEntry } from './normalize.js';
import { assertPublicUrl } from './ssrf.js';
import type { CrabTrapAuditEntry, CrabTrapDecision } from './types.js';

export interface SseSourceOptions {
  /** The CrabTrap events endpoint, e.g. `https://crabtrap.internal/admin/events`. */
  url: string;
  /** Optional bearer token for the admin endpoint. */
  token?: string;
  /** Override the fetch implementation (tests / custom runtimes). */
  fetch?: typeof fetch;
  /** Allow loopback/private hosts (local dev / the offline example). */
  allowInsecureHosts?: boolean;
  /** Abort the stream. */
  signal?: AbortSignal;
}

/**
 * Parse a single SSE event block (already split on the blank-line boundary).
 * Returns the `data` payload only for `event: audit_entry` blocks, else null.
 */
export function parseSseBlock(block: string): string | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      // Per the SSE spec, a leading single space after the colon is stripped.
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (event !== 'audit_entry') return null;
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}

/**
 * Connect to CrabTrap's SSE endpoint and yield normalized decisions.
 *
 * Bad/unparseable frames are skipped (not thrown) so one malformed event never
 * kills the stream. A non-2xx connect or a missing body DOES throw — that's a
 * setup error the caller should see.
 */
export async function* sseSource(
  options: SseSourceOptions,
): AsyncIterable<CrabTrapDecision> {
  const fetchImpl = options.fetch ?? fetch;
  assertPublicUrl(options.url, options.allowInsecureHosts ?? false);

  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const res = await fetchImpl(options.url, {
    method: 'GET',
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok) {
    throw new Error(`CrabTrap SSE connect failed: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error('CrabTrap SSE connect returned no body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  // `res.body` is a web ReadableStream<Uint8Array> in Node 18+ / edge.
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line (\n\n).
      let sep: number;
      while ((sep = indexOfBlankLine(buffer)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + blankLineLength(buffer, sep));
        const data = parseSseBlock(block);
        if (data === null) continue;
        const decision = safeNormalize(data);
        if (decision) yield decision;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Find the index of the first blank-line separator (\n\n or \r\n\r\n). */
function indexOfBlankLine(buffer: string): number {
  const a = buffer.indexOf('\n\n');
  const b = buffer.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function blankLineLength(buffer: string, sep: number): number {
  return buffer.startsWith('\r\n\r\n', sep) ? 4 : 2;
}

function safeNormalize(data: string): CrabTrapDecision | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  return normalizeAuditEntry(parsed as CrabTrapAuditEntry);
}
