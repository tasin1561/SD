/**
 * Every email template code a dispatcher can emit has a template.
 *
 * `NotificationDispatchService` falls back to `templateCode ?? topic`,
 * so a caller that names no template asks for one called after its
 * TOPIC. `SystemIssueNotifier` did exactly that and there has never been
 * a `system_issue.<kind>` template for any kind — so every CRITICAL
 * system-issue email failed on TEMPLATE_NOT_FOUND, retried five times
 * and was given up on. The channel that exists to reach somebody who is
 * NOT looking at the admin app failed silently in the case it exists
 * for, and the only trace was an EmailWorker issue nobody tied back.
 *
 * Nothing else could see it. The code is a string, so it typechecks; the
 * unit tests mock the queue, so nothing resolves it; the e2e suite runs
 * with an empty RESEND_API_KEY, and the failure is inside a worker
 * rather than on the request path. It is STRUCTURAL for that reason:
 * read the codes out of the sources, read the seeded codes out of the
 * seed, and compare.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED = join(__dirname, '../../../../packages/db/prisma/seed.ts');
const API_SRC = join(__dirname, '../../src');

/** Every `code: '...'` in the notification-template list. */
function seededCodes(): Set<string> {
  const src = readFileSync(SEED, 'utf8');
  return new Set(Array.from(src.matchAll(/^\s{4}code: '([^']+)',$/gm), (m) => m[1] ?? ''));
}

/** Every `templateCode: '<literal>'` handed to a queue or dispatcher. */
function dispatchedCodes(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/templateCode: '([^']+)'/g)) {
          out.push({ file: p.replace(/.*\/src\//, 'src/'), code: m[1] ?? '' });
        }
        // A named constant assigned a template-looking literal counts
        // too — `SYSTEM_ALERT_TEMPLATE = 'system.alert.email'` is the
        // shape that made this bug fixable, and hiding a code behind a
        // constant must not hide it from this check.
        for (const m of src.matchAll(/_TEMPLATE = '([^']+)'/g)) {
          out.push({ file: p.replace(/.*\/src\//, 'src/'), code: m[1] ?? '' });
        }
      }
    }
  };
  walk(API_SRC);
  return out;
}

describe('every dispatched template code is seeded', () => {
  const seeded = seededCodes();

  it('the seed scan still works', () => {
    // If the seed's shape changes this returns nothing and every
    // assertion below passes vacuously.
    expect(seeded.size).toBeGreaterThan(20);
    expect(seeded.has('system.announcement.email')).toBe(true);
  });

  it('the carrier for a system-issue email exists', () => {
    // The specific hole: NOTIF-16 emails CRITICAL issues, and it had
    // nothing to render with.
    expect(seeded.has('system.alert.email')).toBe(true);
  });

  it('no source names a template that was never seeded', () => {
    const missing = dispatchedCodes()
      .filter((d) => !seeded.has(d.code))
      .map((d) => `${d.file} → ${d.code}`);
    expect(missing).toEqual([]);
  });
});
