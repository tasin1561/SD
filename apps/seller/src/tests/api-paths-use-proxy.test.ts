import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `client.request(...)` must go through the same-origin proxy.
 *
 * FE-3: the browser talks only to its own origin, and `/api/[...path]`
 * is the sole bridge to the API. `ApiClient` does NOT add that prefix —
 * `baseUrl` defaults to `''`, so the caller owns the whole path. A call
 * to `/admin/tickets` therefore asks the NEXT app for a page that does
 * not exist and gets its 404, which surfaces in the UI as a bare
 * "API 404:" with no message, because a Next 404 has no `code` or
 * `message` field to show.
 *
 * The admin app had this fault across 11 files before it was noticed
 * from a screenshot; the seller app shared it through its own
 * `ops-hooks.ts` and `account-hooks.ts`. Both are pinned, separately,
 * because each app owns its own callers.
 *
 * Nothing caught it because both sides are individually fine. The API
 * has the route. The page renders. Only the string joining them was
 * wrong, and no test looked at the string.
 */

const APP_SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      sourceFiles(full, out);
    } else if (
      /\.tsx?$/.test(entry) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Matches the first argument of a `client.request` call when it is a
 * path literal. The generic may contain `>` (Paginated<Row>), so it is
 * anchored on `(` instead — generic parameters never contain one.
 */
const REQUEST_PATH = /client\.request(?:<[^(]*?>)?\(\s*[`'"](\/[^`'"]*)/gs;

describe('FE-3 — every API call goes through the /api proxy (seller)', () => {
  const offenders: string[] = [];
  let total = 0;

  for (const file of sourceFiles(APP_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(REQUEST_PATH)) {
      total += 1;
      const path = m[1] ?? '';
      if (!path.startsWith('/api/')) {
        offenders.push(`${file.replace(APP_SRC, 'src')} → ${path}`);
      }
    }
  }

  it('finds the request calls at all', () => {
    // Without this, a refactor that changes how requests are issued
    // would leave the suite asserting nothing and passing forever.
    expect(total).toBeGreaterThan(20);
  });

  it('no request bypasses the proxy', () => {
    expect(offenders).toEqual([]);
  });
});
