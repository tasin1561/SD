import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every URL the API puts in an email must resolve to a real page.
 *
 * This exists because it did not. `staff.password_reset.email` and both
 * `email_verification` templates mailed links to
 * `/auth/reset-password` and `/auth/verify-email` on apps that had
 * neither route — so every staff password reset ever sent, and every
 * verification for either app, landed on a 404. The API side was
 * complete and correct; nothing connected it to the frontend, and
 * nothing was watching the join.
 *
 * The bug is invisible from either side alone. The API tests pass — it
 * built the string it meant to. The frontend tests pass — every page it
 * has, works. Only comparing the two finds it, which is what this does:
 * extract the paths the API interpolates onto `adminAppUrl` /
 * `sellerAppUrl`, and assert each has a `page.tsx`.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const API_SRC = join(REPO, 'apps', 'api', 'src');

/** Every .ts under a directory, recursively, excluding specs. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
}

interface EmailedUrl {
  readonly app: 'admin' | 'seller';
  readonly path: string;
  readonly file: string;
}

/**
 * Matches `${this.env.adminAppUrl}/auth/reset-password?token=...` and
 * friends, capturing which app and the path up to the query string.
 */
function extractEmailedUrls(): EmailedUrl[] {
  const pattern = /\$\{[^}]*\b(adminAppUrl|sellerAppUrl)\}(\/[A-Za-z0-9/_-]*)/g;
  const found: EmailedUrl[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      const app = m[1] === 'adminAppUrl' ? 'admin' : 'seller';
      const path = m[2] ?? '';
      // A bare origin (no path) or a dynamic segment is not a static
      // route we can assert on.
      if (path === '' || path === '/') continue;
      found.push({ app, path, file: file.replace(REPO, '') });
    }
  }
  return found;
}

function pageExists(app: 'admin' | 'seller', path: string): boolean {
  const appDir = join(REPO, 'apps', app, 'src', 'app');

  // A Next ROUTE GROUP — a directory named `(something)` — does not
  // appear in the URL, so `/leads` may live at `(authed)/leads`. Looking
  // only at the literal path made this check blind to every
  // authenticated page, which is most of them: it passed until now only
  // because the URLs we happened to email were all public ones.
  const candidates = [join(appDir, path, 'page.tsx')];
  try {
    for (const entry of readdirSync(appDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('(') && entry.name.endsWith(')')) {
        candidates.push(join(appDir, entry.name, path, 'page.tsx'));
      }
    }
  } catch {
    // No app directory — the miss is reported by the caller.
  }

  return candidates.some((c) => {
    try {
      statSync(c);
      return true;
    } catch {
      return false;
    }
  });
}

describe('emailed URLs resolve to real pages', () => {
  const urls = extractEmailedUrls();

  it('finds the URLs the API mails at all', () => {
    // Guards the regex: if a refactor changes how the app origin is
    // interpolated, this suite would otherwise silently assert nothing
    // and stay green while the links rot.
    expect(urls.length).toBeGreaterThanOrEqual(4);
  });

  it('every mailed path has a page.tsx in its app', () => {
    const broken = urls
      .filter((u) => !pageExists(u.app, u.path))
      .map((u) => `apps/${u.app} has no page for ${u.path}  (mailed from ${u.file})`);

    expect(broken).toEqual([]);
  });

  it.each([
    ['admin', '/auth/reset-password'],
    ['admin', '/auth/verify-email'],
    ['seller', '/auth/reset-password'],
    ['seller', '/auth/verify-email'],
    ['admin', '/auth/accept-invitation'],
    ['seller', '/auth/accept-team-invitation'],
  ] as const)('%s serves %s', (app, path) => {
    // Pinned individually as well: the sweep above only checks what the
    // API currently mails, so deleting the mail would also delete the
    // coverage. These are the flows a user cannot recover without.
    expect(pageExists(app, path)).toBe(true);
  });
});
