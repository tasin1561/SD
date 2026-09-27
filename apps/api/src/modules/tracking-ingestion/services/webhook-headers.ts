import type { IncomingHttpHeaders } from 'node:http';
import type { Prisma } from '@skydrop/db';

/** The header Delhivery's requirement document names as ours to choose. */
export const SIGNATURE_HEADER = 'x-skydrop-signature';

/**
 * EVERY header whose value may be a credential.
 *
 * A SET rather than one name, because that is exactly how this broke:
 * `x-skydrop-signature` was redacted and `x-api-key` — which Shiprocket
 * sends, whose scheme is SHARED_SECRET, and which the controller reads as
 * a fallback — was not, so the Shiprocket secret was written verbatim into
 * `courier_webhooks.headers` on every push, and into every backup after.
 *
 * `authorization` and `cookie` are here for the same reason before a
 * courier ever sends one: a third courier's auth scheme is a line in this
 * set, never a second place that decides what counts as a secret.
 *
 * Add the header name HERE when a courier's credential arrives in a new
 * one. `webhook-headers-redaction.spec.ts` pins the set against what the
 * controllers actually read, because the bug's shape is "a second
 * credential header was added and this file was not revisited".
 */
export const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  SIGNATURE_HEADER,
  'x-api-key',
  'authorization',
  'cookie',
]);

/**
 * The stored copy of a webhook's headers, with every credential removed.
 *
 * Under `SHARED_SECRET` — which is what Delhivery and Shiprocket both use,
 * because they configure a static key/value pair per client rather than
 * signing the body — the header VALUE is the secret itself. Persisting the
 * headers verbatim therefore wrote the credential into a database column on
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
      CREDENTIAL_HEADERS.has(k.toLowerCase())
        ? '[redacted]'
        : Array.isArray(v)
          ? v.join(',')
          : (v ?? ''),
    ]),
  );
}
