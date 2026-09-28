/**
 * What the browser asked for, and what refused it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Every Shiprocket panel job reported the same sentence for five days —
 * "the Shiprocket session has expired (landed on login)" — and that
 * sentence is what our code says for a dead upstream, a rotated
 * password, a captcha, an edge refusing the panel's own auth call, and
 * a genuinely expired session alike. All five look identical from
 * inside: the page ends up on `/newlogin`. So the alert named the
 * SYMPTOM and nobody could act on it without opening a terminal, and it
 * cost days.
 *
 * The browser already knows which call failed and with what. This
 * records it. Measured on 2026-09-28, it turns that one sentence into
 * "401 apiv2.shiprocket.co/v1/get/version" or "498 (preflight refused)
 * apiv2.shiprocket.co/v1/auth/login", which is the difference between a
 * five-day outage and a five-minute diagnosis.
 *
 * ── WHAT IT DELIBERATELY DROPS ───────────────────────────────────────
 * Query strings (their panel signs some of them, and this text goes into
 * a system issue a person reads), anything that is not Shiprocket's own
 * (their pages pull in analytics, ad pixels and Sentry, all of which
 * fail constantly through the tunnel and mean nothing), and duplicates.
 * A report that is mostly doubleclick.net is a report nobody finishes.
 */

/** Only the two methods this needs, so a test can hand in a fake. */
export interface WatchablePage {
  on(event: 'response', handler: (r: WatchedResponse) => void): void;
  on(event: 'requestfailed', handler: (r: WatchedRequest) => void): void;
}

export interface WatchedResponse {
  status(): number;
  url(): string;
}

export interface WatchedRequest {
  url(): string;
  failure(): { errorText: string } | null;
}

export interface PortalNetworkFailure {
  /** An HTTP status, or the transport error when the request never landed. */
  readonly status: number | string;
  readonly host: string;
  readonly path: string;
  readonly count: number;
}

/**
 * Hosts whose failures are ours to care about.
 *
 * Shiprocket's own, plus nothing else. `apiv2.shiprocket.co` in
 * particular is NOT a typo and must stay on this list: it is the host
 * their seller panel's `apiPath` points at (their published web bundle,
 * read 2026-09-28), so it is where every panel data call goes — while
 * our adapter talks to `apiv2.shiprocket.in`. The two are different
 * systems with similar names, and a 503 on one says nothing about the
 * other. That confusion is most of why this file exists.
 */
const OURS = /(^|\.)shiprocket\.(in|co)$/i;

/** Enough to see a pattern; short enough to read in an issue. */
const MAX_REPORTED = 8;

export function summariseNetworkFailures(failures: readonly PortalNetworkFailure[]): string | null {
  if (failures.length === 0) return null;
  const lines = failures
    .slice(0, MAX_REPORTED)
    .map((f) => `  ${f.status} ${f.host}${f.path}${f.count > 1 ? ` (×${f.count})` : ''}`);
  const more = failures.length - lines.length;
  return (
    'What the browser could not load:\n' +
    lines.join('\n') +
    (more > 0 ? `\n  …and ${more} more` : '')
  );
}

/**
 * Records the failed calls of every page in one browser context.
 *
 * Attached per page rather than per context because Playwright's
 * context-level events do not carry a response's status the same way,
 * and the session hands out a fresh tab per read anyway (their router
 * can leave a redirected tab unable to paint — see the session service).
 */
export class PortalNetworkWatch {
  private readonly seen = new Map<string, PortalNetworkFailure>();

  watch(page: WatchablePage): void {
    page.on('response', (r: WatchedResponse) => {
      const status = r.status();
      if (status < 400) return;
      this.record(status, r.url());
    });
    page.on('requestfailed', (r: WatchedRequest) => {
      const failure = r.failure();
      this.record(failure === null ? 'FAILED' : failure.errorText, r.url());
    });
  }

  private record(status: number | string, rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (!OURS.test(url.hostname)) return;
    // Path only: their panel signs some query strings, and this text is
    // read by a person in a system issue.
    const key = `${status} ${url.hostname}${url.pathname}`;
    const existing = this.seen.get(key);
    this.seen.set(
      key,
      existing === undefined
        ? { status, host: url.hostname, path: url.pathname, count: 1 }
        : { ...existing, count: existing.count + 1 },
    );
  }

  failures(): readonly PortalNetworkFailure[] {
    // Worst first: a 5xx says more than a 404 for a missing sprite, and
    // an auth path is what somebody is looking for.
    return [...this.seen.values()].sort((a, b) => {
      const rank = (f: PortalNetworkFailure): number =>
        /\/(auth|login|token)/i.test(f.path)
          ? 0
          : typeof f.status === 'number' && f.status === 401
            ? 1
            : typeof f.status === 'number' && f.status >= 500
              ? 2
              : 3;
      return rank(a) - rank(b) || b.count - a.count;
    });
  }

  summary(): string | null {
    return summariseNetworkFailures(this.failures());
  }
}
