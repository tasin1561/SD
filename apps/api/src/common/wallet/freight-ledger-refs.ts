import { WalletEntryDirection } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';

/** What a freight ledger line points at — the consignment it was for. */
export interface FreightLedgerRef {
  readonly id: string;
  readonly number: string;
}

/** The subset of a Prisma client this needs — a transaction works too. */
type ChargeReader = Pick<Prisma.TransactionClient, 'inboundFreightCharge'>;

/**
 * The inbound-freight wallet directions, which are the two that belong to
 * a CONSIGNMENT rather than an order and therefore carry no
 * `linkedOrderId`.
 */
const FREIGHT_DIRECTIONS: ReadonlySet<WalletEntryDirection> = new Set([
  WalletEntryDirection.INBOUND_FREIGHT,
  WalletEntryDirection.INBOUND_FREIGHT_REFUND,
]);

/**
 * Which consignment each inbound-freight ledger line on a page belongs
 * to, keyed by wallet-entry id.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 * An `INBOUND_FREIGHT` debit has no `linkedOrderId` — it belongs to a
 * consignment, not an order — so the Linked column had nothing to show
 * and a seller could read "you were charged ₹3,000" with no way to reach
 * what they were charged FOR.
 *
 * It is a REVERSE LOOKUP rather than a new column: both
 * `inbound_freight_charges.wallet_entry_id` and `.void_reversal_entry_id`
 * are already UNIQUE (they are the charged-once and refunded-once
 * evidence), so they answer this without widening the append-only ledger.
 *
 * ── WHY IT IS SHARED ──────────────────────────────────────────────────
 * The seller's ledger and the admin's were two copies of this walk, and
 * the second direction would have had to be remembered in both. It takes
 * the caller's client rather than being a service, the same shape as
 * `treasury/services/store-wallet-balances.ts` — a service here would
 * pull a module dependency into two controllers that need nothing else
 * from freight.
 */
export async function freightRefsForEntries(
  db: ChargeReader,
  rows: ReadonlyArray<{ readonly id: string; readonly direction: WalletEntryDirection }>,
): Promise<Map<string, FreightLedgerRef>> {
  const out = new Map<string, FreightLedgerRef>();
  const ids = rows.filter((r) => FREIGHT_DIRECTIONS.has(r.direction)).map((r) => r.id);
  if (ids.length === 0) return out;

  const charges = await db.inboundFreightCharge.findMany({
    // Both links, in ONE query: a page can hold a bill's charge and the
    // credit that withdrew it, and they are different columns on the
    // same row.
    where: {
      OR: [{ walletEntryId: { in: ids } }, { voidReversalEntryId: { in: ids } }],
    },
    select: {
      walletEntryId: true,
      voidReversalEntryId: true,
      consignmentId: true,
      consignment: { select: { consignmentNumber: true } },
    },
  });
  for (const c of charges) {
    const ref: FreightLedgerRef = { id: c.consignmentId, number: c.consignment.consignmentNumber };
    if (c.walletEntryId !== null) out.set(c.walletEntryId, ref);
    if (c.voidReversalEntryId !== null) out.set(c.voidReversalEntryId, ref);
  }
  return out;
}
