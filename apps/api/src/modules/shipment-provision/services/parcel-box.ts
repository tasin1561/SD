/**
 * The box we tell a courier about.
 *
 * `shipments` has carried length/width/height since it was created, the
 * Delhivery AWB payload sends them when present, and Shiprocket's
 * demands them. Nothing ever wrote them: `shipment.create` set the
 * weight and skipped the three dimension columns, so AWB generation fell
 * through to its `?? 10` and **every parcel we have manifested was
 * declared 10×10×10 cm** (found 2026-10-27). The catalogue has held the
 * real figures the whole time.
 *
 * ── WHY A BOUNDING BOX, AND WHY THIS ONE ─────────────────────────────
 * Dimensions do not add up. Two 20×15×5 shirts are not one 40×30×10
 * parcel, and there is no arrangement of arbitrary items a formula can
 * know. What a packer actually does is stack things in one carton, so
 * the honest approximation is a stack: the footprint is the widest item,
 * and the height is everything piled on top.
 *
 *     length = max(length)        width = max(width)
 *     height = Σ(height × quantity)
 *
 * One line at quantity one — the common case by far — is exact, because
 * the stack of one IS the item.
 *
 * ── WHY IT LEANS HIGH ────────────────────────────────────────────────
 * The stack over-states a multi-item parcel whenever items sit side by
 * side instead. That direction is deliberate. Couriers bill the GREATER
 * of actual and volumetric weight and re-measure at their hub: declaring
 * small and shipping large earns a weight-discrepancy charge and a
 * dispute to argue months later, while declaring large costs a little
 * freight now and is never contested. One of those two errors is visible
 * on an invoice; the other arrives as a surprise deduction.
 *
 * ── WHAT IT WILL NOT DO ──────────────────────────────────────────────
 * It never invents a figure. A line whose variant carries no dimensions
 * (the catalogue resolves the product default behind it first) makes the
 * whole parcel unknown, and an unknown parcel is left NULL for AWB
 * generation's existing floor to handle — exactly today's behaviour.
 * Guessing one item's box from its siblings would be worse than the
 * `?? 10` it replaced, because it would look authoritative.
 */

/** Just enough of a provisioned line to size the parcel. */
export interface ParcelBoxItem {
  quantity: number;
  unitLengthCm?: number | null;
  unitWidthCm?: number | null;
  unitHeightCm?: number | null;
}

export interface ParcelBox {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

/**
 * Courier payloads take centimetres with two decimals; the column is
 * `DECIMAL(6,2)`. Round UP, never down — a box rounded down is the
 * under-declaration this whole module exists to avoid.
 */
function ceil2(n: number): number {
  return Math.ceil(n * 100) / 100;
}

/** A dimension is usable only if it is a real, positive, finite number. */
function usable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * The parcel for a set of lines, or `null` when any line cannot say how
 * big it is.
 */
export function parcelBox(items: readonly ParcelBoxItem[]): ParcelBox | null {
  if (items.length === 0) return null;

  let length = 0;
  let width = 0;
  let height = 0;

  for (const item of items) {
    // A quantity that is not a whole number above zero is not a stack we
    // can size. It should not reach here; if it does, say "unknown"
    // rather than multiply by it.
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) return null;
    if (!usable(item.unitLengthCm) || !usable(item.unitWidthCm) || !usable(item.unitHeightCm)) {
      return null;
    }
    length = Math.max(length, item.unitLengthCm);
    width = Math.max(width, item.unitWidthCm);
    height += item.unitHeightCm * item.quantity;
  }

  return { lengthCm: ceil2(length), widthCm: ceil2(width), heightCm: ceil2(height) };
}
