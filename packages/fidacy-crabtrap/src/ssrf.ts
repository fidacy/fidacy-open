/**
 * ssrf.ts — a small SSRF guard shared by every new fetch the adapter makes
 * (the SSE connect + the trust-list fetch).
 *
 * It rejects requests to loopback, link-local, and RFC1918 private ranges
 * (the classic cloud-metadata / internal-service SSRF targets) UNLESS the
 * caller explicitly opts in via `allowInsecureHosts:true` (local dev / the
 * offline example).
 *
 * This is a hostname/literal-IP guard, not a full DNS-rebinding defense — it
 * blocks the obvious internal targets before we ever open a socket.
 */

export class SsrfBlockedError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`Refusing to connect to non-public host "${host}" (set allowInsecureHosts to override)`);
    this.name = 'SsrfBlockedError';
    this.host = host;
  }
}

/** Strip brackets from an IPv6 literal host, lowercase. */
function normalizeHost(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIPv6(host: string): boolean {
  if (host === '::1') return true; // loopback
  if (host === '::') return true; // unspecified
  if (host.startsWith('fe80')) return true; // link-local
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1 etc.) — defer to the IPv4 check on the tail.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** True when `host` is a loopback / private / link-local literal or name. */
export function isBlockedHost(host: string): boolean {
  const h = normalizeHost(host);
  if (h === 'localhost') return true;
  if (h.endsWith('.localhost')) return true;
  if (isPrivateIPv4(h)) return true;
  if (isPrivateIPv6(h)) return true;
  return false;
}

/**
 * Throw `SsrfBlockedError` unless `url`'s host is public (or the guard is
 * explicitly disabled). Returns the parsed URL on success.
 */
export function assertPublicUrl(url: string, allowInsecureHosts = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(url);
  }
  if (allowInsecureHosts) return parsed;
  if (isBlockedHost(parsed.hostname)) {
    throw new SsrfBlockedError(parsed.hostname);
  }
  return parsed;
}
