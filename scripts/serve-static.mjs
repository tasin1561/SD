#!/usr/bin/env node
/**
 * Serve a Next.js static export the way the production edge serves it.
 *
 * `apps/marketing` is `output: 'export'`, which means `next start`
 * refuses to run it ("does not work with output: export") — so it is the
 * one frontend with no server of its own, and until now the only way to
 * put a browser in front of it was `npx serve`, a package download at
 * run time. That is fine on a laptop and a poor idea in CI, where a
 * network hiccup becomes a red build with nothing wrong in the repo.
 *
 * ── Why this and not any static server ───────────────────────────────
 * The export writes `out/request-invite.html`, but every link and every
 * canonical URL says `/request-invite`. A plain file server 404s on it.
 * Production works because Caddy runs `try_files {path} {path}.html
 * {path}/index.html`, and that resolution IS part of what makes the site
 * work — so a test server that does not do it is testing a different
 * site. The lookup order below is that directive.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────
 * It sends no security headers. Marketing's headers come from Caddy
 * (`docs/caddy-security-headers.md`), and inventing a local imitation
 * would let CI report a policy nobody deployed as verified. Its absence
 * here is why the shared CSP spec skips this project explicitly rather
 * than passing it quietly — see `e2e-shared/csp.spec.ts`.
 *
 * Usage: node scripts/serve-static.mjs <dir> <port>
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';

const [, , dirArg, portArg] = process.argv;
if (dirArg === undefined) {
  console.error('usage: serve-static.mjs <dir> [port]');
  process.exit(1);
}

const ROOT = resolve(process.cwd(), dirArg);
const PORT = Number.parseInt(portArg ?? '3000', 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The first candidate that is a real file, or null. Caddy's try_files. */
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/').replace(/\/+$/, '');
  const base = clean === '' ? '/index' : clean;
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    const full = resolve(ROOT, `.${candidate.startsWith('/') ? candidate : `/${candidate}`}`);
    // Traversal guard: a resolved path must stay under the root.
    if (full !== ROOT && !full.startsWith(ROOT + sep)) continue;
    try {
      const s = await stat(full);
      if (s.isFile()) return full;
    } catch {
      // Not this candidate; try the next.
    }
  }
  return null;
}

const server = createServer((req, res) => {
  void (async () => {
    const file = await resolveFile(req.url ?? '/');
    if (file === null) {
      // The export ships a real 404 page; serving it with a 404 status
      // is what the edge does, and a spec asserting `status < 400`
      // should see the failure rather than a styled page returning 200.
      const notFound = await resolveFile('/404');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      if (notFound !== null) createReadStream(notFound).pipe(res);
      else res.end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
