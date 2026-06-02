import 'server-only';

/** Read API_ORIGIN from env at request time. Defaults to the local
 *  api dev port; prod sets this to https://api.skydrop.online. */
export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? 'http://localhost:4000';
}
