import { Injectable } from '@nestjs/common';
import {
  ActorType,
  ChargeType,
  Currency,
  OrderChargeStatus,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
  WalletEntryDirection,
} from '@skydrop/db';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { ResellerOrderMoneyService } from '../../reseller-order-money/services/reseller-order-money.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

/** One open issue per order whose delivery fee the index will not let us re-bill. */
export function chargesNotRebillableKey(orderId: string): string {
  return `order-charges-not-rebillable:${orderId}`;
}

/**
 * R1c (revised-plan roadmap) — the shared ORDER_CHARGES debit,
 * extracted so it can be triggered at TWO different moments in an
 * order's life: at DELIVERED (the existing, default timing —
 * `OrderDeliveredAccrualListener`) or early at AWB-generation time
 * (the new `wallet.courier_fee_deduction_timing = AT_AWB` seller
 * option — `CourierFeeAccrualService`). Both callers own their own
 * transaction and pass it in; this service never opens one itself, so
 * the DELIVERED path can still pair its debit with the COD credit in
 * ONE transaction when neither has happened yet (today's exact
 * behavior), while the AT_AWB path runs in its own, earlier
 * transaction — an unavoidable consequence of debiting well before
 * delivery, not a weakening of the existing pairing.
 *
 * Idempotent: at most one ORDER_CHARGES entry per order, checked
 * INSIDE the caller's tx (so a concurrent caller sees a consistent
 * view). Returns `false` (no-op) when already debited or when there's
 * nothing to charge (total <= 0) — never throws for either case.
 */
@Injectable()
export class OrderChargesAccrualService {
  constructor(
    private readonly wallet: WalletService,
    private readonly resellerMoney: ResellerOrderMoneyService,
    private readonly issues: SystemIssueService,
  ) {}

  /**
   * ONE worklist entry for "the fee is owed and the ledger will not take
   * it", on the same dedupe key for a channel and a reseller order.
   *
   * Deliberately NOT two keys: it is the same fact about the same order,
   * a person settles it the same way, and two entries for one rupee is
   * how a worklist stops being read.
   */
  private async raiseNotRebillable(
    orderId: string,
    sellerId: string,
    charged: number,
    refunded: number,
    reseller: boolean,
  ): Promise<void> {
    await this.issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: reseller
        ? "A reseller order's delivery fee could not be re-billed to the seller"
        : 'A delivery fee could not be re-billed',
      detail:
        `This order was billed its delivery fee, refunded it (lost in transit, or called ` +
        `off), and has now been delivered — so the fee is owed again. The database allows ` +
        `only ONE order-charges entry per order, so it cannot be taken automatically and ` +
        `nothing further will try.\n\n` +
        `Take it by hand on /wallet-transfers as a debit on this seller, with the order ` +
        `number in the reason. ` +
        (reseller
          ? `The STORE's share of the same fee was billed normally — its ledger carries no ` +
            `such limit — so only the seller's share is outstanding. Everything else the ` +
            `delivery owed was charged normally.`
          : `Everything else the delivery owed (the COD credit, the inbound-freight share) ` +
            `was charged normally.`),
      source: 'OrderChargesAccrualService',
      dedupeKey: chargesNotRebillableKey(orderId),
      metadata: { orderId, sellerId, chargeEntries: charged, refundEntries: refunded, reseller },
    });
  }

  async debitIfNeeded(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerId: string,
  ): Promise<boolean> {
    // WAL-7: the idempotency read must be serialised against a
    // concurrent one, or both see "not charged" and both charge.
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);

    // Billed means MORE charges than refunds (2026-09-12). A charge that
    // was refunded — the parcel was lost, or the order called off — and
    // the order then delivered after all ("lost then found", god mode)
    // owes the fee again; a plain "a charge exists" gate left it refunded
    // AND unbilled. `OrderChargesRefundService` pairs them the same way.
    //
    // COUNTED BEFORE THE RESELLER BRANCH, because the seller's half of a
    // reseller order's fee lands in the SAME column under the SAME index
    // and is therefore unbillable in exactly the same state — see below.
    const [charged, refunded] = await Promise.all([
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
      }),
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES_REFUND },
      }),
    ]);

    // RS-6 phase 3c: a reseller store's order splits the fee between the
    // store and the seller by its snapshot — the SAME moment, the same
    // total, two wallets. A channel order never enters this branch.
    //
    // THE SELLER'S HALF OBEYS THE INDEX; THE STORE'S HALF DOES NOT, AND
    // THAT ASYMMETRY IS WHY THIS DECISION IS MADE HERE.
    //
    // This branch used to be the FIRST thing the method did, so a
    // reseller order reached neither the pairing gate above nor the
    // raise-and-skip below. Its own `sellerFeeOutstanding` is the
    // pre-2026-09-27 gate (`charged > refunded`), which answers "bill it"
    // at one charge and one refund — and the write then raised P2002 and
    // aborted the whole delivered-money transaction, taking the
    // inbound-freight share with it. On the default `T_PLUS_N` tier that
    // recurs in the hourly sweep for ever with NOTHING raised, because
    // the sweep catches per row and only logs.
    //
    // The fix is NOT to move this branch below the guard: that guard
    // `return`s, and the STORE's share must still be billed. The store's
    // ledger has no once-per-order unique (deliberately — a store share
    // really can be charged, refunded and charged again, and nets to one
    // debit), so stopping both halves would convert a correct store
    // re-bill into a silent skip and cost more than the bug.
    //
    // So: decide the seller half here, where the issue and its dedupe key
    // already live, and let the store half proceed untouched. Importing
    // the key into the reseller service instead would close a real
    // require cycle — that module is imported BY this one.
    const sellerHalfUnbillable = charged > 0 && charged <= refunded;
    if (await this.resellerMoney.isResellerOrder(tx, orderId)) {
      if (sellerHalfUnbillable) {
        await this.raiseNotRebillable(orderId, sellerId, charged, refunded, true);
      }
      return this.resellerMoney.chargeDeliveryFee(tx, orderId, {
        skipSellerWrite: sellerHalfUnbillable,
      });
    }

    if (charged > refunded) return false;

    // …but the DATABASE refuses the second charge, and the index WINS.
    //
    // `seller_wallet_entries_once_per_order_uq` covers `(linked_order_id,
    // direction)` for nine directions INCLUDING `order_charges`, so
    // "charged once, refunded once" reaches the gate above saying "bill
    // it again" and `applyEntry`'s bare create then raises P2002 —
    // aborting the WHOLE delivered-money transaction, which also carries
    // the Instant Pay COD front and credit and the inbound-freight share
    // (`AccrualExecutionService`). WAL-8's remedy for the resulting
    // `delivered-accrual-failed:<orderId>` is "re-run `handle`", and every
    // re-run hits the identical P2002, so that issue could never clear.
    //
    // The index is the guard against paying an order twice and is NOT
    // weakened (CLAUDE.md says so in bold). A P2002 aborts the whole
    // Postgres transaction, so it cannot be caught and carried on from
    // either — the check has to come FIRST. So: skip the charge, let the
    // COD credit and the freight share commit, and be LOUD, because the
    // fee really is owed and only a person can take it now (TRE-8b's
    // staff wallet transfer is exactly that instrument).
    if (charged > 0) {
      await this.raiseNotRebillable(orderId, sellerId, charged, refunded, false);
      return false;
    }

    const charges = await tx.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      select: { id: true, type: true, amountInr: true, status: true },
    });
    const billedIds: string[] = [];
    let total = new Prisma.Decimal(0);
    // What the total is MADE OF, in the seller's own ledger.
    //
    // Every other direction says what it was — "COD collected
    // (settled)", "GST withheld at 18.00%" — and this one, the largest
    // category by count, said nothing at all: nine of nine rows in
    // production carried a null note. A seller reading their ledger saw
    // "Order charges" and a number, and had to open the order to learn
    // it was delivery plus tax.
    const parts: string[] = [];
    for (const c of charges) {
      if (c.type === ChargeType.REFUND) continue;
      // The return fee has its OWN wallet direction (RTO_FEE) and is
      // taken separately at RTO receive. Summing it here too would
      // charge it twice — and the second charge would be invisible,
      // buried inside an ORDER_CHARGES total.
      if (c.type === ChargeType.RTO_FEE) continue;
      total = total.add(c.amountInr);
      if (c.status === OrderChargeStatus.ESTIMATED) billedIds.push(c.id);
      parts.push(`${c.type.toLowerCase().replaceAll('_', ' ')} ${c.amountInr.toFixed(2)}`);
    }
    if (total.lte(0)) return false;

    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.ORDER_CHARGES,
      amount: total,
      linkedOrderId: orderId,
      actorType: ActorType.SYSTEM,
      note: `Order charges — ${parts.join(', ')}`,
    });

    // The lines just billed are no longer an estimate. CONFIRMED is what
    // the RTO fee is written as at the moment it is billed, and these
    // stayed ESTIMATED after the wallet had been debited for them — the
    // order page read "base shipping · estimated" on a fee the seller had
    // paid. Same transaction as the debit, so the two cannot disagree;
    // exactly the rows summed above; status only, no amount moves.
    if (billedIds.length > 0) {
      await tx.orderCharge.updateMany({
        where: { id: { in: billedIds }, status: OrderChargeStatus.ESTIMATED },
        data: { status: OrderChargeStatus.CONFIRMED },
      });
    }
    return true;
  }
}
