import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anything that reads the auth context must be mounted INSIDE
 * `AuthProvider`.
 *
 * `useAuthCtx` throws when the provider is not above it — deliberately,
 * so a wiring mistake surfaces at once. What that means in an App
 * Router layout is harsher than it sounds: the throw happens on the
 * first client render of the layout itself, so every page in the route
 * group dies with "Application error: a client-side exception has
 * occurred" and no page-level boundary can catch it.
 *
 * That shipped on 2026-10-27. `UatFieldsBoundary` calls `useApiClient()`
 * and was mounted one level ABOVE `AuthProvider` in all three consoles,
 * which took out every authed page in the seller, member-store and
 * associate apps. Nothing caught it: the layouts are async server
 * components that no unit test renders, the suites are per-app, and
 * typecheck cannot see a React context.
 *
 * So the check is structural, and it reads all three layouts from here
 * rather than living three times over — same idiom as the permission
 * cross-check next door, which reads the API's source for the same
 * reason (different app, different tsconfig).
 */

const LAYOUTS = [
  ['seller', join(__dirname, '../app/(authed)/layout.tsx')],
  ['reseller', join(__dirname, '../../../reseller/src/app/(authed)/layout.tsx')],
  ['associate', join(__dirname, '../../../associate/src/app/(authed)/layout.tsx')],
] as const;

/** Components in the authed tree that call a hook needing auth context. */
const AUTH_CONTEXT_CONSUMERS = ['UatFieldsBoundary'] as const;

describe('the authed layout mounts auth-context consumers inside AuthProvider', () => {
  for (const [app, path] of LAYOUTS) {
    const src = readFileSync(path, 'utf8');
    const provider = src.indexOf('<AuthProvider');

    it(`${app}: mounts AuthProvider`, () => {
      expect(provider).toBeGreaterThan(-1);
    });

    for (const consumer of AUTH_CONTEXT_CONSUMERS) {
      it(`${app}: ${consumer} sits below AuthProvider`, () => {
        const at = src.indexOf(`<${consumer}>`);
        if (at === -1) return; // not mounted in this console — nothing to order.
        expect(
          at,
          `<${consumer}> opens before <AuthProvider> in apps/${app}'s authed layout. ` +
            'It reads the auth context, so useAuthCtx throws on first render and ' +
            'every authed page in that console shows a client-side exception.',
        ).toBeGreaterThan(provider);
      });
    }
  }
});
