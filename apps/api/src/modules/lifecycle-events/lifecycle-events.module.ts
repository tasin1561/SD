import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { OrderLifecycleEventBus } from './order-lifecycle-event-bus.service';

/**
 * Module 11 — the order lifecycle event PRIMITIVE module.
 *
 * The fourth successful R3 split — a shared primitive that both
 * publisher (the order module) and subscriber (notifications, courier
 * AWB, delivery actions) import without either depending on the other.
 * Removes the would-be `order ↔ notifications` cycle the same way
 * `call-queue` removed `order ↔ call-center`.
 *
 * Export surface: `OrderLifecycleEventBus` only.
 *
 * ── NO LONGER SINGLE-INSTANCE ────────────────────────────────────────
 * The bus was an in-process rxjs Subject, which meant a second API
 * instance would emit into its own void: the order would transition and
 * nothing downstream would ever hear about it. It now carries events
 * between instances over Redis, and the seam is exactly where this
 * comment always said it would be — the publisher / subscriber API did
 * not change.
 *
 * What did NOT change is the single-instance path. The instance that
 * runs listeners still delivers in-process, with no broker involved, so
 * the common deployment cannot lose an event to Redis being down. Only
 * an HTTP-only instance publishes, and only the listening instance
 * subscribes.
 *
 * It takes Redis and the worker-role gate as a result. That is a real
 * cost to a module whose dependency-free-ness was the point of the R3
 * split — but the alternative is a primitive that quietly stops working
 * the day somebody adds a second process, which is worse than an honest
 * dependency.
 */
@Module({
  imports: [RedisModule, ConfigModule],
  providers: [OrderLifecycleEventBus],
  exports: [OrderLifecycleEventBus],
})
export class LifecycleEventsModule {}
