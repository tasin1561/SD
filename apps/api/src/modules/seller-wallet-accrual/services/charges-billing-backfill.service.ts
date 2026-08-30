import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';

/** Orders whose journey is over and whose carriage was therefore owed. */
const BILLABLE_TERMINALS: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.RTO_RESTOCKED,
];

export interface BillingBackfillReport {
  readonly examined: number;
  readonly billed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly totalInr: string;
  readonly orders: ReadonlyArray<{
    readonly orderNumber: string;
    readonly status: string;
    readonly outcome: string;
  }>;
}

/**
 * Take the money for orders that finished their journey unbilled.
 *
 * ── WHY THIS IS NOT PART OF THE ROW BACKFILL ─────────────────────────
 * Writing a charge row records what an order COST. This takes it out of
 * a seller's wallet. They are one keystroke apart and a world apart in
 * consequence, so they are separate operations with separate triggers —
 * an operator correcting missing data must not discover they have also
 * debited fifteen sellers.
 *
 * ── WHY ONLY TERMINAL ORDERS ─────────────────────────────────────────
 * The carriage is owed when the parcel's journey ends: delivered, or
 * returned and received. Billing an in-transit order would charge for a
 * service still in progress and would double-charge when it lands,
 * because the delivery accrual will run then anyway.
 *
 * Idempotent by the same gate the live path uses — a prior
 * ORDER_CHARGES wallet entry — so a second run bills nobody twice.
 */
@Injectable()
export class ChargesBillingBackfillService {
  private readonly logger = new Logger(ChargesBillingBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly charges: OrderChargesService,
    private readonly accrual: OrderChargesAccrualService,
  ) {}

  async run(opts: { dryRun: boolean; limit: number }): Promise<BillingBackfillReport> {
    const candidates = await this.prisma.client.order.findMany({
      where: {
        deletedAt: null,
        status: { in: [...BILLABLE_TERMINALS] },
        // Never billed. The same gate debitIfNeeded uses, applied here
        // as a filter so the report counts only real work.
        walletEntries: { none: { direction: WalletEntryDirection.ORDER_CHARGES } },
        // ── NOT-YET-DUE IS NOT UNBILLED ──────────────────────────────
        // On the default T_PLUS_N tier a delivered order's charges are
        // taken `wallet.accrual_delay_days` later, and until then it
        // carries an unprocessed `pending_accruals` row. It is not
        // missed money; it is money with a date on it.
        //
        // Without this, the backfill takes every delivered order's
        // charges the moment it is run, and nothing looks wrong: the
        // amounts are right, the sum is owed, and the scheduled sweep
        // then skips the order on the idempotency gate. The only thing
        // that happened is that the accrual tier the business chose was
        // quietly overridden for every seller at once — which is
        // exactly the kind of change nobody would find later.
        //
        // A row that has already been processed does NOT exclude the
        // order: that is the genuine miss this backfill exists for.
        OR: [{ pendingAccrual: { is: null } }, { pendingAccrual: { processedAt: { not: null } } }],
      },
      select: { id: true, orderNumber: true, status: true, sellerId: true },
      orderBy: { createdAt: 'asc' },
      take: opts.limit,
    });

    const report = {
      examined: candidates.length,
      billed: 0,
      skipped: 0,
      failed: 0,
      totalInr: '0.00',
      orders: [] as Array<{ orderNumber: string; status: string; outcome: string }>,
    };
    let total = 0;

    for (const o of candidates) {
      if (opts.dryRun) {
        report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: 'WOULD_BILL' });
        continue;
      }
      try {
        // Charges first — an order with no rows sums to zero and would
        // be "billed" nothing while reporting success. PRE-TX, because
        // this owns its own transaction (the M5 saga rule).
        await this.charges.persistForOrderSystem(o.id);

        const debited = await this.prisma.client.$transaction((tx) =>
          this.accrual.debitIfNeeded(tx, o.id, o.sellerId),
        );

        if (debited) {
          report.billed += 1;
          report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: 'BILLED' });
        } else {
          // Already billed, or genuinely nothing to charge. Not an
          // error, and worth telling apart from one.
          report.skipped += 1;
          report.orders.push({
            orderNumber: o.orderNumber,
            status: o.status,
            outcome: 'NOTHING_TO_BILL',
          });
        }
      } catch (err) {
        // One seller's failure must not abandon the rest.
        report.failed += 1;
        const msg = err instanceof Error ? err.message : 'FAILED';
        report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: msg });
        this.logger.warn({ orderId: o.id, err: msg }, 'Retro-bill failed for one order');
      }
    }

    // Read back what actually moved rather than trusting the loop: the
    // debit is the wallet's number, not ours.
    if (!opts.dryRun && report.billed > 0) {
      const moved = await this.prisma.client.sellerWalletEntry.aggregate({
        where: {
          direction: WalletEntryDirection.ORDER_CHARGES,
          linkedOrderId: { in: candidates.map((c) => c.id) },
        },
        _sum: { amount: true },
      });
      total = Number(moved._sum?.amount ?? 0);
    }
    report.totalInr = total.toFixed(2);
    return report;
  }
}
