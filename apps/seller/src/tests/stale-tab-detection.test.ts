import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STALE_BUILD } from '@/app/(authed)/error';

/**
 * A tab running a build that no longer exists must RELOAD, not offer a
 * "Try again" that re-renders the same dead build.
 *
 * ── WHAT WENT WRONG ──────────────────────────────────────────────────
 * The detection matched only the chunk-loader family. On 7 October a
 * seller's open tab failed with "Cannot read properties of undefined
 * (reading 'length')" while the server log filled with "The Server
 * Reference ID did not match the expected format" — one stale tab, a
 * different symptom. Because the message did not match, the page showed
 * the generic failure and a button that could never work.
 *
 * Each string below is one a REPLACED BUILD actually produces, so each
 * is a case that would otherwise dead-end.
 */
describe('a deployed-over tab is recognised, whatever it says', () => {
  it.each([
    ['Loading chunk 482 failed.', 'route JS whose hash is gone'],
    ['ChunkLoadError: Loading chunk app/page failed', 'the same, named'],
    ['Failed to fetch dynamically imported module: /_next/static/x.js', 'a lazy import'],
    [
      'The Server Reference ID did not match the expected format. Received "c3fa0df4".',
      'a server action the new build does not have',
    ],
    [
      'Read more: https://nextjs.org/docs/messages/failed-to-find-server-action',
      'the same, by its docs link',
    ],
    [
      "ENOENT: no such file or directory, open '/app/apps/seller/.next/prerender-manifest.json'",
      'next start serving HTML naming files the rebuild deleted',
    ],
  ])('%s — %s', (message) => {
    expect(STALE_BUILD.test(message)).toBe(true);
  });

  /**
   * The other half, and the reason this is a pattern and not a
   * catch-all: reloading on every error would hide real faults behind a
   * flash, and the fault text on screen is how one gets reported rather
   * than guessed at.
   */
  it.each([
    'Cannot read properties of undefined (reading of some genuine bug)',
    'fetch failed',
    'Request failed with status code 500',
    'Invariant: expected app router to be mounted',
  ])('does NOT swallow a real fault: %s', (message) => {
    expect(STALE_BUILD.test(message)).toBe(false);
  });
});

/**
 * The three apps carry the same boundary. Copies drift, and a copy that
 * drifts here means one app dead-ends on a deploy while the others
 * recover — the hardest kind of bug to notice, because two thirds of the
 * estate is fine.
 */
describe('the three error boundaries agree', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..');
  const patternOf = (app: string): string => {
    const src = readFileSync(join(ROOT, 'apps', app, 'src/app/(authed)/error.tsx'), 'utf8');
    const m = /export const STALE_BUILD =\s*(\/.*\/i);/s.exec(src);
    const pattern = m?.[1];
    // A null here means the boundary was renamed and this guard is
    // watching nothing — louder than a silent pass.
    expect(pattern, `no STALE_BUILD in apps/${app}`).toBeDefined();
    return pattern ?? '';
  };

  it('seller, admin and reseller use one pattern', () => {
    expect(patternOf('admin')).toBe(patternOf('seller'));
    expect(patternOf('reseller')).toBe(patternOf('seller'));
  });
});
