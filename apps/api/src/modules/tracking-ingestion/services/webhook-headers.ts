import type { IncomingHttpHeaders } from 'node:http';
import type { Prisma } from '@skydrop/db';

/** The header the courier authenticates with. */
export const SIGNATURE_HEADER = 'x-skydrop-signature';

/**
 * The stored copy of a webhook's headers, with the credential removed.
 *
 * Under `SHARED_SECRET` — which is what Delhivery uses, because they
 * configure a static key/value pair per client rather than signing the
 * body — the header VALUE is the secret itself. Persisting the headers
 * verbatim therefore wrote the credential into a database column on
 * every push, which is the precise thing CUR-1 exists to stop: the key
 * lives in env and never in a row.
 *
 * It is a quiet failure. The column is called `headers`, the value looks
 * like a signature, and nothing about the row says a secret is in it.
 *
 * Shared by the scan and document controllers deliberately: two copies
 * of this is how one of them gets fixed and the other does not.
 */
export function redactAuthHeaders(headers: IncomingHttpHeaders): Prisma.InputJsonValue {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k,
      k.toLowerCase() === SIGNATURE_HEADER
        ? '[redacted]'
        : Array.isArray(v)
          ? v.join(',')
          : (v ?? ''),
    ]),
  );
}
