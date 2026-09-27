import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The three `/api/[...path]` proxies must drop the same headers.
 *
 * FE-3 gives every console its own copy of the same forwarder — admin,
 * seller and reseller — and a copy is a place drift hides. Two classes of
 * header must never cross it, and neither failure is visible in behaviour:
 *
 *   - REQUEST: `x-forwarded-for` / `x-real-ip` / `forwarded`. Caddy sets
 *     the real one on the hop that matters, and
 *     `client-info.decorator.ts` reads the LEFTMOST value for
 *     `audit_logs.metadata.ipAddress`. A browser-supplied copy arriving
 *     through the proxy is prepended to that chain and becomes the
 *     address every audit row records. The login throttle is unaffected
 *     (it uses `req.ip` with `trust proxy: 1`), which is exactly why the
 *     forgery would be silent — it only shows up in the trail somebody
 *     reads afterwards.
 *   - RESPONSE: `access-control-allow-*`. Every browser request here is
 *     same-origin so the browser enforces nothing from them, but relaying
 *     them republishes the API's cross-origin policy on OUR origin, where
 *     it is neither checked nor meant to apply.
 *
 * Read from the SOURCE, like the Permissions-Policy test: these are
 * build-time constants, so this is the earliest point the mistake is
 * visible, and seeing it in behaviour would need a live upstream that
 * sends the headers.
 */

const PROXIES = ['admin', 'seller', 'reseller'] as const;

const REQUIRED_REQUEST_DROPS = [
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  // The pre-existing set, restated so a future edit cannot quietly
  // remove one while adding the new ones.
  'host',
  'content-length',
  'accept-encoding',
] as const;

const REQUIRED_RESPONSE_DROPS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
  'content-encoding',
  'content-length',
] as const;

/** `apps/admin/src/tests` → `apps/<app>/src/app/api/[...path]/route.ts` */
function proxySource(app: string): string {
  return readFileSync(
    join(__dirname, '..', '..', '..', app, 'src', 'app', 'api', '[...path]', 'route.ts'),
    'utf8',
  );
}

/**
 * Comments out, THEN read the strings.
 *
 * These sets are heavily commented — each entry says why it is dropped —
 * and that prose contains apostrophes (`BROWSER's`, `shouldn't`). A naive
 * `/'([^']+)'/` over the raw text pairs those apostrophes with each
 * other and swallows the real entries between them, so the first version
 * of this helper reported 15 strings for a 14-entry set and lost the last
 * one. It failed loudly, which is the only reason it is worth a note: a
 * source-reading assertion is only as good as its parser.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** The literal strings inside one `new Set([...])` declaration. */
function dropSet(rawSource: string, constName: string, app: string): string[] {
  const source = stripComments(rawSource);
  const start = source.indexOf(`const ${constName} = new Set([`);
  if (start === -1) throw new Error(`${app}: no ${constName}`);
  const end = source.indexOf(']);', start);
  if (end === -1) throw new Error(`${app}: unterminated ${constName}`);
  const block = source.slice(start, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('the same-origin proxies drop the same headers', () => {
  it.each(PROXIES)('apps/%s drops the client-IP request headers', (app) => {
    const drops = dropSet(proxySource(app), 'REQUEST_DROP', app);
    for (const header of REQUIRED_REQUEST_DROPS) expect(drops).toContain(header);
  });

  it.each(PROXIES)('apps/%s drops the CORS response headers', (app) => {
    const drops = dropSet(proxySource(app), 'RESPONSE_DROP', app);
    for (const header of REQUIRED_RESPONSE_DROPS) expect(drops).toContain(header);
  });

  it('all three drop EXACTLY the same sets — a copy is where drift hides', () => {
    const request = PROXIES.map((a) => dropSet(proxySource(a), 'REQUEST_DROP', a).sort());
    const response = PROXIES.map((a) => dropSet(proxySource(a), 'RESPONSE_DROP', a).sort());
    expect(request[1]).toEqual(request[0]);
    expect(request[2]).toEqual(request[0]);
    expect(response[1]).toEqual(response[0]);
    expect(response[2]).toEqual(response[0]);
  });
});
