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
   * 'SP' — provisioning an order's shipment. `provisionFromSnapshot`
   * checks "does this order already have a live shipment?" and then
   * creates one; two writers of CONFIRMED at once (a transition racing a
   * god-mode force, or the AWB-less sweep's re-provision) both read "no"
   * and both create — two parcels, and two real waybills booked.
   */
  SHIPMENT_PROVISION: 0x05350,
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
