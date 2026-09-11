import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { Injectable, Logger } from '@nestjs/common';
import { Currency, PaymentMode, Prisma, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';
import { CodCreditService } from './cod-credit.service';
import { InboundFreightAmortisationService } from '../../inbound-freight/services/inbound-freight-amortisation.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

/**
 * R2b (revised-plan roadmap) — the actual COD-credit + charges-debit
 * execution, extracted verbatim from `OrderDeliveredAccrualListener`'s
 * body (R1c shape) so it can be invoked from TWO different moments:
 * immediately on DELIVERED for INSTANT-tier sellers (an opt-in since
 * 2026-07-26;
 * unchanged behavior), or later by `PendingAccrualSweepService` for
 * T_PLUS_N-tier sellers. `WalletService.applyEntry` stays the sole
 * ledger writer either way — only the CALLER and its timing differ.
 *
 * Idempotent by construction (same gates as before the extraction): a
 * pre-existing COD_COLLECTION entry skips the credit; ORDER_CHARGES is
 * gated independently inside `OrderChargesAccrualService.debitIfNeeded`.
 * Safe to call more than once for the same order.
 */
@Injectable()
export class AccrualExecutionService {
  private readonly logger = new Logger(AccrualExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly chargesAccrual: OrderChargesAccrualService,
    private readonly freightAmortisation: InboundFreightAmortisationService,
    private readonly codCredit: CodCreditService,
    private readonly orderCharges: OrderChargesService,
    private readonly issues: SystemIssueService,
    private readonly attribution: SellerCashAttributionService,
  ) {}

  async executeAccrual(orderId: string): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { id: true, sellerId: true, paymentMode: true, codAmountInr: true },
    });
    if (!order) {
      this.logger.warn({ orderId }, 'Order vanished before accrual execution; skipping');
      return;
    }

    // ── CHARGES MUST EXIST BEFORE THE MONEY IS TAKEN ──────────────────
    // `debitIfNeeded` sums the order's charge rows and returns false on
    // a total of zero — so an order that reached delivery with NO
    // charges is billed nothing, silently. No error, no log: the parcel
    // ships, the customer is served, and the seller is never invoiced.
    //
    // `OrderService.create` computes them post-commit, but that only
    // covers orders born through the service. Anything inserted another
    // way — a data fix, an import, a seeding script, a future admin
    // tool — arrives here with none, and production already holds
    // fifteen such orders.
    //
    // PRE-TX because persistForOrderSystem owns its own transaction and
    // cannot be composed into this one (the M5 saga rule). Idempotent
    // and best-effort: it no-ops when charges already exist, and a
    // failure here must not stop the COD credit the seller is owed —
    // debitIfNeeded then finds nothing and does what it does today.
    try {
      await this.orderCharges.persistForOrderSystem(orderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { orderId, err: message },
        'Could not compute charges before accrual; the order may be delivered unbilled',
      );
      /*
        The comment above already knew the consequence — "the order may
        be delivered unbilled" — and said it only to a log file. The
        seller gets their COD credit either way, the parcel ships, the
        customer is served, and we never invoice for carrying it. That
        is revenue lost silently, one order at a time, and the count on
        this issue is how many.
      */
      // Wrapped, even though `raise` swallows its own failures: this
      // sits INSIDE a catch on a money path, and an alerter that throws
      // there turns a handled problem into an unhandled one — the exact
      // failure the surrounding try exists to prevent. A missing
      // dependency is the realistic way that happens, and it costs one
      // line to make it impossible.
      try {
        void this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: 'An order is being credited without being billed',
          detail:
            `Charges could not be computed before the accrual, so this order carries none: ` +
            `${message}\n\n` +
            'The seller is credited for the COD and never invoiced for the delivery. Check the ' +
            'count — one is a single bad order, and a climbing count means every order through ' +
            'this path is shipping unbilled. "Bill unbilled orders" on /wallets is the catch-up.',
          source: 'AccrualExecutionService',
          dedupeKey: 'accrual-charges-missing',
          metadata: { orderId, error: message },
        });
      } catch {
        // Nothing more to do — the log line above already said it.
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Read the already-credited guard INSIDE the transaction, matching
      // the two sibling services that do the same job
      // (OrderChargesAccrualService, InboundFreightAmortisationService).
      // Outside it, the check and the credit are separate operations and
      // two concurrent runs could each see "not yet credited" and each pay
      // the seller. Not reachable today — the sweep worker is concurrency
      // 1 and the INSTANT listener path is mutually exclusive with the
      // T+N one — but a guard whose correctness rests on there only ever
      // being one caller is a guard waiting to be wrong.
      // COD is credited HERE only for a seller on INSTANT_PAY — that is
      // what they pay the fee for. On SETTLEMENT (the default) delivery
      // is not the trigger: the money has not reached us yet, and the
      // credit waits for the courier's withdrawal. Crediting at delivery for
      // everyone is what made Skydrop front 5-10 days of every seller's
      // COD and absorb any short payment.
      if (order.paymentMode === PaymentMode.COD) {
        const mode = await this.codCredit.resolveMode(order.sellerId);
        if (mode === 'INSTANT_PAY') {
          const gross = order.codAmountInr ?? new Prisma.Decimal(0);
          // We pay this COD before the courier does, so the cash behind
          // the credit is OURS, fronted: held for the seller now (less any
          // part that repays what they owe — TRE-8), BEFORE the credit so
          // its tax and fee find it. When the courier's payout lands it is
          // capital's, repaying the front.
          await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${order.sellerId}|${Currency.INR}`);
          if (gross.greaterThan(0) && !(await this.codCredit.isCredited(tx, order.id))) {
            const split = await this.attribution.debtSplit(tx, order.sellerId, gross);
            await this.attribution.front(tx, {
              sellerId: order.sellerId,
              amount: split.toSeller,
              accountId: await this.payoutAccountFor(tx, order.id),
              reference: order.id,
            });
          }
          const result = await this.codCredit.creditForOrder(tx, {
            orderId: order.id,
            sellerId: order.sellerId,
            grossInr: gross,
            mode,
          });
          if (result.credited) {
            this.logger.log(
              {
                orderId: order.id,
                gross: result.grossInr,
                gst: result.gstWithheldInr,
                fee: result.instantFeeInr,
                net: result.netCreditedInr,
              },
              'Instant Pay COD credit',
            );
          }
        }
      }

      await this.chargesAccrual.debitIfNeeded(tx, order.id, order.sellerId);

      // R3 amortisation: the delivered units' share of the BD→India
      // inbound freight bill. Separate from ORDER_CHARGES (that is the
      // outbound India-domestic courier leg) and charged per unit, so the
      // rest of the consignment still owes. No-op for orders whose goods
      // came from a PAY_NOW consignment or from no billed consignment at
      // all.
      await this.freightAmortisation.debitForDeliveredOrder(tx, order.id, order.sellerId);
    });

    await this.wallet.recomputeCacheAfterCommit(
      order.sellerId,
      Currency.INR,
      'post-commit-accrual',
    );
  }

  /**
   * The rupee account the courier carrying this order pays its COD into —
   * where a front is held, so the payout later lands beside it. Null when
   * there is none usable; the attribution service then picks one.
   */
  private async payoutAccountFor(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<string | null> {
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
}
