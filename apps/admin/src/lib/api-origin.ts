/**
 * Resolve the upstream API origin used by the SSR cookie→/me path.
 *
 * Important: this is for SERVER-SIDE fetches only (Server Components,
 * route handlers). The browser ALWAYS talks to admin.skydrop.online
 * and the Next.js rewrites proxy /api/* to here.
 *
 * Defaults: localhost:3000 in dev (where apps/api listens), matches
 * next.config.mjs. Override with API_ORIGIN env in prod.
 */
import 'server-only';

export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? 'http://localhost:3000';
}
