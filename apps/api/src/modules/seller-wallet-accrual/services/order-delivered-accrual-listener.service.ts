import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  OrderStatus,
  PaymentMode,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';

/**
 * Phase 1B M22 — COD accrual on DELIVERED.
 *
 * The bus listener that translates a `(to === DELIVERED)` lifecycle
 * event into paired wallet entries:
 *   CREDIT codAmountInr (direction = COD_COLLECTION)
 *   DEBIT  sum(non-deleted, non-refund order charges) (direction = ORDER_CHARGES)
 *
 * Net effect: the seller's INR wallet gains (COD − charges) after
 * each delivered order. The Phase-1B remittance flow (M23) then
 * pays this out in BDT (with a paired REMITTANCE_OUT + REMITTANCE_FX).
 *
 * Discipline (mirrors M11 NotificationListener):
 *  - Subscribes on `OnApplicationBootstrap`; in-flight Promises
 *    tracked in a Set; `OnModuleDestroy` drains them so e2e teardown
 *    is deterministic.
 *  - Per-event `handle()` runs in its own try/catch wrapper. A
 *    failure NEVER reaches back to the OrderLifecycleEventBus
 *    emitter (NOTIF-1 best-effort discipline).
 *  - Paired entries written in ONE prisma.$transaction so the
 *    ledger never has a credit-without-debit (or vice versa).
 *  - Post-commit, balance cache for the affected currency is
 *    recomputed (best-effort, swallowed).
 *
 * Idempotency: a re-fired event for the same `statusEventId` is
 * possible (bus replay, future Redis-pubsub upgrade). The dedup
 * gate is the COD_COLLECTION entry's `linkedOrderId` — at most ONE
 * COD_COLLECTION row per order. The handler checks before writing.
 *
 * PREPAID orders DO NOT accrue COD. They have charges, but those
 * charges were collected at checkout (or netted off the prepaid
 * top-up — Phase 2). For Phase 1B PREPAID DELIVERED we write a
 * DEBIT-only entry so the seller still owes us the shipping cost.
 */
@Injectable()
export class OrderDeliveredAccrualListener
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderDeliveredAccrualListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly chargesAccrual: OrderChargesAccrualService,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.bus.subscribe((event) => {
      const p = this.handle(event)
        .catch((err) => {
          this.logger.error(
            {
              err: (err as Error).message,
              orderId: event.orderId,
              to: event.to,
            },
            'OrderDeliveredAccrualListener.handle threw; swallowed',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log(
      'OrderDeliveredAccrualListener subscribed to OrderLifecycleEventBus',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Test-harness drain seam. */
  async drainInFlight(): Promise<void> {
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Public — mirrors NotificationListener.handle: testable directly,
   *  doubles as a manual re-trigger. */
  async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.to !== OrderStatus.DELIVERED) return;

    // R1c: COD_COLLECTION and ORDER_CHARGES are gated INDEPENDENTLY,
    // not "either exists → skip both". A seller on the AT_AWB fee-
    // timing tier already has an ORDER_CHARGES entry by the time
    // DELIVERED fires (debited early by CourierFeeAccrualService) —
    // that must NOT suppress the COD credit, which can only ever be
    // known/collected at delivery regardless of fee-timing tier.
    const codAlready = await this.prisma.client.sellerWalletEntry.findFirst({
      where: { linkedOrderId: event.orderId, direction: WalletEntryDirection.COD_COLLECTION },
      select: { id: true },
    });

    const order = await this.prisma.client.order.findUnique({
      where: { id: event.orderId },
      select: { id: true, sellerId: true, paymentMode: true, codAmountInr: true },
    });
    if (!order) {
      this.logger.warn(
        { orderId: event.orderId },
        'Order vanished between lifecycle emit and accrual handler; skipping',
      );
      return;
    }

    // Same tx so the "normal" (nothing debited yet) case still pairs
    // credit + debit atomically, exactly as before this refactor.
    await this.prisma.client.$transaction(async (tx) => {
      if (!codAlready && order.paymentMode === PaymentMode.COD) {
        const codAmount = order.codAmountInr ?? new Prisma.Decimal(0);
        if (codAmount.gt(0)) {
          await this.wallet.applyEntry(tx, {
            sellerId: order.sellerId,
            currency: Currency.INR,
            direction: WalletEntryDirection.COD_COLLECTION,
            amount: codAmount,
            linkedOrderId: order.id,
            actorType: ActorType.SYSTEM,
          });
        }
      }

      await this.chargesAccrual.debitIfNeeded(tx, order.id, order.sellerId);
    });

    // Post-commit: recompute the INR balance cache. Best-effort.
    await this.wallet.recomputeCacheAfterCommit(
      order.sellerId,
      Currency.INR,
      'post-commit-accrual',
    );
  }
}
