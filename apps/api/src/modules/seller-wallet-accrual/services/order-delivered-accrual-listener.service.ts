import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ActorType,
  ChargeType,
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

  private async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.to !== OrderStatus.DELIVERED) return;

    // Idempotency gate: at most one COD_COLLECTION (or ORDER_CHARGES) per order.
    const already = await this.prisma.client.sellerWalletEntry.findFirst({
      where: {
        linkedOrderId: event.orderId,
        direction: {
          in: [
            WalletEntryDirection.COD_COLLECTION,
            WalletEntryDirection.ORDER_CHARGES,
          ],
        },
      },
      select: { id: true },
    });
    if (already) {
      return;
    }

    const order = await this.prisma.client.order.findUnique({
      where: { id: event.orderId },
      select: {
        id: true,
        sellerId: true,
        paymentMode: true,
        codAmountInr: true,
        charges: {
          where: { deletedAt: null },
          select: {
            type: true,
            amountInr: true,
          },
        },
      },
    });
    if (!order) {
      this.logger.warn(
        { orderId: event.orderId },
        'Order vanished between lifecycle emit and accrual handler; skipping',
      );
      return;
    }

    // Sum non-refund charges → DEBIT on the seller wallet.
    let chargesTotal = new Prisma.Decimal(0);
    for (const c of order.charges) {
      if (c.type === ChargeType.REFUND) continue;
      chargesTotal = chargesTotal.add(c.amountInr);
    }

    // Paired write — both in one tx so the ledger never has a half-
    // delivered accrual.
    await this.prisma.client.$transaction(async (tx) => {
      let lastEntryId: string | null = null;

      if (order.paymentMode === PaymentMode.COD) {
        const codAmount =
          order.codAmountInr === null
            ? new Prisma.Decimal(0)
            : order.codAmountInr;
        if (codAmount.gt(0)) {
          const credit = await this.wallet.applyEntry(tx, {
            sellerId: order.sellerId,
            currency: Currency.INR,
            direction: WalletEntryDirection.COD_COLLECTION,
            amount: codAmount,
            linkedOrderId: order.id,
            actorType: ActorType.SYSTEM,
          });
          lastEntryId = credit.id;
        }
      }

      if (chargesTotal.gt(0)) {
        const debit = await this.wallet.applyEntry(tx, {
          sellerId: order.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.ORDER_CHARGES,
          amount: chargesTotal,
          linkedOrderId: order.id,
          actorType: ActorType.SYSTEM,
        });
        lastEntryId = debit.id;
      }

      return { lastEntryId };
    });

    // Post-commit: recompute the INR balance cache. Best-effort.
    await this.wallet.recomputeCacheAfterCommit(
      order.sellerId,
      Currency.INR,
      // We don't propagate the precise lastEntryId out of the tx
      // because recomputeCache only uses it as a denormalised hint;
      // we re-read the ledger anyway.
      'post-commit-accrual',
    );
  }
}
