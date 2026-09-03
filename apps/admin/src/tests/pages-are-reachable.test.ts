import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every page has a way in.
 *
 * The route checker answers "does this API endpoint have a caller".
 * This is the same question one level up: does this PAGE have a link.
 * Neither existing check saw it, and `/account` shipped with no entry in
 * the nav, no tile, and no link anywhere — a screen you could only reach
 * by typing the URL, which is indistinguishable from not shipping it.
 *
 * A page is reachable if any other source file names its path. That
 * includes an `href` attribute, an `href:` property in a tile or nav
 * array, and a `router.push`. The first version of this check only
 * looked for `href="..."`, missed the tile arrays entirely, and would
 * have reported four working pages as dead — a check that cries wolf is
 * a check people delete.
 */

const APP = join(__dirname, '../app/(authed)');
const SRC = join(__dirname, '..');

/** Every route under the (authed) group, as a URL path. */
function routes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // `_components` is not a route segment; a route group `(x)` adds none.
    if (entry.startsWith('_')) continue;
    const seg = entry.startsWith('(') ? '' : `/${entry}`;
    const path = `${prefix}${seg}`;
    if (readdirSync(full).includes('page.tsx') && path !== '') out.push(path);
    out.push(...routes(full, path));
  }
  return out;
}

/** Every source file's text, excluding the page's own directory. */
function sources(dir: string, skip: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === skip) continue;
      out.push(...sources(full, skip));
    } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}

/**
 * Routes nothing links to ON PURPOSE, with the reason.
 *
 * A dynamic route is reached by an interpolated href the scan below
 * cannot match as a literal, so it is listed here rather than papered
 * over with a looser matcher that would stop catching real dead ends.
 */
const EXPECTED_UNLINKED = new Set<string>([
  '/dashboard', // the post-login landing page; the brand mark points here
  // RETIRED as the ordinary path (2026-09-03) — batch picking at
  // /warehouse/printing replaced it and owns the nav. This screen is
  // kept because serialised stock cannot be closed from paper: the scan
  // here is what binds units to a parcel, and packing compares against
  // exactly those (UNIT-2). Linking it would offer two ways to do the
  // same job, only one of which anybody should take.
  '/warehouse/pick',
  // Auto-pickup is a standing-ON decision (2026-09-03, CUR-10 amendment
  // #3 + its same-day addendum): the first box packed each day asks the
  // courier for a van on its own, so the ordinary case needs nobody to
  // visit this screen. Kept, unlinked, for the case that decision
  // explicitly named: a FAILED day is not auto-retried, and releasing
  // one plus manually re-raising immediately — rather than waiting for
  // the next box to close — is done here.
  '/warehouse/pickups',
]);

describe('every admin page can be reached from another page', () => {
  const all = routes(APP).filter((r) => !r.includes('['));

  it('found a realistic number of routes (the walker still works)', () => {
    // If a refactor moves the app directory this returns 0 and every
    // assertion below passes vacuously.
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all.filter((r) => !EXPECTED_UNLINKED.has(r)))('%s is linked from somewhere', (route) => {
    const ownDir = join(APP, ...route.split('/').filter(Boolean));
    const text = sources(SRC, ownDir).join('\n');
    // Matches href="/x", href={'/x'}, href: '/x', push('/x') — every
    // shape the codebase actually uses to point at a route.
    const linked = text.includes(`'${route}'`) || text.includes(`"${route}"`);
    const asChild = text.includes(`'${route}/`) || text.includes(`"${route}/`);
    expect(linked || asChild).toBe(true);
  });
});
