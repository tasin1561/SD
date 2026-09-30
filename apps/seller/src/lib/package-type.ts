/**
 * What a parcel is packed in, in the DATABASE's own vocabulary.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
 * The seller app had invented three values of its own — STANDARD,
 * FRAGILE and DOCUMENT — over an enum that has only ever held BOX,
 * POLYBAG, ENVELOPE, TUBE and CUSTOM. A comment beside the display
 * mapping even said "the enum names the same three things", which was
 * simply false.
 *
 * It was not cosmetic. The edit form sent `packageType` on EVERY save,
 * so `@IsEnum(PackageType)` refused every one:
 *
 *   [BAD_REQUEST] packageType must be one of the following values:
 *   BOX, POLYBAG, ENVELOPE, TUBE, CUSTOM
 *
 * — which means **no order edit could be saved at all**, draft or
 * pending, whatever the seller changed. The order-create form escaped
 * only because it sends no package type. Found by filming the edit
 * screen (2026-09-30).
 *
 * The list lives HERE, once, so the form's options and the detail page's
 * words cannot drift apart again, and so the next reader has one place
 * to compare against `PackageType` in `packages/db/prisma/schema.prisma`.
 */

/** Exactly the database enum, in the order a person would offer them. */
export const PACKAGE_TYPES = ['BOX', 'POLYBAG', 'ENVELOPE', 'TUBE', 'CUSTOM'] as const;

export type PackageTypeValue = (typeof PACKAGE_TYPES)[number];

/** Is this one of ours? Used to read an order's stored value safely. */
export function isPackageType(value: unknown): value is PackageTypeValue {
  return typeof value === 'string' && (PACKAGE_TYPES as readonly string[]).includes(value);
}

/**
 * What a person calls each one.
 *
 * An unknown value is returned AS IT CAME rather than hidden: if the
 * enum grows and this list does not, the screen says the new name out
 * loud instead of quietly printing nothing.
 */
export function packageWords(value: string): string {
  switch (value) {
    case 'BOX':
      return 'Box';
    case 'POLYBAG':
      return 'Polybag';
    case 'ENVELOPE':
      return 'Envelope';
    case 'TUBE':
      return 'Tube';
    case 'CUSTOM':
      return 'Something else';
    default:
      return value;
  }
}
