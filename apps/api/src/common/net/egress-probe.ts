/**
 * Where a proxied browser is coming out, asked before it is used.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * Shiprocket's seller panel refuses the DigitalOcean address outright:
 * measured 2026-09-28, their own `/v1/auth/login` returns 200 with a
 * valid JWT and every call afterwards is 401 with a bounce to
 * `/newlogin` — identically from Dhaka and from the Bangalore droplet,
 * while the owner's own Chrome through a consumer VPN works. So the
 * panel browser now goes out through a NordVPN container on the app
 * server, and "which address are we presenting" stopped being trivia
 * and became the thing the run depends on.
 *
 * The container's own firewall already makes this fail CLOSED in the
 * hard sense — while the tunnel is down or reconnecting it passes no
 * traffic at all, so a browser pointed at its proxy fails rather than
 * quietly going out directly. What that does NOT catch is a VPN that is
 * perfectly healthy in the WRONG PLACE, which is not hypothetical: on
 * 2026-09-28 a misconfiguration left it connected to an Indian entry
 * node while egressing in Atlanta, and the only sign was a 403 on the
 * panel's own document buried in a browser trace. This asks the
 * question directly, before a sign-in is spent on it.
 *
 * ── WHAT IT TALKS TO ─────────────────────────────────────────────────
 * gluetun's control server on loopback, whose `/v1/publicip/ip` answers
 * `{"public_ip":"…","country":"…","city":"…"}` — and `{"public_ip":""}`
 * while the tunnel is not carrying traffic, which is the whole reason
 * an empty string is read as DOWN rather than as an answer.
 *
 * No DI and no Prisma: the portal worker asks it before launching a
 * browser and the API asks it to draw the same fact on /cost-sync, and
 * those two live in modules that may not import each other (the portal
 * owns a courier login and is unreachable from AppModule by design).
 */

/** What the egress says about itself. */
export interface EgressReading {
  readonly publicIp: string;
  /** As the probe reports it — a name ("India"), not a code. */
  readonly country: string | null;
  readonly city: string | null;
}

export type EgressProbeResult =
  | { readonly kind: 'UP'; readonly reading: EgressReading }
  | { readonly kind: 'DOWN'; readonly reason: string };

/** Short: this runs before a job, and a hung probe is a hung night. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Only the shape this needs, so a test can hand in a fake. */
export type FetchLike = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Ask the control server where we are coming out.
 *
 * NEVER throws: every caller is deciding whether to start, and a probe
 * that throws its own transport errors would make "the VPN is down" and
 * "the probe is broken" two different code paths when they have the
 * same answer — do not run.
 */
export async function probeEgress(
  url: string,
  opts: { readonly fetchImpl?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<EgressProbeResult> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok) return { kind: 'DOWN', reason: `the egress check answered ${res.status}` };
    const body: unknown = await res.json();
    if (body === null || typeof body !== 'object') {
      return { kind: 'DOWN', reason: 'the egress check answered something that is not an object' };
    }
    const o = body as Record<string, unknown>;
    const publicIp = readString(o, 'public_ip');
    // An empty string is gluetun saying the tunnel is not carrying
    // traffic — an answer, and a NO.
    if (publicIp === null) return { kind: 'DOWN', reason: 'the VPN is not reporting a public IP' };
    return {
      kind: 'UP',
      reading: { publicIp, country: readString(o, 'country'), city: readString(o, 'city') },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'DOWN', reason: `the egress check could not be reached (${message})` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this the country we meant to come out in?
 *
 * Case- and space-insensitive, and an EMPTY expectation means "anywhere,
 * as long as the VPN is up" — which is the honest reading of an unset
 * setting rather than a silent match-nothing.
 */
export function egressCountryMatches(reading: EgressReading, expected: string): boolean {
  const want = expected.trim().toLowerCase();
  if (want === '') return true;
  return (reading.country ?? '').trim().toLowerCase() === want;
}

/** One line for an issue, a log or a panel. */
export function describeEgress(reading: EgressReading): string {
  const where = [reading.city, reading.country].filter((p) => p !== null).join(', ');
  return where === '' ? reading.publicIp : `${reading.publicIp} (${where})`;
}
