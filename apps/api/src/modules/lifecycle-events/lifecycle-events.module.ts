import { Module } from '@nestjs/common';
import { OrderLifecycleEventBus } from './order-lifecycle-event-bus.service';

/**
 * Module 11 — the order lifecycle event PRIMITIVE module.
 *
 * The fourth successful R3 split — dependency-free shared primitive
 * that both publisher (the order module) and subscriber (the
 * notifications module) import without either depending on the other.
 * Removes the would-be `order ↔ notifications` cycle the same way
 * `call-queue` removed `order ↔ call-center` and `shipment-provision`
 * removed `order ↔ warehouse-pick/pack`.
 *
 * Export surface: `OrderLifecycleEventBus` only.
 *
 * No Prisma, no DI on Order, no DI on Notifications. The bus is an
 * in-process rxjs Subject — Phase-1A scale doesn't justify a Redis-
 * backed pub/sub yet, and in-process delivery matches the existing
 * post-commit-hook pattern (CC-6 / pack-eligible / shipment-provision
 * are all in-process service calls). When multi-instance API
 * deployment lands (Phase-2), the bus is the seam to swap for a
 * Redis pub/sub (BullMQ events or rxjs over Redis) — the publisher /
 * subscriber API stays the same.
 */
@Module({
  providers: [OrderLifecycleEventBus],
  exports: [OrderLifecycleEventBus],
})
export class LifecycleEventsModule {}
