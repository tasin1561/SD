import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { AccrualExecutionService } from './accrual-execution.service';
import { PendingAccrualSchedulerService } from './pending-accrual-scheduler.service';

const ACCRUAL_TIMING_TIER_KEY = 'wallet.accrual_timing_tier';
const T_PLUS_N = 'T_PLUS_N';

export type DeliveredAccrualOutcome = 'EXECUTED' | 'SCHEDULED' | 'ORDER_NOT_FOUND';

/**
 * The money an order owes — and is owed — because it was DELIVERED, in
 * ONE place: the ORDER_CHARGES debit, the Instant Pay COD credit, and the
 * delivered units' share of the inbound freight bill (all three inside
 * `AccrualExecutionService`), dispatched on the seller's accrual tier.
 *
 * ── WHY THIS IS A SERVICE AND NOT ONLY A BUS LISTENER ────────────────
 * Every one of those effects used to hang off `OrderDeliveredAccrualListener`,
 * a subscriber on the lifecycle bus. The bus is emitted by
 * `OrderWriteService.transitionStatus` and by NOTHING else — which is right
 * for notifications, webhooks and invoices, and wrong for money. God mode
 * (`OrderAdminOverrideService.forceMutate`, ORD-2) writes `orders.status`
 * directly and deliberately emits no lifecycle event, so an order an
 * operator forced to DELIVERED was never billed: SD-TEST-SR-9711128000
 * was forced `dispatched → delivered` on 2026-09-11 and its ₹200 charge
 * landed seven hours later, only because the charges-billing backfill
 * happened to be run. A path that reaches DELIVERED without the money is
 * a parcel carried for free, and nothing fails to say so.
 *
 * So the dispatch lives here, exported, and BOTH writers of DELIVERED call
 * it: the bus listener for every matrix transition, and god mode directly,
 * post-commit. `delivered-money-paths.spec.ts` pins that the set of
 * `orders.status` writers is exactly those, so a third one fails the build
 * until somebody decides what it owes.
 *
 * Idempotent by the gates it already had, each read inside the accrual's
 * transaction under the WALLET advisory lock (WAL-7): a prior
 * ORDER_CHARGES / INBOUND_FREIGHT entry, `CodCreditService.isCredited`,
 * and the one-row-per-order `pending_accruals` on T_PLUS_N. Calling it
 * twice for one order — a god-mode move onto an order the listener
 * already handled, or a re-run — charges nothing twice.
 *
 * LOST_IN_TRANSIT is deliberately NOT a trigger: a lost parcel is not
 * charged (the founder, 2026-09-12 — TRE-6), and its courier cost stays
 * on the P&L's delivery line with no revenue.
 */
@Injectable()
export class DeliveredAccrualService {
  private readonly logger = new Logger(DeliveredAccrualService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly execution: AccrualExecutionService,
    private readonly scheduler: PendingAccrualSchedulerService,
  ) {}

  async accrueForDelivered(orderId: string): Promise<DeliveredAccrualOutcome> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { id: true, sellerId: true },
    });
    if (!order) {
      this.logger.warn({ orderId }, 'Delivered order vanished before its accrual; skipping');
      return 'ORDER_NOT_FOUND';
    }

    const tier = await this.settings.resolve(order.sellerId, ACCRUAL_TIMING_TIER_KEY);
    if (tier.value === T_PLUS_N) {
      await this.scheduler.scheduleIfNeeded(order.id, order.sellerId);
      return 'SCHEDULED';
    }

    // INSTANT — execute immediately. A per-seller choice: crediting at
    // DELIVERED means Skydrop fronts the money until the courier settles.
    await this.execution.executeAccrual(order.id);
    return 'EXECUTED';
  }
}
