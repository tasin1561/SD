/**
 * Resolve the upstream API origin used by the SSR cookie→/me path.
 *
 * SERVER-SIDE fetches only (Server Components, route handlers). The
 * browser ALWAYS talks to portal.skydrop.global and the /api/* route
 * handler proxies to the upstream API (FE-3).
 */
import 'server-only';

export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? 'http://localhost:3000';
}
