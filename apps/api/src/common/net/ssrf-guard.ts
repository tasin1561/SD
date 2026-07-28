import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * SSRF guard for the one place we fetch a URL a user gave us.
 *
 * ── THE HOLE THIS CLOSES ─────────────────────────────────────────────
 * A seller registers an outbound webhook endpoint and we POST to it from
 * inside the droplet. The DTO required https, which looks like it rules
 * out internal services (they speak http) — but `fetch` follows
 * redirects by default, so an attacker-controlled https endpoint could
 * answer `302 Location: http://169.254.169.254/metadata/v1.json` and we
 * would follow it to the DigitalOcean metadata service, whose response
 * includes the droplet's provisioning user-data. The dispatcher stores
 * the first 4000 bytes of every response.
 *
 * Nothing surfaces `responseBody` through an API today, which is the
 * only reason this was blind rather than a read primitive — and "no
 * endpoint returns it yet" is one obvious feature away from being
 * false.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────
 * Resolves the hostname and refuses if ANY address it resolves to is
 * outside public unicast space. Checking every answer matters: a host
 * that returns one public and one loopback address would otherwise pass
 * a first-answer check and then connect wherever the resolver felt like.
 *
 * ── WHAT IT DOES NOT DO, STATED PLAINLY ──────────────────────────────
 * This resolves, then `fetch` resolves again — so a DNS record that
 * changes between the two (rebinding) is not caught here. Closing that
 * needs the connect-time socket address, i.e. a custom undici dispatcher
 * with a `lookup` hook, which is not a dependency this app has. Two
 * things make the residual small: redirects are refused outright (see
 * `redirect: 'error'` at the call site), and https means the attacker
 * must also present a valid certificate for the hostname they rebound.
 * If undici is ever added for another reason, move the check to connect
 * time and delete this paragraph.
 */

/** Thrown when a URL points somewhere we refuse to fetch from. */
export class SsrfBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * True when the address is ordinary public internet space.
 *
 * Written as an explicit deny-list of the reserved ranges rather than an
 * allow-list, because the reserved set is the finite, documented one.
 */
export function isPublicUnicastAddress(address: string): boolean {
  if (isIPv4(address)) return isPublicIpv4(address);
  if (isIPv6(address)) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a = 0, b = 0, c = 0] = parts;

  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return false; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicIpv6(address: string): boolean {
  const addr = address.toLowerCase().split('%')[0] ?? '';

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible — unwrap and judge
  // the v4 address, otherwise every v4 rule above is trivially bypassed.
  const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped?.[2]) return isPublicIpv4(mapped[2]);

  if (addr === '::' || addr === '::1') return false; // unspecified, loopback
  if (/^f[cd]/.test(addr)) return false; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return false; // fe80::/10 link-local
  if (/^ff/.test(addr)) return false; // multicast
  if (addr.startsWith('2002:')) return false; // 6to4 — can embed a private v4
  if (addr.startsWith('64:ff9b:')) return false; // NAT64 — same
  return true;
}

/**
 * Parse, check the scheme, and refuse anything that resolves off the
 * public internet. Returns the parsed URL so callers do not parse twice.
 *
 * @throws SsrfBlockedError
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError('URL is not parseable');
  }

  if (url.protocol !== 'https:') {
    throw new SsrfBlockedError('URL must use https');
  }
  // Credentials in the URL are a redirect-laundering trick and have no
  // legitimate use on a webhook endpoint.
  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('URL must not embed credentials');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // A bare IP literal skips DNS entirely — judge it directly.
  if (isIPv4(host) || isIPv6(host)) {
    if (!isPublicUnicastAddress(host)) {
      throw new SsrfBlockedError('URL resolves to a non-public address');
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    // Fail closed. An endpoint we cannot resolve is one we cannot
    // establish is safe, and it was never going to deliver anyway.
    throw new SsrfBlockedError('URL hostname does not resolve');
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError('URL hostname does not resolve');
  }
  // EVERY answer must be public — see the class comment.
  for (const { address } of addresses) {
    if (!isPublicUnicastAddress(address)) {
      throw new SsrfBlockedError('URL resolves to a non-public address');
    }
  }
  return url;
}
