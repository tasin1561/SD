/**
 * RS-5 — how many units an order line may be given AT CONFIRMATION,
 * given the seller's reseller set-asides. Pure: no Prisma, no clock.
 *
 * This is RS-3's consumption half. The catalogue decides what a store is
 * SHOWN (`reseller-visible-stock.ts`); this decides what an order may
 * actually TAKE when the call centre confirms it and M5 reserves. INV-3
 * stays the authority — `realAvailable` is the INV-3 figure, and M5's own
 * reserve still checks the warehouse after this has said yes — so this
 * can only ever refuse MORE, never allow an oversell.
 *
 *   CHANNEL (the seller's own order):
 *       realAvailable − Σ every live reseller store's UNUSED set-aside
 *   SHARED  (a store line whose store shares the pool):
 *       realAvailable − Σ OTHER live stores' unused set-asides
 *   SET_ASIDE (a store line whose store has units set aside):
 *       min(own unused set-aside, realAvailable)
 *
 * `unused = max(0, set_aside_qty − consumed)`, `consumed` being Σ the
 * store's own orders' ACTIVE reservations of the variant. A store's
 * consumed units are already out of `realAvailable` (they are
 * reservations); subtracting only the UNUSED part of its set-aside is
 * what protects the whole set-aside exactly once.
 *
 * The CHANNEL rule is the behaviour change for sellers who run reseller
 * stores: before RS-5 their own orders could eat a store's set-aside,
 * which made the set-aside a promise nobody kept.
 */

export type ConfirmLineKind = 'CHANNEL' | 'SHARED' | 'SET_ASIDE';

export interface ConfirmAllowanceInput {
  readonly kind: ConfirmLineKind;
  /** INV-3 availability across the warehouses that fulfil orders. */
  readonly realAvailable: number;
  /** SET_ASIDE only: this store's unused set-aside. Ignored otherwise. */
  readonly ownUnusedSetAside: number;
  /**
   * Σ unused set-aside of the live stores this line must NOT eat: every
   * store for a CHANNEL line, every OTHER store for a store line.
   */
  readonly othersUnusedSetAside: number;
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** The most units this line may be reserved. Never negative. */
export function confirmAllowance(input: ConfirmAllowanceInput): number {
  const real = whole(input.realAvailable);
  switch (input.kind) {
    case 'SET_ASIDE':
      return Math.min(whole(input.ownUnusedSetAside), real);
    case 'SHARED':
    case 'CHANNEL':
      return Math.max(0, real - whole(input.othersUnusedSetAside));
  }
}

/** One live store's set-aside of a variant and how much of it is used. */
export interface SetAsideCommitment {
  readonly storeId: string;
  readonly setAsideQty: number;
  readonly consumed: number;
}

export function unusedOf(c: SetAsideCommitment): number {
  return Math.max(0, whole(c.setAsideQty) - whole(c.consumed));
}

/**
 * The confirm-time decision for one line, from the commitments of the
 * seller's live stores. `orderStoreId` is null for a CHANNEL order.
 * A store line counts as SET_ASIDE when ITS store has a live set-aside
 * for the variant NOW — the commitment in force at confirmation decides
 * what is reserved (the order's snapshot records the mode it was placed
 * under, for reports).
 */
export function allowanceForLine(input: {
  readonly orderStoreId: string | null;
  readonly realAvailable: number;
  readonly commitments: readonly SetAsideCommitment[];
}): { readonly kind: ConfirmLineKind; readonly allowance: number } {
  const own =
    input.orderStoreId === null
      ? undefined
      : input.commitments.find((c) => c.storeId === input.orderStoreId);
  const others = input.commitments.filter((c) => c.storeId !== input.orderStoreId);
  const othersUnused = others.reduce((sum, c) => sum + unusedOf(c), 0);
  const kind: ConfirmLineKind =
    input.orderStoreId === null ? 'CHANNEL' : own === undefined ? 'SHARED' : 'SET_ASIDE';
  return {
    kind,
    allowance: confirmAllowance({
      kind,
      realAvailable: input.realAvailable,
      ownUnusedSetAside: own === undefined ? 0 : unusedOf(own),
      othersUnusedSetAside: othersUnused,
    }),
  };
}
