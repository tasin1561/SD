import { makeTestEnv } from '../helpers/env';

/**
 * CON-1 — `EnvService.corsOrigins` is the browser-origin allowlist, and
 * until 2026-10-13 it had ONE consumer (`main.ts`) and NO test.
 *
 * Two things it has to get right, both of which read as deletable:
 *
 * (a) **All FOUR consoles.** The associate console has been its own
 *     origin since ASSOC-1 and was simply missing from the list —
 *     harmless so far only because FE-3 means a browser talks to its own
 *     origin and each console proxies `/api/*` server-to-server. A list
 *     that omits a live console answers the wrong question the first
 *     time somebody relies on it.
 *
 * (b) **The OLD hostnames as well as the new.** The 2026-10-13 rename
 *     left `app.` / `reseller.` / `portal.` SERVING rather than
 *     redirecting, because a `__Host-` cookie is bound to the exact
 *     origin that set it. `LEGACY_CONSOLE_ORIGINS` is hard-coded — a
 *     fixed, finite, CLOSING set, not a knob — and looks exactly like
 *     dead weight to anybody tidying up. Removing it would refuse
 *     cross-origin requests from a hostname that is still live.
 *
 * It only ever SHRINKS: when a name goes quiet it becomes a `redir` in
 * Caddy and its entry comes out of the constant. That is a deliberate
 * act, and this spec is what makes it one.
 */
describe('CON-1 — EnvService.corsOrigins', () => {
  it('carries all four consoles from env, not three', () => {
    const env = makeTestEnv();
    for (const url of [
      env.sellerAppUrl,
      env.adminAppUrl,
      env.resellerAppUrl,
      env.associateAppUrl,
    ]) {
      expect(env.corsOrigins).toContain(url);
    }
  });

  it('carries the pre-rename hostnames, which still serve', () => {
    const env = makeTestEnv();
    expect(env.corsOrigins).toEqual(
      expect.arrayContaining([
        'https://app.skydrop.global',
        'https://reseller.skydrop.global',
        'https://portal.skydrop.global',
      ]),
    );
  });

  it('has no duplicate entry when env already names a legacy origin', () => {
    // The transition state: production points SELLER_APP_URL at the new
    // name, but a staging or rollback config may still name the old one.
    // Listing an origin twice is harmless to the CORS middleware and a
    // signal of a broken merge, so it is deduped rather than tolerated.
    const env = makeTestEnv({ SELLER_APP_URL: 'https://app.skydrop.global' });
    expect(env.corsOrigins).toEqual([...new Set(env.corsOrigins)]);
    expect(env.corsOrigins.filter((o) => o === 'https://app.skydrop.global')).toHaveLength(1);
  });

  it('is every console plus the legacy set, and nothing else', () => {
    // Pins the SIZE too: an origin added here is a new place the API
    // will answer a browser from, which is a decision and not a tidy-up.
    const env = makeTestEnv();
    expect(env.corsOrigins).toHaveLength(7);
  });
});
