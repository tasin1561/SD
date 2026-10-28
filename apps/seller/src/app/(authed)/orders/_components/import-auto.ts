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
}

export type AutoImportStop = 'missing' | 'blocked' | 'none' | 'mostly';

export type AutoImportDecision =
  | { readonly auto: true }
  | { readonly auto: false; readonly reason: AutoImportStop | null };

/**
 * Only the ORDERS importer is eligible. The catalogue preview carries no
 * row-level problem count, so the "most of the file would fail" guard cannot
 * be evaluated for it; without that guard the shortcut would rest on column
 * mapping alone. It keeps the review click (reason `null`: not an auto stop).
 *
 * "Mostly rejected" means MORE rejected rows than importable orders. A file
 * that is nearly all rejections is the signature of a mis-read file — the
 * case the review step exists for. Zero importable orders is its own stop.
 */
export function decideAutoImport(
  kind: 'orders' | 'catalog',
  preview: AutoImportPreview,
): AutoImportDecision {
  if (kind !== 'orders') return { auto: false, reason: null };
  if (preview.missingRequired.length > 0) return { auto: false, reason: 'missing' };
  if (preview.exceedsRowLimit) return { auto: false, reason: 'blocked' };
  const importable = preview.orderCount ?? preview.rowCount;
  const rejected = preview.rowsWithProblems ?? 0;
  if (importable <= 0) return { auto: false, reason: 'none' };
  if (rejected > importable) return { auto: false, reason: 'mostly' };
  return { auto: true };
}
