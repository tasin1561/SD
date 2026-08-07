/**
 * The seller code shown in front of a recipient name.
 *
 * The API stores the name as `<code> <name>` and composes it there, not
 * here — every entry path (this form, CSV import, the API) has to get
 * the same result, and only the server sees all three. What this module
 * does is DISPLAY: show the code as fixed chrome, and take it back off
 * when an existing order is loaded for editing so the input holds the
 * name and not the name plus a code the seller cannot change.
 *
 * This deliberately mirrors `apps/api/src/common/text/recipient-name.ts`
 * rather than sharing it, and the duplication is SAFE because the
 * server's compose is idempotent: if this strip ever disagrees, the
 * worst outcome is a prefix visible in the input for a moment. It
 * cannot produce "MSt MSt John Doe" in the database, which is the
 * failure that would actually matter.
 */

/** Only strips a leading, space-separated, exact match of this seller's
 *  own code — never a name that merely starts with the same letters. */
export function stripSellerPrefix(initials: string | null, name: string): string {
  const prefix = initials?.trim() ?? '';
  const clean = name.trim();
  if (prefix === '') return clean;
  if (!clean.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return clean;
  return clean.slice(prefix.length + 1).trim();
}

/** The hint under the field, so the prefix is explained rather than
 *  just appearing. Empty when the seller has no code. */
export function prefixHint(initials: string | null): string {
  const prefix = initials?.trim() ?? '';
  if (prefix === '') return '';
  return `Saved as “${prefix} <name>” — your code, so we can tell your parcels apart`;
}
