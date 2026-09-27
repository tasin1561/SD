import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY controller either names a guard or is listed here as public.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────
 * The three permission-surface specs (staff / seller / store) each open
 * with `if (!src.includes('<X>JwtGuard')) return` — necessarily, since
 * each is about one identity. The consequence is that a controller
 * shipped with NO `@UseGuards` at all is invisible to all three: it is
 * both unauthenticated AND absent from every assertion, so nothing in the
 * suite has an opinion about it. An endpoint that should have been gated
 * and was not looks exactly like one nobody has written yet.
 *
 * This is the one assertion that sees the whole estate. It cannot know
 * whether a given controller SHOULD be public — that is a judgement — so
 * it demands the judgement be written down, which is the same shape
 * `EXPECTED_UNLINKED` uses in `pages-are-reachable.test.ts`: the list is
 * the decision, and adding to it costs a line and a reason.
 *
 * A handler-level `@UseGuards` counts (the inbound-email controller is
 * `@Public()` plus its own HMAC guard — that IS a declared guard).
 */

const SRC = join(__dirname, '../../src');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/**
 * Controllers that are DELIBERATELY reachable with no token, each with the
 * reason it has to be.
 *
 * Every one of them is a surface a stranger must be able to reach: a
 * webhook from a courier, a probe from the load balancer, or the act of
 * redeeming an invitation, which by definition has no account behind it
 * yet. Each carries its own protection instead of a guard — an HMAC over
 * the raw bytes, a one-time token, or an IP rate limit — and those are
 * the M10 / M18 invariants, not this file's business. What IS this file's
 * business is that the list has exactly these entries.
 */
const PUBLIC_CONTROLLERS: Readonly<Record<string, string>> = {
  // TRK-1: HMAC over the exact raw request bytes, verified BEFORE the row
  // is stored. A courier cannot present a bearer token.
  'public-webhook.controller.ts': 'courier tracking webhooks — HMAC-authenticated (TRK-1)',
  'public-document-webhook.controller.ts': 'courier document webhooks — HMAC-authenticated',
  // TRK-8: the customer-safe projection, IP-throttled to 30/min, with a
  // single generic 404 across every miss reason. A customer has no login
  // in Phase-1A — that is the whole point of the page.
  'public-tracking.controller.ts': 'the public AWB lookup a customer opens — TRK-8',
  // M18 is a stub that acks and stores nothing; HMAC + a dedup ledger are
  // deferred to the droplet install, which is where the secret comes from.
  'public-chatwoot-webhook.controller.ts': 'ChatWoot webhook ack — M18 stub',
  // Redeeming an invitation: there is no account to authenticate as until
  // the call succeeds. The one-time token IS the credential, and it is
  // looked up by sha256 of what was presented.
  'staff-invitation-public.controller.ts':
    'accept a staff invitation — the token is the credential',
  'seller-team-public.controller.ts': 'accept a seller team invitation — same',
  // A stranger asking to be invited. Rate-limited; it creates a lead row
  // and nothing else.
  'public-invite-lead.controller.ts': 'marketing invite-request form',
  // Liveness/readiness. A probe that needed a token would not be a probe.
  'health.controller.ts': 'health and readiness probes',
};

describe('every controller declares a guard, or is a named public surface', () => {
  const files = controllerFiles(SRC);

  it('finds the controllers (a walker matching nothing would pass everything)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('nothing is silently unguarded', () => {
    const unguarded = files
      .filter((f) => !readFileSync(f, 'utf8').includes('@UseGuards'))
      .map((f) => f.slice(f.lastIndexOf('/') + 1))
      .filter((name) => !(name in PUBLIC_CONTROLLERS))
      .sort();
    expect(unguarded).toEqual([]);
  });

  it('the public list has no stale entries', () => {
    // A controller that has SINCE been given a guard must leave the list,
    // or the list stops being a statement about anything.
    const actuallyUnguarded = new Set(
      files
        .filter((f) => !readFileSync(f, 'utf8').includes('@UseGuards'))
        .map((f) => f.slice(f.lastIndexOf('/') + 1)),
    );
    const stale = Object.keys(PUBLIC_CONTROLLERS)
      .filter((name) => !actuallyUnguarded.has(name))
      .sort();
    expect(stale).toEqual([]);
  });

  it('every public surface is under a path that says so', () => {
    // `public/…`, `health`, or `auth/…` for the two invitation-accept
    // controllers. A public controller mounted under `admin/` or
    // `seller/` would read as authenticated to everybody looking at the
    // route table, which is how one gets missed.
    const bad: string[] = [];
    for (const f of files) {
      const name = f.slice(f.lastIndexOf('/') + 1);
      if (!(name in PUBLIC_CONTROLLERS)) continue;
      const prefix = /@Controller\('([^']*)'\)/.exec(readFileSync(f, 'utf8'))?.[1] ?? '';
      if (!/^(public\/|health$|auth\/)/.test(prefix)) bad.push(`${name} → '${prefix}'`);
    }
    expect(bad).toEqual([]);
  });
});
