/**
 * RS-3 — what a reseller store is SHOWN of a seller's stock, and how a
 * set-aside is kept inside what exists. Pure: no Prisma, no clock. The
 * ONE place this arithmetic lives — the seller's screen (what the store
 * will see), the store's catalogue and the shrink sweep all call here,
 * because three copies of "visible quantity" is how the seller's preview
 * comes to disagree with what the store is actually shown.
 *
 * ── INV-3 STAYS THE AUTHORITY ────────────────────────────────────────
 * `realAvailable` is the INV-3 figure (pickable on-hand − ACTIVE
 * reservations, across the warehouses that fulfil orders), read live
 * from `StockReadService`. Nothing here is stored and nothing here
 * decides a reservation: a visible quantity is a view, and hiding a
 * share can only ever show LESS than exists, so it can never cause an
 * oversell. Confirmation (phase 3) still checks real availability.
 *
 * ── THE FORMULAS ────────────────────────────────────────────────────
 *   SHARED:    floor(max(0, realAvailable − Σ other stores' unused set-asides) × (100 − hidden%) / 100)
 *   SET_ASIDE: floor(min(unusedSetAside, max(0, realAvailable)) × (100 − hidden%) / 100)
 * Integer arithmetic throughout (`× (100 − h) / 100` on whole units), so
 * the floor is exact — no binary-fraction rounding at a boundary.
 */

export type StockMode = 'SHARED' | 'SET_ASIDE';

export const MAX_HIDDEN_PERCENT = 90;

/**
 * THE PHASE-3 SEAM. "Unused" set-aside is the committed quantity less
 * what the store has already consumed of it — its own ACTIVE reservations
 * once store orders exist. Phase 2 has no store orders, so every caller
 * passes this: zero consumed. Phase 3 replaces the 0 at the one place the
 * catalogue service resolves `consumedByStore`, not here.
 */
export const CONSUMED_BY_STORE_BEFORE_ORDERS = 0;

function whole(n: number): number {
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** A hidden percentage clamped into 0–90 (the DB CHECK is the real bound). */
export function clampHiddenPercent(hiddenPercent: number): number {
  const h = whole(hiddenPercent);
  if (h < 0) return 0;
  if (h > MAX_HIDDEN_PERCENT) return MAX_HIDDEN_PERCENT;
  return h;
}

/** What remains of a set-aside after the store's own use of it, never below 0. */
export function unusedSetAside(setAsideQty: number, consumedByStore: number): number {
  return Math.max(0, whole(setAsideQty) - Math.max(0, whole(consumedByStore)));
}

/** Withhold `hiddenPercent` of a quantity: floor(max(0, qty) × (100 − h) / 100). */
export function applyHidden(quantity: number, hiddenPercent: number): number {
  const q = Math.max(0, whole(quantity));
  const h = clampHiddenPercent(hiddenPercent);
  return Math.floor((q * (100 - h)) / 100);
}

export interface VisibleQuantityInput {
  readonly mode: StockMode;
  /** Required when SET_ASIDE; ignored when SHARED. */
  readonly setAsideQty: number | null;
  readonly hiddenPercent: number;
  /** INV-3 availability across fulfilling warehouses (may be 0). */
  readonly realAvailable: number;
  /** Σ over the seller's OTHER live stores of their unused set-aside. */
  readonly othersUnusedSetAside: number;
  /** This store's own use of its set-aside (phase 2: 0 — see the seam). */
  readonly consumedByStore: number;
}

/** The quantity the store is shown. Never negative, never more than real availability. */
export function visibleQuantity(input: VisibleQuantityInput): number {
  const real = Math.max(0, whole(input.realAvailable));
  if (input.mode === 'SET_ASIDE') {
    const unused = unusedSetAside(input.setAsideQty ?? 0, input.consumedByStore);
    return applyHidden(Math.min(unused, real), input.hiddenPercent);
  }
  const others = Math.max(0, whole(input.othersUnusedSetAside));
  return applyHidden(Math.max(0, real - others), input.hiddenPercent);
}

/** Σ unused set-aside across a list of other stores' commitments. */
export function othersUnusedSetAside(
  rows: ReadonlyArray<{ readonly setAsideQty: number; readonly consumedByStore: number }>,
): number {
  return rows.reduce((sum, r) => sum + unusedSetAside(r.setAsideQty, r.consumedByStore), 0);
}

/**
 * How many units could still be set aside for a store: on-hand less what
 * the seller's other stores already hold. The SET_ASIDE_EXCEEDS_STOCK
 * guard refuses a new total above this.
 */
export function freeToSetAside(onHand: number, othersSetAside: number): number {
  return Math.max(0, whole(onHand) - Math.max(0, whole(othersSetAside)));
}

export interface SetAsideRow {
  readonly id: string;
  readonly setAsideQty: number;
  /** When the commitment last grew; the newest claim is cut first. */
  readonly setAsideAt: Date | null;
}

export interface ShrinkStep {
  readonly id: string;
  readonly fromQty: number;
  readonly toQty: number;
}

/**
 * The cuts that bring Σ set-asides back inside on-hand, NEWEST FIRST.
 *
 * The newest commitment is the one made last against stock that was
 * already promised elsewhere, so it gives way first; an older store's
 * set-aside is touched only once every newer one is at zero. Ties break
 * on id descending (uuidv7 — later row, later claim), then a row with no
 * timestamp counts as the oldest. A set-aside is cut to 0, never removed:
 * the store stays on SET_ASIDE and the seller decides what happens next.
 * Returns [] when nothing needs to move.
 */
export function planShrink(onHand: number, rows: readonly SetAsideRow[]): ShrinkStep[] {
  const total = rows.reduce((s, r) => s + Math.max(0, whole(r.setAsideQty)), 0);
  let excess = total - Math.max(0, whole(onHand));
  if (excess <= 0) return [];
  const ordered = [...rows].sort((a, b) => {
    const ta = a.setAsideAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = b.setAsideAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const steps: ShrinkStep[] = [];
  for (const row of ordered) {
    if (excess <= 0) break;
    const from = Math.max(0, whole(row.setAsideQty));
    if (from === 0) continue;
    const cut = Math.min(from, excess);
    steps.push({ id: row.id, fromQty: from, toQty: from - cut });
    excess -= cut;
  }
  return steps;
}
