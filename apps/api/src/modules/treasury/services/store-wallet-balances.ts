import { Prisma, SellerStoreKind, WithdrawalRequestStatus } from '@skydrop/db';

/**
 * RS-6 — what a seller's reseller stores hold, read the way the WALLET
 * reads itself: each store's LAST entry's running balance (WAL-7), never a
 * re-sum of history.
 *
 * Plain functions over a client or a transaction rather than a service, on
 * purpose: `SellerCashAttributionService` (treasury), the seller withdrawal
 * guard and the liabilities report all need the SAME number, and the store
 * wallet module imports both of the first two. A service here would close a
 * module cycle; a function taking the caller's client closes nothing (the
 * R3 rule: extract the primitive rather than `forwardRef`).
 *
 * Decision 7: our bank book knows only the seller. These balances are the
 * ledger between a seller and their stores, and the TRE-8 invariant reads
 *   held for a seller = max(0, seller wallet + Σ these).
 * A caller that ACTS on the figure must hold the seller's WALLET lock
 * (`<sellerId>|INR`) in the same transaction — every store wallet write
 * takes that same lock, so nothing can move a store's balance underneath.
 */

type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/** The seller's reseller stores, each with its balance. Stores with no entries read ₹0. */
export async function storeWalletBalances(
  db: Db,
  sellerId: string,
): Promise<ReadonlyArray<{ readonly storeId: string; readonly balance: Prisma.Decimal }>> {
  // Every reseller store the seller has ever had, retired ones included: a
  // store's money does not stop being the seller's when the store closes.
  const stores = await db.sellerStore.findMany({
    where: { sellerId, kind: SellerStoreKind.RESELLER },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const out: Array<{ storeId: string; balance: Prisma.Decimal }> = [];
  // One indexed seek per store, sequentially: an interactive transaction
  // runs one statement at a time. A seller has a handful of stores.
  for (const s of stores) {
    out.push({ storeId: s.id, balance: await storeWalletBalance(db, s.id) });
  }
  return out;
}

/** One store's balance — its last entry's running balance. */
export async function storeWalletBalance(db: Db, storeId: string): Promise<Prisma.Decimal> {
  const last = await db.storeWalletEntry.findFirst({
    where: { storeId },
    orderBy: { id: 'desc' },
    select: { runningBalanceAfter: true },
  });
  return last?.runningBalanceAfter ?? ZERO;
}

/** Σ of the seller's store wallets. Zero for a seller with no reseller stores. */
export async function storeWalletsTotal(db: Db, sellerId: string): Promise<Prisma.Decimal> {
  const rows = await storeWalletBalances(db, sellerId);
  return rows.reduce((t, r) => t.add(r.balance), ZERO);
}

/**
 * What each of the seller's stores has ASKED to withdraw and not been paid
 * (PENDING and APPROVED — WAL-3's amended rule), by store.
 */
export async function storeWithdrawalsHeld(
  db: Db,
  sellerId: string,
  excludeRequestId?: string,
): Promise<ReadonlyMap<string, Prisma.Decimal>> {
  const rows = await db.storeWithdrawalRequest.groupBy({
    by: ['storeId'],
    where: {
      sellerId,
      status: { in: [WithdrawalRequestStatus.PENDING, WithdrawalRequestStatus.APPROVED] },
      ...(excludeRequestId === undefined ? {} : { id: { not: excludeRequestId } }),
    },
    _sum: { amountInr: true },
  });
  return new Map(rows.map((r) => [r.storeId, r._sum.amountInr ?? ZERO]));
}

/**
 * How much the seller's stores, taken together, REDUCE what the seller may
 * take out: `min(0, Σ store balances − Σ store requests held)`.
 *
 * A store's negative balance is the seller's exposure (RS-6), so money the
 * seller could otherwise withdraw is what stands behind it. A store in
 * credit is owed ITS money and adds nothing the seller may take — hence the
 * `min(0, …)`. Zero for a seller with no reseller stores, so a seller
 * without any is judged exactly as before.
 */
export async function storeExposure(db: Db, sellerId: string): Promise<Prisma.Decimal> {
  const balances = await storeWalletBalances(db, sellerId);
  if (balances.length === 0) return ZERO;
  const held = await storeWithdrawalsHeld(db, sellerId);
  const free = balances.reduce((t, b) => t.add(b.balance).sub(held.get(b.storeId) ?? ZERO), ZERO);
  return free.lessThan(0) ? free : ZERO;
}

/**
 * Σ store wallets per seller, across every seller — for the reports that
 * sum wallets platform-wide (liabilities, treasury coverage). Only sellers
 * with at least one reseller store appear.
 */
export async function storeWalletTotalsBySeller(
  db: Db,
): Promise<ReadonlyMap<string, Prisma.Decimal>> {
  const stores = await db.sellerStore.findMany({
    where: { kind: SellerStoreKind.RESELLER },
    select: { id: true, sellerId: true },
    orderBy: { id: 'asc' },
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const s of stores) {
    const balance = await storeWalletBalance(db, s.id);
    out.set(s.sellerId, (out.get(s.sellerId) ?? ZERO).add(balance));
  }
  return out;
}
