import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { NotificationLedgerService } from '../notifications/services/notification-ledger.service';

/**
 * The store-then-send PRIMITIVE, on its own (R3 — the eighth split).
 *
 * ── WHY IT MOVED OUT OF NotificationsModule ──────────────────────────
 * `NotificationsModule` exports NOTHING on purpose (NOTIF-5): the order
 * module must stay unaware that notifications exist, and it does,
 * because the coupling runs through the lifecycle event bus instead.
 * That rule is about the LISTENER and the mapping — not about the
 * ledger, which is a general "write the row, then enqueue, and let the
 * composite unique decide" primitive.
 *
 * `seller-onboarding` needed exactly that primitive to close a
 * double-send race. The two wrong answers were exporting it from
 * NotificationsModule (which erodes NOTIF-5 by making the module
 * importable for one service, after which it is importable for any)
 * and copying store-then-send into the onboarding service (two
 * implementations of one dedup rule, and the copy nobody is looking at
 * is the one that drifts).
 *
 * So the primitive gets its own module, depending on neither consumer.
 * Same shape as `call-queue` (M7), `shipment-provision` (M8),
 * `lifecycle-events` (M11) and `courier-serviceability`.
 *
 * The service FILE deliberately stays where it is — moving it would
 * churn every import and every test path for no behavioural gain, and
 * the module boundary is what actually carries the rule.
 */
@Module({
  imports: [EmailModule],
  providers: [NotificationLedgerService],
  exports: [NotificationLedgerService],
})
export class NotificationLedgerModule {}
