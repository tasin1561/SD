import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { StoreRequestExpiryQueue } from './queue/store-request-expiry.queue';
import { StoreRequestExpiryWorker } from './queue/store-request-expiry.worker';
import { StoreOrderRequestService } from './services/store-order-request.service';
import { StoreRequestExpiryService } from './services/store-request-expiry.service';
import { StoreRequestNotifier } from './services/store-request-notifier.service';

/**
 * 2026-09-17 — a reseller store's HELD requests: the record, the notices,
 * and the reminder/expiry sweep over every held queue.
 *
 * An R3 PRIMITIVE. It imports nothing order-, ticket-, review- or
 * courier-shaped, so the modules that route a store's ask (reseller-order
 * for cancel, early-reservation-decision for the call cap, ticket for an
 * issue) import it to HOLD a request, and the leaf
 * `store-order-request-decision` imports them all to CARRY ONE OUT —
 * with no cycle anywhere.
 */
@Module({
  imports: [AuthCommonModule, NotificationAudienceModule, NotificationLedgerModule],
  providers: [
    StoreOrderRequestService,
    StoreRequestNotifier,
    StoreRequestExpiryService,
    StoreRequestExpiryQueue,
    StoreRequestExpiryWorker,
  ],
  exports: [StoreOrderRequestService, StoreRequestNotifier],
})
export class StoreOrderRequestModule {}
