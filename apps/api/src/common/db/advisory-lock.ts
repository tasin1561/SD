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
  /**
   * 'SP' — provisioning an order's shipment. `provisionFromSnapshot`
   * checks "does this order already have a live shipment?" and then
   * creates one; two writers of CONFIRMED at once (a transition racing a
   * god-mode force, or the AWB-less sweep's re-provision) both read "no"
   * and both create — two parcels, and two real waybills booked.
   */
  SHIPMENT_PROVISION: 0x05350,
  /**
   * 'TK' — ticket number allocation per year. Covers the lazy
   * `CREATE SEQUENCE IF NOT EXISTS`, which is not atomic against a
   * concurrent CREATE; the `nextval` after it needs no lock.
   */
  TICKET_NUMBER: 0x0544b,
  /**
   * 'PL' — closing a P&L month and writing carry-forwards (PNL-CF-1).
   *
   * Detection reads a closed month's snapshot plus every carry-forward
   * already written for it and inserts the difference; two runs at once
   * would each read the same baseline and each carry the same change.
   * Closing takes it too, so "the month a carry-forward lands in is still
   * open" is checked and acted on under one lock.
   */
  PNL_PERIOD: 0x0504c,
  /**
   * 'RA' — committing a seller's on-hand to reseller stores (RS-3), per
   * (seller, variant). A set-aside save reads Σ set-asides of the other
   * stores and the variant's on-hand, then writes; two saves for two
   * stores at once would each see the other's commitment missing and
   * together promise more units than exist. The shrink sweep takes the
   * same key, so it never cuts a set-aside a seller is mid-way through
   * raising.
   */
  RESELLER_SET_ASIDE: 0x05241,
  /**
   * 'RT' — a reseller store's TERMS (RS-4), per store.
   *
   * Publishing reads the store's latest version and inserts the next
   * number; two sellers' tabs publishing at once would both read "v3" and
   * both try v4 (the unique on (store, version) refuses the second, but
   * with a 500-shaped surprise rather than an answer). Accepting takes it
   * too, so "the version being accepted is still the current one" is
   * checked and written under the same lock a publish holds.
   */
  RESELLER_TERMS: 0x05254,
  /**
   * 'CI' — resolving a customer's identity (ORD-7, RS-5), per
   * (owner, phone). Identity used to be an upsert on the
   * (seller_id, phone_e164) unique; RS-5 replaced that with two PARTIAL
   * uniques (one per owner kind) Prisma cannot target, so find-then-create
   * runs under this lock — two orders for the same new phone at once
   * would otherwise both read "no such customer" and the second insert
   * would abort its whole order transaction on the unique.
   */
  CUSTOMER_IDENTITY: 0x04349,
  /**
   * 'SP' — a reseller store's P&L months (RS-8), per store.
   *
   * Closing a store month and detecting changes to its closed months both
   * read "what has been reported" (snapshot + carry-forwards) and insert
   * the difference; two runs at once would each read the same baseline and
   * each carry the same change. Both take this key first.
   */
  STORE_PNL_PERIOD: 0x05370,
  /**
   * 'LR' — asking to reprint a serial label (LBL-5b), per consignment.
   *
   * A request reads "is any of these serials already on an open request"
   * and then inserts; two requests for the same damaged box at once would
   * each see the other missing, and two approvals would put two new
   * stickers on one unit.
   */
  LABEL_REPRINT: 0x04c52,
  /**
   * 'SQ' — a reseller store's HELD request (2026-09-17), per
   * (order, kind). Asking reads "is one of this kind already open on the
   * order" and then inserts; two clicks at once would each see the other
   * missing and seller staff would be asked the same question twice.
   */
  STORE_ORDER_REQUEST: 0x05351,
  /**
   * 'DA' — one OPEN delivery-action request per order (2026-09-17). Asking
   * reads "is a PENDING or APPROVED request already open on this order"
   * and then inserts; a double click (or a store and its seller asking at
   * once) would each see the other missing, and a DIRECT send-back would
   * ask the courier to cancel twice. Keyed on the order id, taken inside
   * the transaction that re-checks and inserts.
   */
  DELIVERY_ACTION_REQUEST: 0x04441,
  /**
   * 'AC' — one OPEN reseller-store address correction per order
   * (2026-09-17). Same read-then-insert shape as `DELIVERY_ACTION_REQUEST`:
   * two corrections held for seller staff on one address cannot both be
   * right. Keyed on the order id.
   */
  STORE_ADDRESS_CHANGE: 0x04143,
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
