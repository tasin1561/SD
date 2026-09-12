import type { Prisma } from '@skydrop/db';

/**
 * Postgres advisory locks — the registry and the hash.
 *
 * Several places in this codebase need to serialize a sequence that a
 * unique index cannot express: find-or-create a manifest, allocate the
 * next number in a series, count-then-insert an attempt number, add up
 * a wallet. Each does it with `pg_advisory_xact_lock(namespace, key)`,
 * which is held to commit-or-rollback and therefore cannot be leaked by
 * a crash.
 *
 * The namespaces were previously three magic hex numbers in three
 * comments, and the hash function had been copy-pasted twice. That is
 * how two subsystems eventually pick the same namespace and start
 * waiting on each other for no reason — the collision is invisible,
 * costs only latency, and so is never noticed. Declaring them together
 * makes the next one an obvious edit.
 */
export const AdvisoryLock = {
  /** 'MF' — manifest number allocation (WMS-7). */
  MANIFEST_NUMBER: 0x04d46,
  /** 0x05042 = 'PB' — pick-batch numbering. */
  PICK_BATCH_NUMBER: 0x05042,
  /** Manifest find-or-create per (courier, warehouse) (WMS-7). */
  MANIFEST_ATTACH: 0x04d47,
  /** delivery_attempts count-then-insert per shipment (TRK-2). */
  DELIVERY_ATTEMPT: 0x04d48,
  /** Wallet writes per (seller, currency) (WAL-1). */
  WALLET: 0x04d49,
  /** Shipment number allocation. */
  SHIPMENT_NUMBER: 0x05348,
  /** Order number allocation per year (ORD-8). */
  ORDER_NUMBER: 0x04f52,
  /** 'CN' — consignment number allocation per year. */
  CONSIGNMENT_NUMBER: 0x0434e,
  /**
   * Reconciling one bank account's owner balance (TRE-1).
   *
   * Reconcile READS the balance and then posts the difference. Two
   * operators doing that at once both read the same figure and both
   * post the same correction, and the ledger is append-only so the
   * doubling is permanent.
   */
  BANK_RECONCILE: 0x04252,
  /**
   * 'SS' — recording a courier payout line against one order.
   *
   * A line's shortfall is the CHANGE in how far short the order's
   * payments stand, read from the lines before it. Two payouts for the
   * same order recorded at once would each read "no earlier line" and
   * each recognise the whole gap.
   */
  SETTLEMENT_ORDER: 0x05353,
  /**
   * 'ST' — adding lines to ONE recorded courier payout.
   *
   * `allocateMore` reads how much of the payout is still unallocated and
   * writes more. Read outside a lock, two operators each see the same
   * remainder and together allocate past the cash that landed.
   */
  SETTLEMENT: 0x05354,
  /**
   * 'FC' — recomputing ONE freight bill's cost from its forwarder payments.
   *
   * A payment (or an attribution) posts its entry and then re-sums every
   * payment on the bill. Under READ COMMITTED two of them at once each
   * see only their own uncommitted entry, and the second write of the
   * total drops the first payment — which, being linked, is excluded from
   * operating expenses too, so it falls off the P&L entirely.
   */
  FREIGHT_COST: 0x04643,
} as const;

/**
 * The ONE `BANK_RECONCILE` key every seller-cash reclassification takes.
 *
 * `reconcile()` reads an owner's balance and posts the difference; a
 * charge's reclassification pair landing in between would be folded into
 * the correction. A key per ACCOUNT would let two attributions that touch
 * two accounts in opposite orders deadlock each other, so it is one key:
 * reconcile takes it after its per-owner key, and every attribution pair
 * takes it after the seller's WALLET lock. Nothing takes a WALLET lock
 * after it, so it cannot be part of a cycle.
 */
export const ATTRIBUTION_RECONCILE_KEY = '*|attribution';

/**
 * The `BANK_RECONCILE` key for ONE account — every owner in it.
 *
 * `reconcile()` reads an owner's balance in an account and posts the
 * difference. A row landing in that account between the read and the
 * post (a transfer arriving, a payout leaving, a settlement landing) was
 * folded into the correction as though it were an error. So every writer
 * that posts a non-pair row into an account takes that account's key,
 * and `reconcile()` takes it before reading.
 *
 * ── THE LOCK ORDER, and why it cannot cycle ──────────────────────────
 *
 *   WALLET (per seller, sorted)  <  ACCOUNT keys (sorted by id)  <  ATTRIBUTION
 *
 * Every transaction acquires in that order and never goes back down:
 *   - a wallet charge:            WALLET → ATTRIBUTION (its pair)
 *   - reconcile:                  ACCOUNT → ATTRIBUTION        (no WALLET)
 *   - reclassify:                 WALLET → ACCOUNT
 *   - transfer:                   WALLET → ACCOUNT(from, to)
 *   - remittance:                 WALLET → ACCOUNT(paying) → ATTRIBUTION
 *   - settlement / allocateMore:  WALLET(all) → ACCOUNT(receiving) → ATTRIBUTION
 *   - top-up acceptance:          WALLET → ACCOUNT → ATTRIBUTION
 *   - owner money:                ACCOUNT
 * A cycle needs some transaction to hold a higher-ranked lock while
 * waiting on a lower one; none does, because each writer takes its
 * account keys UP FRONT (before any wallet entry whose attribution pair
 * takes ATTRIBUTION) and pairs never take an account key — they are
 * fenced from reconcile by ATTRIBUTION alone.
 *
 * One key per ACCOUNT, not per owner: a transfer's arriving row and a
 * seller's holding in the same account are sums reconcile reads, and a
 * per-owner key left the arriving row unfenced.
 */
export function accountReconcileKey(accountId: string): string {
  return `${accountId}|account`;
}

/**
 * Take the reconcile key of every account a transaction will post into,
 * de-duplicated and SORTED — two writers touching the same two accounts
 * in opposite orders would otherwise each hold one and wait on the other.
 * Call after the transaction's WALLET locks and before anything that
 * takes `ATTRIBUTION_RECONCILE_KEY`.
 */
export async function lockAccountsForPosting(
  tx: Prisma.TransactionClient,
  accountIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(accountIds)].sort()) {
    await takeAdvisoryLock(tx, AdvisoryLock.BANK_RECONCILE, accountReconcileKey(id));
  }
}

/**
 * 32-bit FNV-1a, returned signed so it fits `pg_advisory_xact_lock`'s
 * `int` parameter.
 *
 * A collision between two different keys costs one of them a brief
 * wait. It can never produce a wrong answer: the lock is a mutex, not
 * an identity, and the code inside it re-reads the state it guards.
 */
export function advisoryKey(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Take a transaction-scoped advisory lock on `namespace:key`. */
export async function takeAdvisoryLock(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::int, ${advisoryKey(key)}::int)`;
}
