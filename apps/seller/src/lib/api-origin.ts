/**
 * Resolve the upstream API origin used by the SSR cookie→/me path.
 *
 * Important: this is for SERVER-SIDE fetches only (Server Components,
 * route handlers). The browser ALWAYS talks to app.skydrop.online
 * and the /api/* route handler proxies to the upstream API.
 *
 * Defaults: localhost:3000 in dev (where apps/api listens). Override
 * with API_ORIGIN env in prod.
 */
import 'server-only';

export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? 'http://localhost:3000';
}
