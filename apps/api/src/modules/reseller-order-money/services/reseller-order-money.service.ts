import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ChargeType,
  Currency,
  OrderChargeStatus,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerCreditStatus,
  ResellerMoneyParty,
  SellerStoreKind,
  StoreWalletEntryDirection,
  WalletEntryDirection,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { PricingEngineService } from '../../pricing/services/pricing-engine.service';
import { StoreWalletService } from '../../reseller-store-wallet/services/store-wallet.service';
import { splitFee } from '../../reseller-store-terms/terms/fee-split';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import {
  COLLECTION_FEE_KEY,
  DEFAULT_COLLECTION_FEE_PERCENT,
  DEFAULT_GST_PERCENT,
  DEFAULT_INSTANT_FEE_PERCENT,
  GST_KEY,
  INSTANT_FEE_KEY,
} from '../../seller-wallet-accrual/services/cod-credit.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import {
  anchorOf,
  cashTakenOnReversal,
  creditMayRun,
  dueAt,
  planCredits,
  prepaidDebit,
  REARM_ON_PAYOUT_REASONS,
  figureColumns,
  figures,
  figuresMoved,
  type CodRates,
  type CreditAnchor,
  type CreditFigures,
  type PartyCreditPlan,
} from '../plan/reseller-money-plan';
import { readResellerOrderSnapshot } from '../reseller-order-snapshot.read';

type Tx = Prisma.TransactionClient;
type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);

/**
 * Every money transaction here waits on the SELLER's WALLET lock (the
 * seller and all their stores serialise together, RS-6), so under
 * contention a caller legitimately queues — Prisma's 2 s / 5 s defaults
 * would turn that queue into failures. Same shape as STORE_WALLET_TX_OPTIONS.
 */
export const RESELLER_MONEY_TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

/** The COD deductions a credit carries, and the store fee shares that mirror them. */
const COD_DEDUCTION_DIRECTIONS: readonly WalletEntryDirection[] = [
  WalletEntryDirection.GST_WITHHOLDING,
  WalletEntryDirection.COD_COLLECTION_FEE,
  WalletEntryDirection.INSTANT_PAY_FEE,
];
const COD_FEE_SHARE_OF: readonly WalletEntryDirection[] = [
  WalletEntryDirection.COD_COLLECTION_FEE,
  WalletEntryDirection.INSTANT_PAY_FEE,
];

/** What the money needs to know about a reseller order — null for a channel one. */
export interface ResellerOrderHead {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly storeId: string;
  readonly status: OrderStatus;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: Prisma.Decimal | null;
  readonly deliveryFeeStorePercent: Prisma.Decimal;
  readonly returnFeeStorePercent: Prisma.Decimal;
  readonly customerReturnFeeStorePercent: Prisma.Decimal;
}

type CreditRow = Prisma.ResellerOrderCreditGetPayload<object>;

/** What happened to ONE party's credit when the order was re-priced. */
export interface RecalculatedParty {
  readonly party: ResellerMoneyParty;
  /**
   * UNCHANGED — the edit did not move this party's money.
   * REPLANNED  — nothing was written yet; the plan's figures were rewritten.
   * RECREDITED — money HAD been written: it was taken back and written
   *              again at the new figures (see `recalculateAfterEdit`).
   */
  readonly what: 'UNCHANGED' | 'REPLANNED' | 'RECREDITED';
  readonly before: CreditFigures;
  readonly after: CreditFigures;
}

export interface ResellerMoneyRecalculation {
  readonly outcome: 'NOT_A_RESELLER_ORDER' | 'NOT_PLANNED_YET' | 'UNCHANGED' | 'REPLANNED';
  readonly parties: readonly RecalculatedParty[];
  /** A prepaid order's up-front debit, when the change moved it. */
  readonly prepaid: { readonly beforeInr: string; readonly afterInr: string } | null;
}

export interface CourierReversalOutcome {
  readonly outcome: 'REVERSED' | 'NEVER_CREDITED' | 'ALREADY_REVERSED';
  /** Σ the gross of every credit taken back (the store's COD and/or the seller's transfer price). */
  readonly grossInr: Prisma.Decimal;
  /** The group's cash that stops being theirs — the caller moves it to capital. */
  readonly take: Prisma.Decimal;
}

/**
 * RS-6 phase 3c — the MONEY of a reseller store's orders.
 *
 * It EXECUTES the pure plan (`reseller-money-plan.ts`) and decides nothing
 * about amounts itself. Every write goes through `WalletService.applyEntry`
 * (the seller) or `StoreWalletService.applyEntry` (the store), under the
 * SELLER's WALLET lock — the one lock the seller and all their stores
 * share — in ONE transaction per event, and every credit's status move is
 * a guarded `updateMany` on the status it read, in that same transaction
 * (read-then-write under READ COMMITTED is not a guard).
 *
 * ── WHAT IT DOES AND WHEN ────────────────────────────────────────────
 *  - Skydrop's FEES are billed at exactly the channel's moments, through
 *    the channel's services (`OrderChargesAccrualService`,
 *    `RtoFeeAccrualService`, `OrderChargesRefundService` branch into
 *    `chargeDeliveryFee` / `chargeReturnFeeSplit` / `refundDeliveryFee`),
 *    split by the order's snapshot: the seller's share under the seller's
 *    usual direction, the store's as a FEE_SHARE naming the fee.
 *  - Each party's CREDIT (`reseller_order_credits`) is planned once and
 *    written at its trigger: AFTER_CONFIRMATION from `onConfirmed`,
 *    INSTANT / AFTER_DELIVERY from `onDelivered`, ON_PAYOUT from the
 *    courier payout (`onPayoutLine`, inside the settlement's own
 *    transaction), and anything with days to wait by the sweep.
 *  - A PREPAID order takes the transfer price and the store's delivery
 *    share from the store's wallet at confirmation (checked at create by
 *    `assertPrepaidCovered`).
 *  - Money follows the order's FATE (WAL-8): called off, lost, returned
 *    undelivered or reversed by the courier — every credit comes back per
 *    party and anything pending is skipped.
 *
 * ── THE CASH (decision 7, TRE-8c) ────────────────────────────────────
 * A credit of COD money is FRONTED out of capital exactly as an Instant
 * Pay credit is (`front`, reference = the order id — WAL-9), and a courier
 * payout on a reseller order lands wholly as capital's (it repays those
 * fronts). Deductions are TO_CAPITAL through the F2 switch. So after every
 * step: held for the seller = max(0, seller wallet + Σ store wallets) —
 * pinned by `settlement-bank-invariant.spec.ts`.
 */
@Injectable()
export class ResellerOrderMoneyService {
  private readonly logger = new Logger(ResellerOrderMoneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly storeWallet: StoreWalletService,
    private readonly attribution: SellerCashAttributionService,
    private readonly settings: SettingsResolverService,
    private readonly pricing: PricingEngineService,
    private readonly orderCharges: OrderChargesService,
    private readonly audit: AuditLogService,
  ) {}

  // ── What order is this ─────────────────────────────────────────────

  /** A reseller order's head, or null for a channel order (keep today's path). */
  async head(db: Db, orderId: string): Promise<ResellerOrderHead | null> {
    const o = await db.order.findFirst({
      where: { id: orderId, storeKind: SellerStoreKind.RESELLER },
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        storeId: true,
        status: true,
        paymentMode: true,
        codAmountInr: true,
        resellerDeliveryFeeStorePercent: true,
        resellerReturnFeeStorePercent: true,
        resellerCustomerReturnFeeStorePercent: true,
      },
    });
    if (o === null) return null;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      sellerId: o.sellerId,
      storeId: o.storeId,
      status: o.status,
      paymentMode: o.paymentMode,
      codAmountInr: o.codAmountInr,
      deliveryFeeStorePercent: o.resellerDeliveryFeeStorePercent ?? ZERO,
      returnFeeStorePercent: o.resellerReturnFeeStorePercent ?? ZERO,
      customerReturnFeeStorePercent: o.resellerCustomerReturnFeeStorePercent ?? ZERO,
    };
  }

  /** Is this a reseller store's order? The one question every channel branch asks. */
  async isResellerOrder(db: Db, orderId: string): Promise<boolean> {
    const o = await db.order.findFirst({
      where: { id: orderId, storeKind: SellerStoreKind.RESELLER },
      select: { id: true },
    });
    return o !== null;
  }

  private async lock(tx: Tx, sellerId: string): Promise<void> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);
  }

  // ── The plan ───────────────────────────────────────────────────────

  /**
   * The order's credit rows, planned the first time they are needed.
   * The COD rates are the seller's AT THAT MOMENT (usually confirmation) —
   * the snapshot principle: later edits never re-price an order. The
   * caller holds the seller's WALLET lock, so two callers cannot both plan.
   *
   * The rates are STAMPED onto the rows (2026-09-18) so a later
   * recalculation re-prices only what the edit changed — see
   * `ratesFor` and `recalculateAfterEdit`.
   */
  async ensurePlan(tx: Tx, orderId: string): Promise<CreditRow[]> {
    const existing = await tx.resellerOrderCredit.findMany({
      where: { orderId },
      orderBy: { party: 'asc' },
    });
    if (existing.length > 0) return existing;
    const snap = await readResellerOrderSnapshot(tx, orderId);
    if (snap === null) return [];
    const rates = await this.resolveRates(tx, snap.sellerId);
    const plan = planCredits({
      paymentMode: snap.paymentMode,
      codInr: snap.codAmountInr,
      transferTotalInr: snap.transferTotalInr,
      storePercents: snap.storePercents,
      storeCredit: snap.storeCredit,
      sellerCredit: snap.sellerCredit,
      rates,
    });
    const rows = [plan.store, plan.seller].filter((p): p is PartyCreditPlan => p !== null);
    await tx.resellerOrderCredit.createMany({
      data: rows.map((p) => ({
        orderId,
        sellerId: snap.sellerId,
        storeId: snap.storeId,
        party: p.party === 'STORE' ? ResellerMoneyParty.STORE : ResellerMoneyParty.SELLER,
        trigger: p.trigger,
        days: p.days,
        grossInr: p.grossInr,
        transferInr: p.transferInr,
        taxShareInr: p.taxShareInr,
        codFeeShareInr: p.codFeeShareInr,
        instantFeeShareInr: p.instantFeeShareInr,
        netInr: p.netInr,
        gstPercentAtPlan: rates.gstPercent,
        codFeePercentAtPlan: rates.codFeePercent,
        instantPayFeePercentAtPlan: rates.instantPayFeePercent,
      })),
      skipDuplicates: true,
    });
    return tx.resellerOrderCredit.findMany({ where: { orderId }, orderBy: { party: 'asc' } });
  }

  /** The seller's COD rates right now (SET-1). */
  private async resolveRates(tx: Tx, sellerId: string): Promise<CodRates> {
    return {
      gstPercent: await this.sellerDecimal(tx, sellerId, GST_KEY, DEFAULT_GST_PERCENT),
      codFeePercent: await this.sellerDecimal(
        tx,
        sellerId,
        COLLECTION_FEE_KEY,
        DEFAULT_COLLECTION_FEE_PERCENT,
      ),
      instantPayFeePercent: await this.sellerDecimal(
        tx,
        sellerId,
        INSTANT_FEE_KEY,
        DEFAULT_INSTANT_FEE_PERCENT,
      ),
    };
  }

  /**
   * The rates a RECALCULATION must use: the ones stamped when the order
   * was planned, not today's.
   *
   * A seller's COD fee percent is a live setting. Re-resolving it here
   * would let a rate somebody changed last week move the money of an
   * order placed before it — which is not what the edit asked for, and
   * would be invisible in the before/after the store is shown. Rows
   * planned before the stamp existed have nothing to read, so those fall
   * back to today's; that is the honest best available answer and it is
   * named in the audit row.
   */
  private async ratesFor(
    tx: Tx,
    sellerId: string,
    rows: readonly CreditRow[],
  ): Promise<{ rates: CodRates; fromPlan: boolean }> {
    const stamped = rows.find((r) => r.gstPercentAtPlan !== null);
    if (
      stamped !== undefined &&
      stamped.gstPercentAtPlan !== null &&
      stamped.codFeePercentAtPlan !== null &&
      stamped.instantPayFeePercentAtPlan !== null
    ) {
      return {
        rates: {
          gstPercent: stamped.gstPercentAtPlan,
          codFeePercent: stamped.codFeePercentAtPlan,
          instantPayFeePercent: stamped.instantPayFeePercentAtPlan,
        },
        fromPlan: true,
      };
    }
    return { rates: await this.resolveRates(tx, sellerId), fromPlan: false };
  }

  private async sellerDecimal(
    tx: Tx,
    sellerId: string,
    key: string,
    fallback: string,
  ): Promise<Prisma.Decimal> {
    const resolved = await this.settings.resolve(sellerId, key, tx);
    const raw = resolved.value;
    return new Prisma.Decimal(raw === null || raw === undefined ? fallback : String(raw));
  }

  /** WAITING rows whose trigger counts from `anchor` become DUE. */
  private async arm(
    tx: Tx,
    rows: readonly CreditRow[],
    anchor: CreditAnchor,
    at: Date,
    paymentMode: PaymentMode,
  ): Promise<void> {
    for (const row of rows) {
      if (row.status !== ResellerCreditStatus.WAITING) continue;
      if (anchorOf(row.trigger, paymentMode) !== anchor) continue;
      await tx.resellerOrderCredit.updateMany({
        where: { id: row.id, status: ResellerCreditStatus.WAITING },
        data: { status: ResellerCreditStatus.DUE, dueAt: dueAt(at, row.days) },
      });
    }
  }

  // ── Skydrop's fees, split ──────────────────────────────────────────

  /** Σ the order's charge lines the delivery debit bills — the channel's sum, exactly. */
  private async deliveryCharges(
    db: Db,
    orderId: string,
  ): Promise<{ total: Prisma.Decimal; billedIds: string[]; parts: string[] }> {
    const charges = await db.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      select: { id: true, type: true, amountInr: true, status: true },
    });
    let total = ZERO;
    const billedIds: string[] = [];
    const parts: string[] = [];
    for (const c of charges) {
      if (c.type === ChargeType.REFUND) continue;
      if (c.type === ChargeType.RTO_FEE) continue;
      total = total.add(c.amountInr);
      if (c.status === OrderChargeStatus.ESTIMATED) billedIds.push(c.id);
      parts.push(`${c.type.toLowerCase().replaceAll('_', ' ')} ${c.amountInr.toFixed(2)}`);
    }
    return { total, billedIds, parts };
  }

  /** Charged more times than refunded — the channel's pairing, per side. */
  private async sellerFeeOutstanding(tx: Tx, orderId: string): Promise<boolean> {
    const [charged, refunded] = await Promise.all([
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
      }),
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES_REFUND },
      }),
    ]);
    return charged > refunded;
  }

  private async storeShareOutstanding(
    tx: Tx,
    orderId: string,
    shareOf: WalletEntryDirection,
  ): Promise<boolean> {
    const [charged, refunded] = await Promise.all([
      tx.storeWalletEntry.count({
        where: { linkedOrderId: orderId, direction: StoreWalletEntryDirection.FEE_SHARE, shareOf },
      }),
      tx.storeWalletEntry.count({
        where: {
          linkedOrderId: orderId,
          direction: StoreWalletEntryDirection.SHARE_REFUND,
          shareOf,
        },
      }),
    ]);
    return charged > refunded;
  }

  /**
   * The delivery fee on a reseller order, split — called by
   * `OrderChargesAccrualService.debitIfNeeded` INSTEAD of its own debit, at
   * every moment the channel bills it (delivery accrual, AT_AWB, RTO
   * receive, the backfill). Composes into the caller's transaction.
   *
   * Each side has its own exactly-once gate (charged more than refunded),
   * so a side billed early (a prepaid order's store share, taken at
   * confirmation) is not billed again, and "lost then found" re-bills both
   * after both were refunded. Returns whether anything was written.
   */
  async chargeDeliveryFee(tx: Tx, orderId: string): Promise<boolean> {
    const head = await this.head(tx, orderId);
    if (head === null) return false;
    await this.lock(tx, head.sellerId);
    const { total, billedIds, parts } = await this.deliveryCharges(tx, orderId);
    if (total.lessThanOrEqualTo(0)) return false;
    const split = splitFee(total, head.deliveryFeeStorePercent);
    let wrote = false;
    if (split.sellerInr.greaterThan(0) && !(await this.sellerFeeOutstanding(tx, orderId))) {
      await this.wallet.applyEntry(tx, {
        sellerId: head.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.ORDER_CHARGES,
        amount: split.sellerInr,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `Order charges — your share of ${parts.join(', ')} on reseller order ${head.orderNumber} (the store pays ${split.storePercent.toFixed(2)}%)`,
      });
      wrote = true;
    }
    if (
      split.storeInr.greaterThan(0) &&
      !(await this.storeShareOutstanding(tx, orderId, WalletEntryDirection.ORDER_CHARGES))
    ) {
      await this.storeWallet.applyEntry(tx, {
        storeId: head.storeId,
        sellerId: head.sellerId,
        direction: StoreWalletEntryDirection.FEE_SHARE,
        shareOf: WalletEntryDirection.ORDER_CHARGES,
        amount: split.storeInr,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `Delivery fee — your ${split.storePercent.toFixed(2)}% share on order ${head.orderNumber}`,
      });
      wrote = true;
    }
    if (wrote && billedIds.length > 0) {
      await tx.orderCharge.updateMany({
        where: { id: { in: billedIds }, status: OrderChargeStatus.ESTIMATED },
        data: { status: OrderChargeStatus.CONFIRMED },
      });
    }
    return wrote;
  }

  /**
   * The delivery fee given back on a reseller order that ended without its
   * parcel leaving (or was lost) — `OrderChargesRefundService` delegates
   * here. Each side returns the LATEST charge no refund points at, as the
   * channel does. Opens its own transaction. Null when nothing was owed back.
   */
  async refundDeliveryFee(orderId: string, reason: string): Promise<Prisma.Decimal | null> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return null;
    const refunded = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      let total = ZERO;
      const charges = await tx.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
        select: { id: true, amount: true },
        orderBy: { id: 'desc' },
      });
      const refunds = await tx.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES_REFUND },
        select: { linkedEntryId: true },
      });
      const done = new Set(refunds.map((r) => r.linkedEntryId));
      const charge =
        refunds.length < charges.length ? charges.find((c) => !done.has(c.id)) : undefined;
      if (charge !== undefined) {
        await this.wallet.applyEntry(tx, {
          sellerId: head.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
          amount: charge.amount,
          linkedOrderId: orderId,
          linkedEntryId: charge.id,
          note: reason,
          actorType: ActorType.SYSTEM,
        });
        total = total.add(charge.amount);
      }
      const share = await this.latestUnreturnedStore(
        tx,
        orderId,
        StoreWalletEntryDirection.FEE_SHARE,
        StoreWalletEntryDirection.SHARE_REFUND,
        WalletEntryDirection.ORDER_CHARGES,
      );
      if (share !== null) {
        await this.storeWallet.applyEntry(tx, {
          storeId: head.storeId,
          sellerId: head.sellerId,
          direction: StoreWalletEntryDirection.SHARE_REFUND,
          shareOf: WalletEntryDirection.ORDER_CHARGES,
          amount: share.amount,
          linkedOrderId: orderId,
          linkedEntryId: share.id,
          actorType: ActorType.SYSTEM,
          note: `Delivery fee share returned — ${reason}`,
        });
        total = total.add(share.amount);
      }
      if (total.isZero()) return null;
      await this.audit.log(
        {
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: head.sellerId,
          action: 'wallet.order_charges_refunded',
          entityType: 'order',
          entityId: orderId,
          severity: 'LOW',
          metadata: {
            amountInr: total.toFixed(2),
            sellerShareInr: charge?.amount.toFixed(2) ?? '0.00',
            storeShareInr: share?.amount.toFixed(2) ?? '0.00',
            storeId: head.storeId,
            reason,
          },
        },
        tx,
      );
      return total;
    }, RESELLER_MONEY_TX_OPTIONS);
    if (refunded !== null) await this.afterCommit(head.sellerId, 'reseller-fee-refund');
    return refunded;
  }

  /**
   * Has a reseller order's return fee (RTO or customer-return) been
   * charged to EITHER side? `RtoFeeAccrualService`'s gate, for a split fee.
   */
  async returnFeeCharged(
    tx: Tx,
    orderId: string,
    direction: WalletEntryDirection,
  ): Promise<boolean> {
    const [seller, store] = await Promise.all([
      tx.sellerWalletEntry.findFirst({
        where: { linkedOrderId: orderId, direction },
        select: { id: true },
      }),
      tx.storeWalletEntry.findFirst({
        where: {
          linkedOrderId: orderId,
          direction: StoreWalletEntryDirection.FEE_SHARE,
          shareOf: direction,
        },
        select: { id: true },
      }),
    ]);
    return seller !== null || store !== null;
  }

  /**
   * A received return's fee on a reseller order, split by the order's
   * return (or customer-return) share. `RtoFeeAccrualService` wrote the
   * charge line and ran the gate; this writes the two shares instead of
   * its single seller debit. Composes into the caller's transaction.
   */
  async chargeReturnFeeSplit(
    tx: Tx,
    input: { orderId: string; direction: WalletEntryDirection; amount: Prisma.Decimal },
  ): Promise<void> {
    const head = await this.head(tx, input.orderId);
    if (head === null) return;
    await this.lock(tx, head.sellerId);
    const percent =
      input.direction === WalletEntryDirection.CUSTOMER_RETURN_FEE
        ? head.customerReturnFeeStorePercent
        : head.returnFeeStorePercent;
    const split = splitFee(input.amount, percent);
    const what =
      input.direction === WalletEntryDirection.CUSTOMER_RETURN_FEE
        ? 'Customer return fee'
        : 'Return fee';
    if (split.sellerInr.greaterThan(0)) {
      await this.wallet.applyEntry(tx, {
        sellerId: head.sellerId,
        currency: Currency.INR,
        direction: input.direction,
        amount: split.sellerInr,
        linkedOrderId: input.orderId,
        actorType: ActorType.SYSTEM,
        note: `${what} — your share on reseller order ${head.orderNumber} (the store pays ${split.storePercent.toFixed(2)}%)`,
      });
    }
    if (split.storeInr.greaterThan(0)) {
      await this.storeWallet.applyEntry(tx, {
        storeId: head.storeId,
        sellerId: head.sellerId,
        direction: StoreWalletEntryDirection.FEE_SHARE,
        shareOf: input.direction,
        amount: split.storeInr,
        linkedOrderId: input.orderId,
        actorType: ActorType.SYSTEM,
        note: `${what} — your ${split.storePercent.toFixed(2)}% share on order ${head.orderNumber}`,
      });
    }
  }

  // ── Prepaid ────────────────────────────────────────────────────────

  /**
   * The store must be able to pay for a PREPAID order before it is
   * accepted (decision 11): its wallet must cover this order's transfer
   * price and delivery share PLUS those of its other prepaid orders not yet
   * confirmed (they have been accepted and not yet taken), within its
   * negative limit. INSIDE the create transaction — `storeCanSpend` takes
   * the seller's WALLET lock, so nothing moves the store, the seller or a
   * sibling store between this read and the order's commit.
   */
  async assertPrepaidCovered(
    tx: Tx,
    input: {
      storeId: string;
      sellerId: string;
      transferTotal: Prisma.Decimal;
      deliveryFeeStorePercent: Prisma.Decimal;
    },
  ): Promise<void> {
    const deliveryFee = await this.estimatedDeliveryFee(input.sellerId);
    const mine = prepaidDebit(input.transferTotal, deliveryFee, input.deliveryFeeStorePercent);
    const committed = await this.committedPrepaid(tx, input.storeId, deliveryFee);
    const need = mine.totalInr.add(committed);
    const can = await this.storeWallet.storeCanSpend(tx, {
      storeId: input.storeId,
      sellerId: input.sellerId,
      amount: need,
    });
    if (!can.allowed) {
      throw new ConflictException({
        code: 'STORE_BALANCE_INSUFFICIENT',
        message:
          `A prepaid order is paid for from the store’s wallet: this one needs ₹${mine.totalInr.toFixed(2)} ` +
          `(₹${mine.transferInr.toFixed(2)} for the goods and ₹${mine.deliveryShareInr.toFixed(2)} of the delivery fee)` +
          (committed.greaterThan(0)
            ? ` on top of ₹${committed.toFixed(2)} for prepaid orders not yet confirmed`
            : '') +
          `. The wallet holds ₹${can.balanceInr} and may go ₹${can.limitInr} below zero. Top it up, or place the order as cash on delivery.`,
        details: {
          requiredInr: need.toFixed(2),
          balanceInr: can.balanceInr,
          limitInr: can.limitInr,
        },
      });
    }
  }

  /** The delivery fee a new order will be charged: the flat fee and its GST (the pricing engine's lines). */
  private async estimatedDeliveryFee(sellerId: string): Promise<Prisma.Decimal> {
    const fee = await this.pricing.resolveDeliveryFee(sellerId);
    const gst = await this.pricing.resolveFeeGstPercent();
    return fee.amount.add(fee.amount.times(gst).dividedBy(100).toDecimalPlaces(2));
  }

  /** What the store's accepted-but-unconfirmed prepaid orders will take. */
  private async committedPrepaid(
    tx: Tx,
    storeId: string,
    deliveryFee: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const orders = await tx.order.findMany({
      where: {
        storeId,
        storeKind: SellerStoreKind.RESELLER,
        paymentMode: PaymentMode.PREPAID,
        deletedAt: null,
        status: {
          in: [
            OrderStatus.DRAFT,
            OrderStatus.PENDING_CONFIRMATION,
            OrderStatus.CALL_NO_RESPONSE,
            OrderStatus.CALL_RESCHEDULED,
            OrderStatus.AWAITING_SELLER_DECISION,
            OrderStatus.OUT_OF_STOCK,
          ],
        },
      },
      select: {
        id: true,
        resellerDeliveryFeeStorePercent: true,
        items: { select: { quantity: true, resellerTransferPriceInr: true } },
      },
    });
    if (orders.length === 0) return ZERO;
    const debited = await tx.storeWalletEntry.findMany({
      where: {
        linkedOrderId: { in: orders.map((o) => o.id) },
        direction: StoreWalletEntryDirection.PREPAID_DEBIT,
      },
      select: { linkedOrderId: true },
    });
    const taken = new Set(debited.map((d) => d.linkedOrderId));
    let sum = ZERO;
    for (const o of orders) {
      if (taken.has(o.id)) continue;
      const transfer = o.items.reduce(
        (t, i) => t.add((i.resellerTransferPriceInr ?? ZERO).mul(i.quantity)),
        ZERO,
      );
      sum = sum.add(
        prepaidDebit(transfer, deliveryFee, o.resellerDeliveryFeeStorePercent ?? ZERO).totalInr,
      );
    }
    return sum;
  }

  /**
   * Take a PREPAID order's price from the store: the transfer price
   * (PREPAID_DEBIT) and the store's delivery share (a FEE_SHARE, so it is
   * Skydrop revenue on the same line a seller's delivery fee is). Gated on
   * PREPAID_DEBIT outnumbering PREPAID_REFUND, so a second confirmation
   * takes nothing. The caller holds the lock.
   */
  private async takePrepaidDebit(
    tx: Tx,
    head: ResellerOrderHead,
    seller: CreditRow,
  ): Promise<void> {
    const [debits, refunds] = await Promise.all([
      tx.storeWalletEntry.count({
        where: { linkedOrderId: head.id, direction: StoreWalletEntryDirection.PREPAID_DEBIT },
      }),
      tx.storeWalletEntry.count({
        where: { linkedOrderId: head.id, direction: StoreWalletEntryDirection.PREPAID_REFUND },
      }),
    ]);
    if (debits > refunds) return;
    if (seller.grossInr.greaterThan(0)) {
      await this.storeWallet.applyEntry(tx, {
        storeId: head.storeId,
        sellerId: head.sellerId,
        direction: StoreWalletEntryDirection.PREPAID_DEBIT,
        amount: seller.grossInr,
        linkedOrderId: head.id,
        actorType: ActorType.SYSTEM,
        note: `Prepaid order ${head.orderNumber} — the goods at the seller’s transfer price`,
      });
    }
    const { total } = await this.deliveryCharges(tx, head.id);
    const share = total.greaterThan(0)
      ? splitFee(total, head.deliveryFeeStorePercent).storeInr
      : ZERO;
    if (
      share.greaterThan(0) &&
      !(await this.storeShareOutstanding(tx, head.id, WalletEntryDirection.ORDER_CHARGES))
    ) {
      await this.storeWallet.applyEntry(tx, {
        storeId: head.storeId,
        sellerId: head.sellerId,
        direction: StoreWalletEntryDirection.FEE_SHARE,
        shareOf: WalletEntryDirection.ORDER_CHARGES,
        amount: share,
        linkedOrderId: head.id,
        actorType: ActorType.SYSTEM,
        note: `Delivery fee — your ${head.deliveryFeeStorePercent.toFixed(2)}% share on prepaid order ${head.orderNumber}`,
      });
    }
  }

  /** Whether the store has paid for this prepaid order and not been refunded. */
  private async prepaidDebited(tx: Tx, orderId: string): Promise<boolean> {
    const [debits, refunds] = await Promise.all([
      tx.storeWalletEntry.count({
        where: { linkedOrderId: orderId, direction: StoreWalletEntryDirection.PREPAID_DEBIT },
      }),
      tx.storeWalletEntry.count({
        where: { linkedOrderId: orderId, direction: StoreWalletEntryDirection.PREPAID_REFUND },
      }),
    ]);
    return debits > refunds;
  }

  /** Give the store back what a prepaid order took, if it still holds it. */
  private async refundPrepaidDebit(tx: Tx, head: ResellerOrderHead, why: string): Promise<boolean> {
    const debit = await this.latestUnreturnedStore(
      tx,
      head.id,
      StoreWalletEntryDirection.PREPAID_DEBIT,
      StoreWalletEntryDirection.PREPAID_REFUND,
      null,
    );
    if (debit === null) return false;
    await this.storeWallet.applyEntry(tx, {
      storeId: head.storeId,
      sellerId: head.sellerId,
      direction: StoreWalletEntryDirection.PREPAID_REFUND,
      amount: debit.amount,
      linkedOrderId: head.id,
      linkedEntryId: debit.id,
      actorType: ActorType.SYSTEM,
      note: `Prepaid order ${head.orderNumber} refunded — ${why}`,
    });
    return true;
  }

  // ── The order CHANGED (owner, 2026-09-18) ──────────────────────────

  /**
   * An edit that would move money is refused BEFORE it is written when
   * the money can no longer follow it. Called by `OrderService.edit`
   * outside its transaction, for a reseller order only.
   *
   * The one case: the PAYMENT MODE, once the credits are planned. COD and
   * PREPAID are not two amounts of the same thing — they are different
   * rows (a COD order has a STORE credit, a prepaid one does not), a
   * different debit (the store pays for a prepaid order up front) and a
   * different set of deductions. Turning one into the other after the
   * plan exists means inventing a party's credit with no anchor to arm it
   * from and guessing whether a debit already taken should come back. We
   * do not guess: the order is called off and placed again, which is two
   * clicks and leaves a correct ledger.
   */
  async assertEditKeepsMoneyCorrectable(
    orderId: string,
    next: { readonly paymentMode?: PaymentMode | undefined },
  ): Promise<void> {
    if (next.paymentMode === undefined) return;
    const head = await this.head(this.prisma.client, orderId);
    if (head === null || head.paymentMode === next.paymentMode) return;
    const planned = await this.prisma.client.resellerOrderCredit.count({ where: { orderId } });
    if (planned === 0) return;
    throw new ConflictException({
      code: 'RESELLER_PAYMENT_MODE_LOCKED',
      message:
        `Order ${head.orderNumber} is already priced as ` +
        `${head.paymentMode === PaymentMode.COD ? 'cash on delivery' : 'prepaid'}, and the store’s ` +
        'money has been worked out from that. Changing how it is paid for now would leave a credit ' +
        'nobody can work out. Call this order off and place it again the other way.',
    });
  }

  /**
   * Re-price a reseller order after seller staff — or the store — changed
   * it (owner, 2026-09-18). Post-commit; the order row already carries the
   * new contents.
   *
   * ── WHICH TERMS ──────────────────────────────────────────────────────
   * The ones SNAPSHOTTED ON THE ORDER (ORD-6 / RS-4): the six fee shares,
   * both credit timings and the per-line transfer price as placed, read
   * back by `readResellerOrderSnapshot`. Never the store's current live
   * terms or price list — re-pointing an existing order at newer terms
   * would change a deal neither side agreed for it. The seller's COD
   * rates likewise come from the plan's own stamp (`ratesFor`).
   *
   * ── WHAT HAPPENS TO MONEY ALREADY POSTED ─────────────────────────────
   * A credit row in any state EXCEPT `CREDITED` has written nothing to a
   * wallet: its figures are a plan, and a guarded `updateMany` on the
   * status it was read in rewrites them. That covers WAITING, DUE,
   * SKIPPED and REVERSED — the last two matter because a later courier
   * payout can re-arm them (`REARM_ON_PAYOUT_REASONS`), and a stale
   * figure there would credit the OLD amount weeks later.
   *
   * A `CREDITED` row HAS moved money. It is not patched with a signed
   * difference across five directions — it is TAKEN BACK through the
   * exact reversal path a return uses (every deduction refunded, the cash
   * returned to capital, `cashTakenOnReversal`) and then WRITTEN AGAIN at
   * the new figures. The net movement is the difference; what the ledger
   * shows is two legible entries — "taken back because the order changed"
   * and the new credit — which is what somebody arguing about this in a
   * month needs to see. Both halves are operations whose cash rules
   * already keep TRE-8c true, so the invariant holds after each step
   * rather than only at the end.
   *
   * A PREPAID order's up-front debit follows the same shape: refunded and
   * retaken when the transfer total moved, and refused before anything is
   * written if the store's wallet cannot carry the bigger one.
   *
   * ONE transaction, under the seller's WALLET lock (the seller and all
   * their stores serialise together), so nothing else credits, reverses or
   * pays out between the reversal and the re-credit.
   */
  async recalculateAfterEdit(
    orderId: string,
    input: { readonly reason: string },
  ): Promise<ResellerMoneyRecalculation> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return { outcome: 'NOT_A_RESELLER_ORDER', parties: [], prepaid: null };

    const result = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      const rows = await tx.resellerOrderCredit.findMany({
        where: { orderId },
        orderBy: { party: 'asc' },
      });
      if (rows.length === 0) {
        // Nothing has been planned, so nothing is stale: the plan is made
        // at confirmation and will read the order as it now stands.
        return { outcome: 'NOT_PLANNED_YET' as const, parties: [], prepaid: null };
      }
      const snap = await readResellerOrderSnapshot(tx, orderId);
      if (snap === null) return { outcome: 'NOT_PLANNED_YET' as const, parties: [], prepaid: null };

      const { rates, fromPlan } = await this.ratesFor(tx, head.sellerId, rows);
      const plan = planCredits({
        paymentMode: snap.paymentMode,
        codInr: snap.codAmountInr,
        transferTotalInr: snap.transferTotalInr,
        storePercents: snap.storePercents,
        storeCredit: snap.storeCredit,
        sellerCredit: snap.sellerCredit,
        rates,
      });
      const planned = new Map<ResellerMoneyParty, PartyCreditPlan>();
      if (plan.store !== null) planned.set(ResellerMoneyParty.STORE, plan.store);
      planned.set(ResellerMoneyParty.SELLER, plan.seller);

      const now = new Date();
      const parties: RecalculatedParty[] = [];
      for (const row of rows) {
        const next = planned.get(row.party);
        if (next === undefined) {
          // Unreachable: a payment-mode change is refused before the edit
          // (`assertEditKeepsMoneyCorrectable`), and nothing else removes
          // a party. Left as a named refusal rather than a silent skip —
          // a credit with no plan behind it must stop a person, not be
          // quietly abandoned.
          throw new ConflictException({
            code: 'RESELLER_CREDIT_HAS_NO_PLAN',
            message:
              `The ${row.party.toLowerCase()}’s credit on order ${head.orderNumber} no longer has ` +
              'a plan behind it, so this change cannot be priced. Nothing was changed.',
          });
        }
        if (!figuresMoved(row, next)) {
          parties.push({
            party: row.party,
            what: 'UNCHANGED',
            before: figures(row),
            after: figures(row),
          });
          continue;
        }
        const before = figures(row);
        if (row.status === ResellerCreditStatus.CREDITED) {
          await this.reverseCreditedWithTake(tx, head, [row], input.reason);
          const rewritten = await tx.resellerOrderCredit.updateMany({
            where: { id: row.id, status: ResellerCreditStatus.REVERSED },
            data: {
              ...figureColumns(next),
              status: ResellerCreditStatus.DUE,
              dueAt: now,
              skippedReason: null,
              timesRepriced: { increment: 1 },
            },
          });
          if (rewritten.count === 0) {
            // Something else moved the row between the reversal and here,
            // inside our own lock — impossible today, and a silent skip
            // would leave a reversed credit nobody re-writes.
            throw new ConflictException({
              code: 'RESELLER_CREDIT_MOVED',
              message: `The ${row.party.toLowerCase()}’s credit on order ${head.orderNumber} changed while it was being re-priced.`,
            });
          }
          await this.executeRow(tx, row.id, now, null);
          parties.push({ party: row.party, what: 'RECREDITED', before, after: figures(next) });
          continue;
        }
        // Nothing written for this party yet: the row IS the plan.
        await tx.resellerOrderCredit.updateMany({
          where: { id: row.id, status: row.status },
          data: { ...figureColumns(next), timesRepriced: { increment: 1 } },
        });
        parties.push({ party: row.party, what: 'REPLANNED', before, after: figures(next) });
      }

      const prepaid = await this.repricePrepaidDebit(tx, head, input.reason);

      const moved = parties.some((p) => p.what !== 'UNCHANGED') || prepaid !== null;
      if (moved) {
        await this.audit.log(
          {
            actorType: ActorType.SYSTEM,
            actorId: null,
            sellerId: head.sellerId,
            action: 'reseller_order.money_recalculated',
            entityType: 'order',
            entityId: orderId,
            severity: 'MEDIUM',
            metadata: {
              storeId: head.storeId,
              orderNumber: head.orderNumber,
              reason: input.reason,
              ratesFromPlan: fromPlan,
              parties: parties.map((p) => ({
                party: p.party,
                what: p.what,
                beforeNetInr: p.before.netInr,
                afterNetInr: p.after.netInr,
              })),
              ...(prepaid === null ? {} : { prepaid }),
            },
          },
          tx,
        );
      }
      return {
        outcome: moved ? ('REPLANNED' as const) : ('UNCHANGED' as const),
        parties,
        prepaid,
      };
    }, RESELLER_MONEY_TX_OPTIONS);

    if (result.outcome === 'REPLANNED') {
      await this.afterCommit(head.sellerId, 'reseller-order-repriced');
    }
    return result;
  }

  /**
   * A prepaid order's up-front debit, after its transfer total moved.
   * Refund what was taken and take the new figure — never a signed patch,
   * for the same reason a credit is reversed and re-written. Returns what
   * changed, or null when nothing was owed differently.
   */
  private async repricePrepaidDebit(
    tx: Tx,
    head: ResellerOrderHead,
    reason: string,
  ): Promise<{ readonly beforeInr: string; readonly afterInr: string } | null> {
    if (head.paymentMode !== PaymentMode.PREPAID) return null;
    const taken = await this.latestUnreturnedStore(
      tx,
      head.id,
      StoreWalletEntryDirection.PREPAID_DEBIT,
      StoreWalletEntryDirection.PREPAID_REFUND,
      null,
    );
    if (taken === null) return null;
    const seller = await tx.resellerOrderCredit.findFirst({
      where: { orderId: head.id, party: ResellerMoneyParty.SELLER },
    });
    if (seller === null || seller.grossInr.equals(taken.amount)) return null;
    const extra = seller.grossInr.sub(taken.amount);
    if (extra.greaterThan(0)) {
      const can = await this.storeWallet.storeCanSpend(tx, {
        storeId: head.storeId,
        sellerId: head.sellerId,
        amount: extra,
      });
      if (!can.allowed) {
        throw new ConflictException({
          code: 'STORE_BALANCE_INSUFFICIENT',
          message:
            `This change makes prepaid order ${head.orderNumber} cost the store ₹${extra.toFixed(2)} more, ` +
            `and its wallet holds ₹${can.balanceInr} with ₹${can.limitInr} of room below zero. ` +
            'Top the store up, or make the change smaller. Nothing was changed.',
          details: { requiredInr: extra.toFixed(2), balanceInr: can.balanceInr },
        });
      }
    }
    await this.refundPrepaidDebit(tx, head, reason);
    await this.takePrepaidDebit(tx, head, seller);
    return { beforeInr: taken.amount.toFixed(2), afterInr: seller.grossInr.toFixed(2) };
  }

  // ── Lifecycle events ───────────────────────────────────────────────

  /**
   * CONFIRMED: plan the credits, take a prepaid order's price from the
   * store, and arm AFTER_CONFIRMATION credits (Skydrop fronts them —
   * counted in the Instant Pay advance float, WAL-9). Idempotent.
   */
  async onConfirmed(orderId: string, at: Date): Promise<void> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return;
    if (head.paymentMode === PaymentMode.PREPAID) await this.ensureCharges(orderId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      const rows = await this.ensurePlan(tx, orderId);
      const seller = rows.find((r) => r.party === ResellerMoneyParty.SELLER);
      if (head.paymentMode === PaymentMode.PREPAID && seller !== undefined) {
        await this.takePrepaidDebit(tx, head, seller);
      }
      await this.arm(tx, rows, 'CONFIRMATION', at, head.paymentMode);
    }, RESELLER_MONEY_TX_OPTIONS);
    await this.executeDueForOrder(orderId, new Date());
  }

  /**
   * DELIVERED (either writer, WAL-8): arm INSTANT and AFTER_DELIVERY
   * credits — but only with proof a courier carried the parcel (the
   * channel's rule: a forced DELIVERED fronts nothing; the courier's
   * payout arms them instead). A prepaid order that skipped confirmation
   * (god mode) is charged its price here, once.
   */
  async onDelivered(orderId: string, at: Date, carried: boolean): Promise<void> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return;
    if (head.paymentMode === PaymentMode.PREPAID) await this.ensureCharges(orderId);
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      const rows = await this.ensurePlan(tx, orderId);
      const seller = rows.find((r) => r.party === ResellerMoneyParty.SELLER);
      if (head.paymentMode === PaymentMode.PREPAID && seller !== undefined) {
        await this.takePrepaidDebit(tx, head, seller);
      }
      if (carried) await this.arm(tx, rows, 'DELIVERY', at, head.paymentMode);
    }, RESELLER_MONEY_TX_OPTIONS);
    await this.executeDueForOrder(orderId, new Date());
  }

  /**
   * The order ENDED without being delivered: called off (cancelled /
   * rejected) or LOST. Pending credits are skipped. When the parcel never
   * left (or was lost), every credit no courier payout covers is taken
   * back per party, and a prepaid order's price goes back to the store —
   * the seller is compensated for goods lost in our hands through a
   * ticket, at the transfer price (RS-7). The delivery fee's own refund is
   * `refundDeliveryFee`, run by the shared post-commit hooks.
   */
  async onEnded(
    orderId: string,
    input: { kind: 'CALLED_OFF' | 'LOST'; parcelLeft: boolean; note: string },
  ): Promise<void> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return;
    const giveBack = input.kind === 'LOST' || !input.parcelLeft;
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      const rows = await tx.resellerOrderCredit.findMany({ where: { orderId } });
      await this.skipPending(tx, rows, `ORDER_${head.status}`);
      if (!giveBack) return;
      const paid = (await tx.courierSettlementLine.count({ where: { orderId } })) > 0;
      if (!paid || head.paymentMode === PaymentMode.PREPAID) {
        await this.reverseCreditedWithTake(tx, head, rows, input.note);
      }
      if (head.paymentMode === PaymentMode.PREPAID) {
        await this.refundPrepaidDebit(tx, head, input.note);
      }
    }, RESELLER_MONEY_TX_OPTIONS);
    await this.afterCommit(head.sellerId, 'reseller-order-ended');
  }

  /**
   * The parcel is back with us (RTO received, or a finalize reached
   * without it). Never delivered: every credit comes back and pending ones
   * are skipped — the COD was never collected. Delivered first (a customer
   * return): a COD order's credits stand until the courier reverses the
   * COD on a payout, exactly as a channel order's do. Either way a prepaid
   * order's goods are the seller's again, so the store's price goes back
   * and the seller's transfer credit with it.
   */
  async onReturned(orderId: string, note: string): Promise<void> {
    const head = await this.head(this.prisma.client, orderId);
    if (head === null) return;
    const everDelivered =
      (await this.prisma.client.orderEvent.count({
        where: { orderId, toStatus: OrderStatus.DELIVERED },
      })) > 0;
    await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, head.sellerId);
      const rows = await tx.resellerOrderCredit.findMany({ where: { orderId } });
      if (head.paymentMode === PaymentMode.PREPAID) {
        await this.skipPending(tx, rows, 'RETURNED');
        await this.reverseCreditedWithTake(tx, head, rows, note);
        await this.refundPrepaidDebit(tx, head, note);
        return;
      }
      if (everDelivered) return;
      await this.skipPending(tx, rows, 'RETURNED_UNDELIVERED');
      const paid = (await tx.courierSettlementLine.count({ where: { orderId } })) > 0;
      if (!paid) await this.reverseCreditedWithTake(tx, head, rows, note);
    }, RESELLER_MONEY_TX_OPTIONS);
    await this.afterCommit(head.sellerId, 'reseller-order-returned');
  }

  /**
   * A courier payout line for a reseller order — INSIDE the settlement's
   * transaction, which already holds the seller's WALLET lock and has
   * booked the whole line's cash as capital's. ON_PAYOUT credits arm
   * (due at once, or N days on); a delivery-anchored credit that was
   * withheld for want of proof of carriage arms too (the payout is the
   * proof); a credit a courier reversal took back is re-armed (the courier
   * paid after all). Whatever is due now is written here, fronted in the
   * account the payout landed in.
   */
  async onPayoutLine(
    tx: Tx,
    input: { orderId: string; accountId: string; at: Date },
  ): Promise<void> {
    const head = await this.head(tx, input.orderId);
    if (head === null) return;
    await this.lock(tx, head.sellerId);
    const rows = await this.ensurePlan(tx, input.orderId);
    for (const row of rows) {
      const anchor = anchorOf(row.trigger, head.paymentMode);
      if (row.status === ResellerCreditStatus.WAITING && anchor !== 'CONFIRMATION') {
        await tx.resellerOrderCredit.updateMany({
          where: { id: row.id, status: ResellerCreditStatus.WAITING },
          data: {
            status: ResellerCreditStatus.DUE,
            dueAt: anchor === 'PAYOUT' ? dueAt(input.at, row.days) : input.at,
          },
        });
      } else if (
        row.status === ResellerCreditStatus.REVERSED ||
        (row.status === ResellerCreditStatus.SKIPPED &&
          row.skippedReason !== null &&
          REARM_ON_PAYOUT_REASONS.has(row.skippedReason))
      ) {
        // Reversed or skipped by the courier's own reversal (or for want of
        // its payment), and now the courier pays: credited again — the
        // channel's "a COD reversed by mistake and paid again is credited
        // again" (WAL-6).
        await tx.resellerOrderCredit.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: ResellerCreditStatus.DUE, dueAt: input.at, skippedReason: null },
        });
      }
    }
    const due = await tx.resellerOrderCredit.findMany({
      where: {
        orderId: input.orderId,
        status: ResellerCreditStatus.DUE,
        dueAt: { lte: input.at },
      },
      select: { id: true },
    });
    for (const d of due) await this.executeRow(tx, d.id, input.at, input.accountId);
  }

  /**
   * The courier REVERSED a reseller order's COD on a payout (the parcel
   * came back after it had paid). Inside the settlement's transaction:
   * every written credit is taken back per party, anything still pending
   * is skipped. Returns the group's cash to move to capital — the caller
   * does it once, as it does for a channel order's reversal.
   */
  async reverseOnCourierReversal(
    tx: Tx,
    input: { orderId: string; note: string },
  ): Promise<CourierReversalOutcome> {
    const head = await this.head(tx, input.orderId);
    if (head === null) return { outcome: 'NEVER_CREDITED', grossInr: ZERO, take: ZERO };
    await this.lock(tx, head.sellerId);
    const rows = await tx.resellerOrderCredit.findMany({ where: { orderId: input.orderId } });
    const credited = rows.filter((r) => r.status === ResellerCreditStatus.CREDITED);
    await this.skipPending(tx, rows, 'COURIER_REVERSED');
    if (credited.length === 0) {
      return {
        outcome: rows.some((r) => r.status === ResellerCreditStatus.REVERSED)
          ? 'ALREADY_REVERSED'
          : 'NEVER_CREDITED',
        grossInr: ZERO,
        take: ZERO,
      };
    }
    let gross = ZERO;
    let take = ZERO;
    for (const row of credited) {
      const r = await this.reverseRow(tx, head, row, input.note);
      gross = gross.add(r.gross);
      take = take.add(r.take);
    }
    return { outcome: 'REVERSED', grossInr: gross, take };
  }

  // ── Credits ────────────────────────────────────────────────────────

  /** Every due credit, oldest first, each in its own transaction (per-row isolation). */
  async sweepDue(
    now: Date = new Date(),
  ): Promise<{ scanned: number; credited: number; skipped: number; failed: number }> {
    const due = await this.prisma.client.resellerOrderCredit.findMany({
      where: { status: ResellerCreditStatus.DUE, dueAt: { lte: now } },
      orderBy: { dueAt: 'asc' },
      take: 200,
      select: { id: true, sellerId: true },
    });
    let credited = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of due) {
      try {
        const outcome = await this.prisma.client.$transaction(async (tx) => {
          await this.lock(tx, row.sellerId);
          return this.executeRow(tx, row.id, now, null);
        }, RESELLER_MONEY_TX_OPTIONS);
        if (outcome === 'CREDITED') credited += 1;
        else if (outcome === 'SKIPPED') skipped += 1;
        await this.afterCommit(row.sellerId, 'reseller-credit');
      } catch (err) {
        failed += 1;
        this.logger.error(
          { creditId: row.id, err: err instanceof Error ? err.message : String(err) },
          'Reseller order credit failed — isolated, continuing the sweep',
        );
      }
    }
    return { scanned: due.length, credited, skipped, failed };
  }

  /** The order's due credits, now — after an event armed them. */
  private async executeDueForOrder(orderId: string, now: Date): Promise<void> {
    const due = await this.prisma.client.resellerOrderCredit.findMany({
      where: { orderId, status: ResellerCreditStatus.DUE, dueAt: { lte: now } },
      select: { id: true, sellerId: true },
    });
    for (const row of due) {
      await this.prisma.client.$transaction(async (tx) => {
        await this.lock(tx, row.sellerId);
        await this.executeRow(tx, row.id, now, null);
      }, RESELLER_MONEY_TX_OPTIONS);
      await this.afterCommit(row.sellerId, 'reseller-credit');
    }
  }

  /**
   * Write ONE due credit, if the order still earns it (WAL-8). The claim
   * (DUE → CREDITED, guarded on DUE) and the wallet entries are one
   * transaction under the WALLET lock the caller holds: a second runner
   * finds nothing to claim.
   */
  private async executeRow(
    tx: Tx,
    creditId: string,
    now: Date,
    accountId: string | null,
  ): Promise<'CREDITED' | 'SKIPPED' | 'NOT_DUE'> {
    const row = await tx.resellerOrderCredit.findUnique({ where: { id: creditId } });
    if (
      row === null ||
      row.status !== ResellerCreditStatus.DUE ||
      row.dueAt === null ||
      row.dueAt.getTime() > now.getTime()
    ) {
      return 'NOT_DUE';
    }
    const head = await this.head(tx, row.orderId);
    if (head === null) return 'NOT_DUE';
    const [delivered, paid] = await Promise.all([
      tx.orderEvent.count({ where: { orderId: row.orderId, toStatus: OrderStatus.DELIVERED } }),
      tx.courierSettlementLine.aggregate({
        where: { orderId: row.orderId },
        _sum: { settledInr: true },
      }),
    ]);
    let verdict = creditMayRun({
      anchor: anchorOf(row.trigger, head.paymentMode),
      status: head.status,
      everDelivered: delivered > 0,
      courierPaidInr: paid._sum.settledInr ?? ZERO,
    });
    // A prepaid order's seller is paid from what the STORE paid — never
    // from our money for a store that has not.
    if (
      verdict.run &&
      head.paymentMode === PaymentMode.PREPAID &&
      !(await this.prepaidDebited(tx, row.orderId))
    ) {
      verdict = { run: false, reason: 'PREPAID_NOT_PAID_BY_STORE' };
    }
    if (!verdict.run) {
      await tx.resellerOrderCredit.updateMany({
        where: { id: row.id, status: ResellerCreditStatus.DUE },
        data: { status: ResellerCreditStatus.SKIPPED, skippedReason: verdict.reason },
      });
      return 'SKIPPED';
    }
    const claimed = await tx.resellerOrderCredit.updateMany({
      where: { id: row.id, status: ResellerCreditStatus.DUE },
      data: {
        status: ResellerCreditStatus.CREDITED,
        creditedAt: now,
        timesCredited: { increment: 1 },
      },
    });
    if (claimed.count === 0) return 'NOT_DUE';
    await this.writeCredit(tx, head, row, accountId);
    return 'CREDITED';
  }

  private async writeCredit(
    tx: Tx,
    head: ResellerOrderHead,
    row: CreditRow,
    accountId: string | null,
  ): Promise<void> {
    const order = head.orderNumber;
    if (head.paymentMode !== PaymentMode.COD) {
      // Prepaid: the store's money, made ours by its PREPAID_DEBIT, becomes
      // the seller's (TO_SELLER in the F2 switch).
      if (row.grossInr.greaterThan(0)) {
        await this.wallet.applyEntry(tx, {
          sellerId: head.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.PREPAID_TRANSFER_CREDIT,
          amount: row.grossInr,
          linkedOrderId: head.id,
          actorType: ActorType.SYSTEM,
          note: `Prepaid reseller order ${order} — the goods at your transfer price`,
        });
      }
      return;
    }
    // COD — the party's own money is FRONTED out of capital BEFORE the
    // credit so its deductions find cash to make ours (the channel's
    // Instant Pay shape), less any part that repays what the group owes
    // (TRE-8). The store's own money is COD − transfer (the transfer is
    // the SELLER's, fronted on the seller's row); the seller's is the
    // transfer price.
    const own =
      row.party === ResellerMoneyParty.STORE ? row.grossInr.sub(row.transferInr) : row.grossInr;
    if (own.greaterThan(0)) {
      const split = await this.attribution.debtSplit(tx, head.sellerId, own);
      await this.attribution.front(tx, {
        sellerId: head.sellerId,
        amount: split.toSeller,
        accountId: accountId ?? (await this.payoutAccountFor(tx, head.id)),
        reference: head.id,
      });
    }
    if (row.party === ResellerMoneyParty.STORE) {
      const store = (
        direction: StoreWalletEntryDirection,
        amount: Prisma.Decimal,
        note: string,
        shareOf: WalletEntryDirection | null = null,
      ) =>
        amount.greaterThan(0)
          ? this.storeWallet.applyEntry(tx, {
              storeId: head.storeId,
              sellerId: head.sellerId,
              direction,
              amount,
              shareOf,
              linkedOrderId: head.id,
              actorType: ActorType.SYSTEM,
              note,
            })
          : Promise.resolve(null);
      // The store's gross order credit is the COD LESS the transfer price
      // (the reports read ORDER_CREDIT this way); each share follows as its
      // own entry. A store that sold below the transfer price owes the
      // difference instead, as a TRANSFER_PRICE debit.
      await store(
        StoreWalletEntryDirection.ORDER_CREDIT,
        own,
        `Order ${order} — COD ₹${row.grossInr.toFixed(2)} collected for you, less the seller’s transfer price ₹${row.transferInr.toFixed(2)}`,
      );
      await store(
        StoreWalletEntryDirection.TRANSFER_PRICE,
        own.negated(),
        `Order ${order} — sold below the seller’s transfer price: the difference`,
      );
      await store(
        StoreWalletEntryDirection.COD_TAX_SHARE,
        row.taxShareInr,
        `Order ${order} — your share of the tax taken from the COD`,
        WalletEntryDirection.GST_WITHHOLDING,
      );
      await store(
        StoreWalletEntryDirection.FEE_SHARE,
        row.codFeeShareInr,
        `Order ${order} — your share of the COD fee`,
        WalletEntryDirection.COD_COLLECTION_FEE,
      );
      await store(
        StoreWalletEntryDirection.FEE_SHARE,
        row.instantFeeShareInr,
        `Order ${order} — your share of the Instant Pay fee`,
        WalletEntryDirection.INSTANT_PAY_FEE,
      );
      return;
    }
    const seller = (direction: WalletEntryDirection, amount: Prisma.Decimal, note: string) =>
      amount.greaterThan(0)
        ? this.wallet.applyEntry(tx, {
            sellerId: head.sellerId,
            currency: Currency.INR,
            direction,
            amount,
            linkedOrderId: head.id,
            actorType: ActorType.SYSTEM,
            note,
          })
        : Promise.resolve(null);
    await seller(
      WalletEntryDirection.RESELLER_TRANSFER_CREDIT,
      row.grossInr,
      `Reseller order ${order} — the goods at your transfer price`,
    );
    await seller(
      WalletEntryDirection.GST_WITHHOLDING,
      row.taxShareInr,
      `Your share of the tax taken from reseller order ${order}'s COD`,
    );
    await seller(
      WalletEntryDirection.COD_COLLECTION_FEE,
      row.codFeeShareInr,
      `Your share of the COD fee on reseller order ${order}`,
    );
    await seller(
      WalletEntryDirection.INSTANT_PAY_FEE,
      row.instantFeeShareInr,
      `Your share of the Instant Pay fee on reseller order ${order}`,
    );
  }

  // ── Reversals ──────────────────────────────────────────────────────

  private async skipPending(tx: Tx, rows: readonly CreditRow[], reason: string): Promise<void> {
    for (const row of rows) {
      if (row.status !== ResellerCreditStatus.WAITING && row.status !== ResellerCreditStatus.DUE) {
        continue;
      }
      await tx.resellerOrderCredit.updateMany({
        where: {
          id: row.id,
          status: { in: [ResellerCreditStatus.WAITING, ResellerCreditStatus.DUE] },
        },
        data: { status: ResellerCreditStatus.SKIPPED, skippedReason: reason },
      });
    }
  }

  /** Reverse every written credit and move each one's cash to capital straight away. */
  private async reverseCreditedWithTake(
    tx: Tx,
    head: ResellerOrderHead,
    rows: readonly CreditRow[],
    note: string,
  ): Promise<void> {
    for (const row of rows) {
      if (row.status !== ResellerCreditStatus.CREDITED) continue;
      const r = await this.reverseRow(tx, head, row, note);
      if (r.take.greaterThan(0)) {
        // Referenced by the REVERSAL entry, never the order id: the front is
        // the ONLY pair referenced by an order id (WAL-9).
        await this.attribution.takeToCapital(tx, {
          sellerId: head.sellerId,
          amount: r.take,
          reference: r.reversalEntryId ?? head.id,
          note: `Reseller order ${head.orderNumber} credit taken back — ${note}`,
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: head.sellerId,
          action: 'reseller_order.credit_reversed',
          entityType: 'order',
          entityId: head.id,
          severity: 'MEDIUM',
          metadata: {
            party: row.party,
            storeId: head.storeId,
            grossInr: r.gross.toFixed(2),
            cashReturnedToCapitalInr: r.take.toFixed(2),
            note,
          },
        },
        tx,
      );
    }
  }

  /**
   * Take ONE written credit back. The reversal entry FIRST (its cash rule
   * is NONE), then the refunds of what it carried (TO_SELLER) — the order
   * `cashTakenOnReversal` assumes. Returns the group's cash to move to
   * capital (the caller moves it).
   */
  private async reverseRow(
    tx: Tx,
    head: ResellerOrderHead,
    row: CreditRow,
    note: string,
  ): Promise<{ gross: Prisma.Decimal; take: Prisma.Decimal; reversalEntryId: string | null }> {
    const claimed = await tx.resellerOrderCredit.updateMany({
      where: { id: row.id, status: ResellerCreditStatus.CREDITED },
      data: { status: ResellerCreditStatus.REVERSED, reversedAt: new Date() },
    });
    if (claimed.count === 0) return { gross: ZERO, take: ZERO, reversalEntryId: null };
    const order = head.orderNumber;

    if (head.paymentMode !== PaymentMode.COD) {
      const credit = await this.latestUnreversedSeller(
        tx,
        head.id,
        WalletEntryDirection.PREPAID_TRANSFER_CREDIT,
        WalletEntryDirection.PREPAID_TRANSFER_REVERSAL,
      );
      if (credit === null) return { gross: ZERO, take: ZERO, reversalEntryId: null };
      const e = await this.wallet.applyEntry(tx, {
        sellerId: head.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.PREPAID_TRANSFER_REVERSAL,
        amount: credit.amount,
        linkedOrderId: head.id,
        linkedEntryId: credit.id,
        actorType: ActorType.SYSTEM,
        note: `Prepaid reseller order ${order} — transfer price taken back: ${note}`,
      });
      // TO_CAPITAL in the F2 switch — its own cash, no take.
      return { gross: credit.amount, take: ZERO, reversalEntryId: e.id };
    }

    const before = await this.attribution.groupBalance(tx, head.sellerId);
    if (row.party === ResellerMoneyParty.STORE) {
      const credit = await this.latestUnreturnedStore(
        tx,
        head.id,
        StoreWalletEntryDirection.ORDER_CREDIT,
        StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL,
        null,
      );
      let reversalId: string | null = null;
      if (credit !== null) {
        const e = await this.storeWallet.applyEntry(tx, {
          storeId: head.storeId,
          sellerId: head.sellerId,
          direction: StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL,
          amount: credit.amount,
          linkedOrderId: head.id,
          linkedEntryId: credit.id,
          actorType: ActorType.SYSTEM,
          note: `Order ${order} — COD credit taken back: ${note}`,
        });
        reversalId = e.id;
      }
      const transfer = await this.latestUnreturnedStore(
        tx,
        head.id,
        StoreWalletEntryDirection.TRANSFER_PRICE,
        StoreWalletEntryDirection.TRANSFER_PRICE_REFUND,
        null,
      );
      if (transfer !== null) {
        await this.storeWallet.applyEntry(tx, {
          storeId: head.storeId,
          sellerId: head.sellerId,
          direction: StoreWalletEntryDirection.TRANSFER_PRICE_REFUND,
          amount: transfer.amount,
          linkedOrderId: head.id,
          linkedEntryId: transfer.id,
          actorType: ActorType.SYSTEM,
          note: `Order ${order} — transfer price given back`,
        });
      }
      // Its shares of the COD tax and COD fees — never its delivery or
      // return fee shares, which belong to the carriage, not the COD.
      const shares = await tx.storeWalletEntry.findMany({
        where: {
          linkedOrderId: head.id,
          OR: [
            { direction: StoreWalletEntryDirection.COD_TAX_SHARE },
            {
              direction: StoreWalletEntryDirection.FEE_SHARE,
              shareOf: { in: [...COD_FEE_SHARE_OF] },
            },
          ],
        },
        select: { id: true, amount: true, direction: true, shareOf: true },
      });
      const returned = new Set(
        (
          await tx.storeWalletEntry.findMany({
            where: { linkedOrderId: head.id, direction: StoreWalletEntryDirection.SHARE_REFUND },
            select: { linkedEntryId: true },
          })
        ).map((r) => r.linkedEntryId),
      );
      for (const s of shares) {
        if (returned.has(s.id)) continue;
        await this.storeWallet.applyEntry(tx, {
          storeId: head.storeId,
          sellerId: head.sellerId,
          direction: StoreWalletEntryDirection.SHARE_REFUND,
          shareOf:
            s.direction === StoreWalletEntryDirection.COD_TAX_SHARE
              ? WalletEntryDirection.GST_WITHHOLDING
              : s.shareOf,
          amount: s.amount,
          linkedOrderId: head.id,
          linkedEntryId: s.id,
          actorType: ActorType.SYSTEM,
          note: `Order ${order} — share returned on a reversed COD`,
        });
      }
      const gross = credit?.amount ?? ZERO;
      return { gross, take: cashTakenOnReversal(before, gross), reversalEntryId: reversalId };
    }

    // SELLER, COD.
    const credit = await this.latestUnreversedSeller(
      tx,
      head.id,
      WalletEntryDirection.RESELLER_TRANSFER_CREDIT,
      WalletEntryDirection.RESELLER_TRANSFER_REVERSAL,
    );
    let reversalId: string | null = null;
    if (credit !== null) {
      const e = await this.wallet.applyEntry(tx, {
        sellerId: head.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.RESELLER_TRANSFER_REVERSAL,
        amount: credit.amount,
        linkedOrderId: head.id,
        linkedEntryId: credit.id,
        actorType: ActorType.SYSTEM,
        note: `Reseller order ${order} — transfer price taken back: ${note}`,
      });
      reversalId = e.id;
    }
    const deductions = await tx.sellerWalletEntry.findMany({
      where: { linkedOrderId: head.id, direction: { in: [...COD_DEDUCTION_DIRECTIONS] } },
      select: { id: true, amount: true, direction: true },
    });
    const refunded = new Set(
      (
        await tx.sellerWalletEntry.findMany({
          where: {
            linkedOrderId: head.id,
            direction: WalletEntryDirection.COD_DEDUCTION_REFUND,
          },
          select: { linkedEntryId: true },
        })
      ).map((r) => r.linkedEntryId),
    );
    for (const d of deductions) {
      if (d.amount.lessThanOrEqualTo(0) || refunded.has(d.id)) continue;
      await this.wallet.applyEntry(tx, {
        sellerId: head.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.COD_DEDUCTION_REFUND,
        amount: d.amount,
        linkedOrderId: head.id,
        linkedEntryId: d.id,
        actorType: ActorType.SYSTEM,
        note: `Returned: ${d.direction.toLowerCase().replace(/_/g, ' ')} on a reversed reseller COD`,
      });
    }
    const gross = credit?.amount ?? ZERO;
    return { gross, take: cashTakenOnReversal(before, gross), reversalEntryId: reversalId };
  }

  /** The latest seller entry of `direction` on the order that no `reversal` points at. */
  private async latestUnreversedSeller(
    tx: Tx,
    orderId: string,
    direction: WalletEntryDirection,
    reversal: WalletEntryDirection,
  ): Promise<{ id: string; amount: Prisma.Decimal } | null> {
    const [entries, reversals] = await Promise.all([
      tx.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction },
        orderBy: { id: 'desc' },
        select: { id: true, amount: true },
      }),
      tx.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction: reversal },
        select: { linkedEntryId: true },
      }),
    ]);
    if (reversals.length >= entries.length) return null;
    const done = new Set(reversals.map((r) => r.linkedEntryId));
    return entries.find((e) => !done.has(e.id)) ?? null;
  }

  /** The latest store entry of `direction` (of `shareOf`) on the order that no `reversal` points at. */
  private async latestUnreturnedStore(
    tx: Tx,
    orderId: string,
    direction: StoreWalletEntryDirection,
    reversal: StoreWalletEntryDirection,
    shareOf: WalletEntryDirection | null,
  ): Promise<{ id: string; amount: Prisma.Decimal } | null> {
    const [entries, reversals] = await Promise.all([
      tx.storeWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction, ...(shareOf === null ? {} : { shareOf }) },
        orderBy: { id: 'desc' },
        select: { id: true, amount: true },
      }),
      tx.storeWalletEntry.findMany({
        where: {
          linkedOrderId: orderId,
          direction: reversal,
          ...(shareOf === null ? {} : { shareOf }),
        },
        select: { linkedEntryId: true },
      }),
    ]);
    if (reversals.length >= entries.length) return null;
    const done = new Set(reversals.map((r) => r.linkedEntryId));
    return entries.find((e) => !done.has(e.id)) ?? null;
  }

  // ── RS-7 — a dispute settled between the store and the seller ──────

  /**
   * Move `amount` between a store and its seller to settle a dispute —
   * a PAIR in the caller's transaction (the ticket's), no bank entry: one
   * pot (decision 7), exactly like a seller-managed top-up. The payer may
   * go negative (a store's negative balance is the seller's exposure,
   * TRE-8c); Skydrop referees, it does not lend.
   */
  async settleStoreDispute(
    tx: Tx,
    input: {
      storeId: string;
      sellerId: string;
      orderId: string | null;
      payer: ResellerMoneyParty;
      amount: Prisma.Decimal;
      ticketNumber: string;
      staffId: string | null;
    },
  ): Promise<{ sellerEntryId: string; storeEntryId: string }> {
    await this.lock(tx, input.sellerId);
    const storePays = input.payer === ResellerMoneyParty.STORE;
    const seller = await this.wallet.applyEntry(tx, {
      sellerId: input.sellerId,
      currency: Currency.INR,
      direction: storePays
        ? WalletEntryDirection.STORE_DISPUTE_IN
        : WalletEntryDirection.STORE_DISPUTE_OUT,
      amount: input.amount,
      linkedOrderId: input.orderId,
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      note: storePays
        ? `Dispute ${input.ticketNumber} settled — paid to you by the reseller store`
        : `Dispute ${input.ticketNumber} settled — paid by you to the reseller store`,
    });
    const store = await this.storeWallet.applyEntry(tx, {
      storeId: input.storeId,
      sellerId: input.sellerId,
      direction: storePays
        ? StoreWalletEntryDirection.DISPUTE_SETTLEMENT_OUT
        : StoreWalletEntryDirection.DISPUTE_SETTLEMENT_IN,
      amount: input.amount,
      linkedOrderId: input.orderId,
      linkedSellerEntryId: seller.id,
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      note: storePays
        ? `Dispute ${input.ticketNumber} settled — paid by you to the seller`
        : `Dispute ${input.ticketNumber} settled — paid to you by the seller`,
    });
    return { sellerEntryId: seller.id, storeEntryId: store.id };
  }

  /**
   * RS-7 — the most a seller may be compensated on a reseller order for
   * goods lost or damaged in our hands: the TRANSFER price (never the
   * retail the store charged), for the ticket's line when it names one,
   * else for the whole order. Null for a channel order (no cap).
   */
  async transferCompensationCap(
    db: Db,
    input: { orderId: string | null; shipmentItemId: string | null },
  ): Promise<Prisma.Decimal | null> {
    if (input.orderId === null) return null;
    const snap = await readResellerOrderSnapshot(db, input.orderId);
    if (snap === null) return null;
    if (input.shipmentItemId !== null) {
      const item = await db.shipmentItem.findUnique({
        where: { id: input.shipmentItemId },
        select: { orderItemId: true, quantity: true },
      });
      const line = snap.lines.find((l) => l.orderItemId === item?.orderItemId);
      if (item !== null && line !== undefined) {
        return line.transferPriceInr.mul(item.quantity);
      }
    }
    return snap.transferTotalInr;
  }

  // ── helpers ────────────────────────────────────────────────────────

  /** A prepaid order's price includes its delivery share, so its charges must exist first. */
  private async ensureCharges(orderId: string): Promise<void> {
    try {
      await this.orderCharges.persistForOrderSystem(orderId);
    } catch (err) {
      this.logger.warn(
        { orderId, err: err instanceof Error ? err.message : String(err) },
        'Could not compute charges before a prepaid reseller order was charged; its delivery share waits for billing',
      );
    }
  }

  /** The rupee account the courier carrying this order pays into — AccrualExecutionService's rule. */
  private async payoutAccountFor(tx: Tx, orderId: string): Promise<string | null> {
    const shipment = await tx.shipment.findFirst({
      where: {
        orderShipments: { some: { orderId } },
        awbNumber: { not: null },
        supersededAt: null,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        courierAccount: {
          select: {
            payoutBankAccount: {
              select: { id: true, currency: true, isActive: true, deletedAt: true },
            },
          },
        },
      },
    });
    const a = shipment?.courierAccount?.payoutBankAccount ?? null;
    return a !== null && a.currency === Currency.INR && a.isActive && a.deletedAt === null
      ? a.id
      : null;
  }

  private async afterCommit(sellerId: string, reason: string): Promise<void> {
    await this.wallet.recomputeCacheAfterCommit(sellerId, Currency.INR, reason);
  }
}
