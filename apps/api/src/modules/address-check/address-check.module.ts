import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerAddressCheckController } from './controllers/seller-address-check.controller';
import { StoreAddressCheckController } from './controllers/store-address-check.controller';
import { AddressCheckService } from './services/address-check.service';
import { OrderPageV2GateService } from './services/order-page-v2-gate.service';
import { SolustationHttpService } from './services/solustation-http.service';
import { AddressCheckQueue } from './queue/address-check.queue';
import { AddressCheckWorker } from './queue/address-check.worker';
import { AddressCheckRetryService } from './services/address-check-retry.service';
import { AddressFeedbackService } from './services/address-feedback.service';
import { SystemIssuesModule } from '../system-issues/system-issues.module';

/**
 * Order page v2 — address checking against Solustation Address.
 *
 * Solustation is OUR OWN company's service and a SEPARATE PRODUCT. It
 * is reached only over its public HTTPS URL, with a Bearer key from
 * env: never by importing its code, reading its database, or touching
 * its files or services on the server — even though both run on the
 * same host today. The coupling is deliberately only the HTTP contract,
 * so either side can be deployed, moved or rewritten without the other
 * finding out.
 *
 * Nothing in here may block an order. Every call can fail and every
 * caller carries on: a check is advice about a delivery, and a delivery
 * that was going to be attempted is still attempted. `SOLADDR_API_KEY`
 * being empty is a supported state, not a misconfiguration — the page
 * says "Address check unavailable" and saving behaves exactly as it did
 * before any of this existed.
 *
 * The HTTP client is exported because the queue workers and the
 * per-console proxy controllers all need it and none of them should
 * reimplement base-URL resolution, auth or failure classification.
 */
@Module({
  imports: [AuthCommonModule, SystemIssuesModule],
  controllers: [SellerAddressCheckController, StoreAddressCheckController],
  providers: [
    SolustationHttpService,
    AddressCheckService,
    OrderPageV2GateService,
    // The background half: re-asking a check that could not be made,
    // and telling Solustation what the courier did. Neither has
    // anybody waiting on it, which is exactly why they are jobs.
    AddressCheckQueue,
    AddressCheckRetryService,
    AddressFeedbackService,
    AddressCheckWorker,
  ],
  exports: [SolustationHttpService, AddressCheckService, OrderPageV2GateService],
})
export class AddressCheckModule {}
