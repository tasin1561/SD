import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const DIRECTORY = join(REPO, 'packages', 'ui', 'src', 'app', 'sign-in', 'portals.tsx');

/**
 * EVERY console a customer can sign in to is in the ONE console
 * directory, and every console's sign-in pages offer the others.
 *
 * ── THE FAILURE THIS EXISTS FOR, WHICH ALREADY HAPPENED ──────────────
 * ASSOC-1 shipped `associate.skydrop.global` on 2026-10-08. For six days
 * nothing anywhere linked to it: the marketing site's sign-in menu
 * listed two consoles, and each console's sign-in page carried ONE
 * hand-written link to ONE other console. So a sales person who landed
 * on the client portal could reach the store portal and from there only
 * the client portal again — never their own. Nothing failed, nothing
 * looked broken, and that is the point: an app missing from an
 * enumeration is an app that is silently unreachable, and the output
 * looks identical either way. The same shape as the `APPS` list in
 * `scripts/check-page-permissions.py`, which printed three clean apps
 * while the fourth was checked nowhere.
 *
 * So: a new customer console is not finished until it is in `CONSOLES`.
 * This test is what says so.
 *
 * ── WHY ADMIN IS NOT IN THE DIRECTORY, AND IS NOT A FAILURE HERE ─────
 * `admin.skydrop.global` is Skydrop's own operations console. Nobody
 * arrives at a customer portal looking for it, and advertising its
 * address on three public sign-in pages is noise for every real visitor.
 * It is named in EXPECTED_ABSENT below so the exemption is a decision
 * somebody wrote down rather than an omission that reads the same.
 */

/** Customer consoles: the app directory, and the key it must carry in `CONSOLES`. */
const CUSTOMER_CONSOLES = [
  { app: 'seller', key: 'client' },
  { app: 'reseller', key: 'store' },
  { app: 'associate', key: 'associate' },
] as const;

/** Apps with a /login that deliberately do NOT appear in the chooser, and why. */
const EXPECTED_ABSENT: Record<string, string> = {
  admin: "Skydrop's own operations console — staff know where they work",
};

describe('the console directory is complete', () => {
  const src = readFileSync(DIRECTORY, 'utf8');

  it.each(CUSTOMER_CONSOLES)('apps/$app is in CONSOLES as "$key"', ({ key }) => {
    expect(src).toContain(`key: '${key}'`);
  });

  it('lists exactly the customer consoles — no more, no fewer', () => {
    const keys = [...src.matchAll(/key: '([a-z]+)',/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(CUSTOMER_CONSOLES.map((c) => c.key).sort());
  });

  it('names every app that has a /login but is deliberately absent', () => {
    // Read the apps directory rather than a list, so a NEW console with a
    // login page cannot be silently neither-included-nor-exempted.
    const withLogin = readdirSync(join(REPO, 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((app) => existsSync(join(REPO, 'apps', app, 'src', 'app', 'login', 'page.tsx')));

    const accounted = new Set<string>([
      ...CUSTOMER_CONSOLES.map((c) => c.app),
      ...Object.keys(EXPECTED_ABSENT),
    ]);
    const unaccounted = withLogin.filter((app) => !accounted.has(app));
    expect(
      unaccounted,
      'A console with a sign-in page is either in CONSOLES (so everybody can reach it) ' +
        'or in EXPECTED_ABSENT with the reason it is hidden. Neither is the default.',
    ).toEqual([]);
  });
});

describe('every console offers the others', () => {
  /**
   * The pages a lost visitor actually lands on. `/password-reset` is in
   * the list for a worse reason than `/login`: the API answers a reset
   * request identically whether or not the email has an account there
   * (anti-enumeration), so somebody in the wrong console is told a link
   * is on its way and then gets nothing — a dead end that reads as
   * success.
   */
  const PAGES = ['login', 'password-reset', 'sign-up'] as const;

  it.each(CUSTOMER_CONSOLES.flatMap(({ app, key }) => PAGES.map((page) => ({ app, key, page }))))(
    'apps/$app /$page mounts OtherPortals with self="$key"',
    ({ app, key, page }) => {
      const file = join(REPO, 'apps', app, 'src', 'app', page, 'page.tsx');
      expect(existsSync(file), `${app}/${page} should exist`).toBe(true);
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('OtherPortals');
      expect(src).toContain(`self="${key}"`);
    },
  );

  it('the marketing site offers all three too', () => {
    // The public front door. It listed two of three until 2026-10-14.
    const src = readFileSync(join(REPO, 'apps', 'marketing', 'src', 'content', 'site.ts'), 'utf8');
    const menu = src.slice(src.indexOf('signIn: ['), src.indexOf('cta: {'));
    for (const host of [
      'client.skydrop.global',
      'member.skydrop.global',
      'associate.skydrop.global',
    ]) {
      expect(menu).toContain(host);
    }
  });
});
