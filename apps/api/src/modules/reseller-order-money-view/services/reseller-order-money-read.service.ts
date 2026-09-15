import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentMode,
  Prisma,
  ResellerCreditStatus,
  ResellerCreditTrigger,
  ResellerMoneyParty,
  StoreWalletEntryDirection,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { readResellerOrderSnapshot } from '../../reseller-order-money/reseller-order-snapshot.read';
import { STORE_CREDIT_DIRECTIONS } from '../../reseller-store-wallet/services/store-wallet.service';
import { timingWords } from '../../reseller-store-terms/terms/terms-rules';
import { isCredit } from '../../seller-wallet/services/wallet.service';

const ZERO = new Prisma.Decimal(0);

/** Who is asking: each sees both parties' plan, and only its own wallet lines. */
export type MoneyAudience = 'STORE' | 'SELLER' | 'STAFF';

export interface PartyCreditView {
  readonly party: ResellerMoneyParty;
  readonly trigger: ResellerCreditTrigger;
  readonly days: number;
  /** The timing in words — the same sentence the Terms screens show. */
  readonly timing: string;
  readonly status: ResellerCreditStatus;
  readonly dueAt: string | null;
  readonly creditedAt: string | null;
  readonly reversedAt: string | null;
  readonly skippedReason: string | null;
  readonly grossInr: string;
  readonly transferInr: string;
  readonly taxShareInr: string;
  readonly codFeeShareInr: string;
  readonly instantFeeShareInr: string;
  readonly netInr: string;
}

export interface MoneyLineView {
  readonly id: string;
  readonly direction: string;
  readonly shareOf: WalletEntryDirection | null;
  /** Signed: + credited to that wallet, − taken from it. */
  readonly amountInr: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface FeeSplitView {
  /** Which Skydrop fee, by the seller-side direction it is charged under. */
  readonly fee: WalletEntryDirection;
  /** Charged so far, net of refunds — each side. */
  readonly storeInr: string;
  readonly sellerInr: string;
  readonly totalInr: string;
}

export interface ResellerOrderMoneyView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly paymentMode: PaymentMode;
  readonly codInr: string | null;
  readonly transferTotalInr: string;
  readonly retailTotalInr: string;
  readonly termsVersionId: string;
  readonly storePercents: Readonly<Record<string, string>>;
  readonly parties: readonly PartyCreditView[];
  /** Delivery, return and customer-return fees billed so far, split. */
  readonly fees: readonly FeeSplitView[];
  /** The store wallet's lines for this order — null when the audience may not see them. */
  readonly storeLines: readonly MoneyLineView[] | null;
  readonly sellerLines: readonly MoneyLineView[] | null;
  /** Σ of the store's lines on this order (null when hidden). */
  readonly storeNetInr: string | null;
  /** Σ of the seller's reseller-order lines on this order (null when hidden). */
  readonly sellerNetInr: string | null;
}

/** The seller-wallet directions a reseller order writes (the seller's side of its money). */
const SELLER_DIRECTIONS: readonly WalletEntryDirection[] = [
  WalletEntryDirection.RESELLER_TRANSFER_CREDIT,
  WalletEntryDirection.RESELLER_TRANSFER_REVERSAL,
  WalletEntryDirection.PREPAID_TRANSFER_CREDIT,
  WalletEntryDirection.PREPAID_TRANSFER_REVERSAL,
  WalletEntryDirection.ORDER_CHARGES,
  WalletEntryDirection.ORDER_CHARGES_REFUND,
  WalletEntryDirection.RTO_FEE,
  WalletEntryDirection.CUSTOMER_RETURN_FEE,
  WalletEntryDirection.GST_WITHHOLDING,
  WalletEntryDirection.COD_COLLECTION_FEE,
  WalletEntryDirection.INSTANT_PAY_FEE,
  WalletEntryDirection.COD_DEDUCTION_REFUND,
  WalletEntryDirection.INBOUND_FREIGHT,
  WalletEntryDirection.SCRAP_REFUND,
  WalletEntryDirection.STORE_DISPUTE_IN,
  WalletEntryDirection.STORE_DISPUTE_OUT,
];

/** The carriage fees split on a reseller order, by their seller-side direction. */
const CARRIAGE_FEES: readonly WalletEntryDirection[] = [
  WalletEntryDirection.ORDER_CHARGES,
  WalletEntryDirection.RTO_FEE,
  WalletEntryDirection.CUSTOMER_RETURN_FEE,
];

/**
 * RS-6 phase 3c — what a reseller order pays and earns, and when: the plan
 * per party (`reseller_order_credits`), the carriage fees billed so far
 * split by the order's snapshot, and — for whoever may see them — the
 * wallet lines themselves. Read only; derived from the ledgers.
 */
@Injectable()
export class ResellerOrderMoneyReadService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(
    orderId: string,
    scope: { audience: MoneyAudience; storeId?: string; sellerId?: string },
  ): Promise<ResellerOrderMoneyView> {
    const db = this.prisma.client;
    const snap = await readResellerOrderSnapshot(db, orderId);
    // One generic 404 for "no such order", "not a reseller order" and "not
    // yours" — a miss says nothing about whether the order exists.
    if (
      snap === null ||
      (scope.storeId !== undefined && snap.storeId !== scope.storeId) ||
      (scope.sellerId !== undefined && snap.sellerId !== scope.sellerId)
    ) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No such reseller order' });
    }
    const [rows, storeEntries, sellerEntries, store] = await Promise.all([
      db.resellerOrderCredit.findMany({ where: { orderId }, orderBy: { party: 'asc' } }),
      db.storeWalletEntry.findMany({
        where: { linkedOrderId: orderId, storeId: snap.storeId },
        orderBy: { id: 'asc' },
      }),
      db.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction: { in: [...SELLER_DIRECTIONS] } },
        orderBy: { id: 'asc' },
      }),
      db.sellerStore.findUnique({
        where: { id: snap.storeId },
        select: { name: true, displayName: true, seller: { select: { companyName: true } } },
      }),
    ]);
    const storeName = store?.displayName ?? store?.name ?? 'The store';
    const sellerName = store?.seller.companyName ?? 'The seller';

    const storeLines: MoneyLineView[] = storeEntries.map((e) => ({
      id: e.id,
      direction: e.direction,
      shareOf: e.shareOf,
      amountInr: (STORE_CREDIT_DIRECTIONS.has(e.direction) ? e.amount : e.amount.neg()).toFixed(2),
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    }));
    const sellerLines: MoneyLineView[] = sellerEntries.map((e) => ({
      id: e.id,
      direction: e.direction,
      shareOf: null,
      amountInr: (isCredit(e.direction) ? e.amount : e.amount.neg()).toFixed(2),
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    }));
    const net = (lines: readonly MoneyLineView[]): string =>
      lines.reduce((t, l) => t.add(new Prisma.Decimal(l.amountInr)), ZERO).toFixed(2);

    const fees: FeeSplitView[] = CARRIAGE_FEES.map((fee) => {
      const sellerCharged = sellerEntries
        .filter((e) => e.direction === fee)
        .reduce((t, e) => t.add(e.amount), ZERO);
      const sellerRefunded =
        fee === WalletEntryDirection.ORDER_CHARGES
          ? sellerEntries
              .filter((e) => e.direction === WalletEntryDirection.ORDER_CHARGES_REFUND)
              .reduce((t, e) => t.add(e.amount), ZERO)
          : ZERO;
      const storeCharged = storeEntries
        .filter((e) => e.direction === StoreWalletEntryDirection.FEE_SHARE && e.shareOf === fee)
        .reduce((t, e) => t.add(e.amount), ZERO);
      const storeRefunded = storeEntries
        .filter((e) => e.direction === StoreWalletEntryDirection.SHARE_REFUND && e.shareOf === fee)
        .reduce((t, e) => t.add(e.amount), ZERO);
      const s = sellerCharged.sub(sellerRefunded);
      const st = storeCharged.sub(storeRefunded);
      return {
        fee,
        storeInr: st.toFixed(2),
        sellerInr: s.toFixed(2),
        totalInr: s.add(st).toFixed(2),
      };
    }).filter((f) => !new Prisma.Decimal(f.totalInr).isZero());

    const showStore = scope.audience !== 'SELLER';
    const showSeller = scope.audience !== 'STORE';
    return {
      orderId: snap.orderId,
      orderNumber: snap.orderNumber,
      paymentMode: snap.paymentMode,
      codInr: snap.codAmountInr?.toFixed(2) ?? null,
      transferTotalInr: snap.transferTotalInr.toFixed(2),
      retailTotalInr: snap.retailTotalInr.toFixed(2),
      termsVersionId: snap.termsVersionId,
      storePercents: Object.fromEntries(
        Object.entries(snap.storePercents).map(([k, v]) => [k, v.toFixed(2)]),
      ),
      parties: rows.map((r) => ({
        party: r.party,
        trigger: r.trigger,
        days: r.days,
        timing: timingWords(
          { trigger: r.trigger, days: r.days },
          r.party === ResellerMoneyParty.STORE ? storeName : sellerName,
        ),
        status: r.status,
        dueAt: r.dueAt?.toISOString() ?? null,
        creditedAt: r.creditedAt?.toISOString() ?? null,
        reversedAt: r.reversedAt?.toISOString() ?? null,
        skippedReason: r.skippedReason,
        grossInr: r.grossInr.toFixed(2),
        transferInr: r.transferInr.toFixed(2),
        taxShareInr: r.taxShareInr.toFixed(2),
        codFeeShareInr: r.codFeeShareInr.toFixed(2),
        instantFeeShareInr: r.instantFeeShareInr.toFixed(2),
        netInr: r.netInr.toFixed(2),
      })),
      fees,
      storeLines: showStore ? storeLines : null,
      sellerLines: showSeller ? sellerLines : null,
      storeNetInr: showStore ? net(storeLines) : null,
      sellerNetInr: showSeller ? net(sellerLines) : null,
    };
  }
}
