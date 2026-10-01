'use client';

import { type ReactElement } from 'react';
import { Select } from '@skydrop/ui/app/select';
import { useBinContents, type BinStockLine } from '@/lib/bin-contents-hooks';

/**
 * WHICH line in this bin is moving — asked by NAME, never typed.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 * Three monospace text boxes headed "Seller id", "Variant id" and
 * "Batch id", into which an operator was expected to type three uuids.
 * No screen in the admin app offered them to copy, so the advanced half
 * of the re-shelving form was, in practice, unusable from the console —
 * the same "a row named by its uuid" defect the rest of the estate has
 * been fixed of, in its INPUT form rather than its output form.
 *
 * ── WHY ONE PICKER AND NOT THREE ─────────────────────────────────────
 * The decomposition is what made this look expensive. A seller, a
 * variant and a batch are not three independent questions: they are one
 * stock LINE, they are only movable if they are already sitting in the
 * bin the move is coming FROM, and the server already serves exactly
 * that list — `GET /admin/bin-contents/:binId`, which the bin detail
 * page has rendered since it was built. So the question is "which of
 * the things in this bin?", asked once, and the three ids come back
 * together and consistent with one another, which three boxes could
 * never guarantee.
 *
 * ── WHY IT IS DISABLED UNTIL "FROM" IS CHOSEN ────────────────────────
 * There is no list to offer before a bin is named, and an enabled
 * dropdown holding nothing reads as "this bin is empty".
 *
 * The server is still the boundary (FE-2): it re-checks that the line
 * is in the source bin and that there is enough of it. This only stops
 * an operator from having to invent an identifier.
 */

/** A bin holds at most this many distinct lines on one page (the API caps at 200). */
const PAGE_SIZE = 200;

export function binLineLabel(line: BinStockLine): string {
  const name = line.productName ?? 'Unnamed product';
  const sku = line.skuCode === null ? '' : `${line.skuCode} — `;
  const variant = line.variantLabel === null ? '' : ` (${line.variantLabel})`;
  return `${sku}${name}${variant} · batch ${line.batchCode} · ${line.qtyOnHand} on hand`;
}

export interface PickedBinLine {
  readonly stockLevelId: string;
  readonly sellerId: string;
  readonly variantId: string;
  readonly batchId: string;
}

export function BinLinePicker({
  binId,
  value,
  onChange,
}: {
  /** The line's FROM bin. Empty until the operator chooses one. */
  readonly binId: string;
  /** `stock_levels` id of the chosen line, or '' for none. */
  readonly value: string;
  readonly onChange: (picked: PickedBinLine | null) => void;
}): ReactElement {
  // The query lives in the inner component so that it is MOUNTED, not
  // merely disabled, only once there is a bin to ask about: every draft
  // line starts without one, and a hook called with '' would put a
  // request for `/bin-contents/` on the wire per empty row.
  if (binId === '') {
    return (
      <Select value="" aria-label="Product" disabled>
        <option value="">— choose a From bin first —</option>
      </Select>
    );
  }
  return <LoadedBinLinePicker binId={binId} value={value} onChange={onChange} />;
}

function LoadedBinLinePicker({
  binId,
  value,
  onChange,
}: {
  readonly binId: string;
  readonly value: string;
  readonly onChange: (picked: PickedBinLine | null) => void;
}): ReactElement {
  const contents = useBinContents(binId, 1, PAGE_SIZE);
  const items = contents.data?.items ?? [];
  const truncated = (contents.data?.total ?? 0) > items.length;

  function placeholder(): string {
    if (contents.isLoading) return '— loading —';
    if (items.length === 0) return '— this bin is empty —';
    return '— choose a product —';
  }

  return (
    <>
      <Select
        value={value}
        aria-label="Product"
        disabled={items.length === 0}
        onChange={(e) => {
          const picked = items.find((l) => l.stockLevelId === e.target.value);
          onChange(
            picked === undefined
              ? null
              : {
                  stockLevelId: picked.stockLevelId,
                  sellerId: picked.sellerId,
                  variantId: picked.variantId,
                  batchId: picked.batchId,
                },
          );
        }}
      >
        <option value="">{placeholder()}</option>
        {items.map((l) => (
          <option key={l.stockLevelId} value={l.stockLevelId}>
            {binLineLabel(l)}
          </option>
        ))}
      </Select>
      {truncated && (
        // Saying so beats a dropdown that silently ends: a FLOOR bin can
        // hold every SKU we stock, and "it is not in the list" and "the
        // list stopped" are different problems with different answers.
        <p className="stk-hint">
          Showing the first {items.length} of {contents.data?.total ?? 0}. Move in smaller batches,
          or move the whole bin.
        </p>
      )}
    </>
  );
}
