import type { Request } from 'express';

/**
 * The FULL request path, with no query string.
 *
 * ── WHY NOT `req.path` ──────────────────────────────────────────────
 * Nest mounts route-scoped middleware (`forRoutes('*')`) with express's
 * `app.use(path, fn)`, and express rewrites `req.url` relative to the
 * mount point. Measured on this workspace's express: for
 * `GET /auth/seller/me?x=1` inside such middleware,
 * `req.path === '/'`, `req.baseUrl === '/auth/seller/me'`,
 * `req.url === '/?x=1'`, `req.originalUrl === '/auth/seller/me?x=1'`.
 * Anything that tests `req.path` there tests `'/'` and never matches.
 *
 * `originalUrl` is the one value that is the same in middleware and in a
 * handler. The query string is cut off because it can carry identifiers
 * and must never reach a regex, a log line or `audit_logs`.
 */
export function fullRequestPath(req: Pick<Request, 'originalUrl' | 'path'>): string {
  const raw =
    typeof req.originalUrl === 'string' && req.originalUrl !== '' ? req.originalUrl : req.path;
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}
