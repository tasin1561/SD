import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { OrderChargesModule } from '../order-charges/order-charges.module';
import { PricingModule } from '../pricing/pricing.module';
import { ResellerStoreWalletModule } from '../reseller-store-wallet/reseller-store-wallet.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { ResellerMoneyQueue } from './queue/reseller-money.queue';
import { ResellerMoneyWorker } from './queue/reseller-money.worker';
import { ResellerOrderMoneyListener } from './services/reseller-order-money.listener';
import { ResellerOrderMoneyService } from './services/reseller-order-money.service';

/**
 * RS-6 phase 3c — the MONEY of reseller store orders (docs/reseller-stores.md
 * "Order money as built").
 *
 * Sits UNDER seller-wallet-accrual, courier-settlement, order-core and ticket
 * — the channel's money services branch into `ResellerOrderMoneyService` for
 * a reseller order — so it imports none of them: only the wallet writers
 * (seller and store), the bank-book attribution, settings, pricing, the order
 * charges and the lifecycle bus. Its snapshot read is the plain function
 * `readResellerOrderSnapshot`, never the order module's service (R3).
 *
 * EXPORTS `ResellerOrderMoneyService` only.
 */
@Module({
  imports: [
    AuthCommonModule,
    LifecycleEventsModule,
    OrderChargesModule,
    PricingModule,
    ResellerStoreWalletModule,
    SellerWalletModule,
    SettingsModule,
    SystemIssuesModule,
    TreasuryModule,
  ],
  providers: [
    ResellerOrderMoneyService,
    ResellerOrderMoneyListener,
    ResellerMoneyQueue,
    ResellerMoneyWorker,
  ],
  exports: [ResellerOrderMoneyService],
})
export class ResellerOrderMoneyModule {}
