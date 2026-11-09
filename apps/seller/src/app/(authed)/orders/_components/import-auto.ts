/**
 * Whether an upload may go straight from "checked" to "imported" with no
 * click. This is a SHORTCUT for the case where the preview already proved
 * there is nothing for a human to decide — it is not a removal of the check
 * (ORD-9: a re-uploaded Order ID UPDATES an existing order, so a mis-read
 * file can overwrite good orders, not only create junk).
 *
 * The preview is the server's own; nothing here re-derives its policy
 * (FE-2). We only decide whether to ASK the person.
 */

export interface AutoImportPreview {
  readonly rowCount: number;
  readonly orderCount?: number;
  readonly missingRequired: readonly string[];
  readonly exceedsRowLimit: boolean;
  readonly rowsWithProblems?: number;
  /**
   * ORDERS ONLY. The server's own verdict on this file's stock
   * (`blocksImport`), never re-derived here — reading the flag is not
   * re-implementing the rule (FE-2), and `/process` enforces it whatever
   * this decides.
   */
  readonly stockCheck?: { readonly blocksImport: boolean } | null;
}

export type AutoImportStop = 'missing' | 'blocked' | 'none' | 'oversell';

export type AutoImportDecision =
  | { readonly auto: true }
  | { readonly auto: false; readonly reason: AutoImportStop | null };

/**
 * Only the ORDERS importer is eligible. The catalogue preview carries no
 * row-level problem count, so the "most of the file would fail" guard cannot
 * be evaluated for it; without that guard the shortcut would rest on column
 * mapping alone. It keeps the review click (reason `null`: not an auto stop).
 *
 * A REJECTION RATIO IS NOT A STOP (2026-10-28). There used to be a fourth
 * reason, `mostly`: more rejected rows than importable orders held the import
 * back on the theory that a nearly-all-rejections file is a mis-read file. It
 * is not, and the case that disproved it is the ordinary one — a sheet with
 * eight genuinely bad rows and five good orders, every rejection carrying its
 * own specific reason. A mis-read file does not look like that; it fails at
 * the header, which `missing` already catches, and it does not go on to
 * assemble five orders that each hold a valid ID, phone, pincode and SKU.
 * The guard's real cost was making the good rows wait on a click to tell the
 * person something the same dialog was already telling them.
 *
 * Zero importable orders remains its own stop: there is nothing to import.
 */
export function decideAutoImport(
  kind: 'orders' | 'catalog',
  preview: AutoImportPreview,
): AutoImportDecision {
  if (kind !== 'orders') return { auto: false, reason: null };
  if (preview.missingRequired.length > 0) return { auto: false, reason: 'missing' };
  if (preview.exceedsRowLimit) return { auto: false, reason: 'blocked' };
  /*
    A file the server would REFUSE is never sent without a click: the only
    way past that refusal switches the client's stock-hold setting for
    every future order, and nothing account-wide and lasting happens
    automatically. The shortcut exists for files with nothing to decide,
    and this is the opposite of that.
  */
  if (preview.stockCheck?.blocksImport === true) return { auto: false, reason: 'oversell' };
  const importable = preview.orderCount ?? preview.rowCount;
  if (importable <= 0) return { auto: false, reason: 'none' };
  return { auto: true };
}
