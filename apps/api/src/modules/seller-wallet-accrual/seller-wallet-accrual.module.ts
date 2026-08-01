import { Module } from '@nestjs/common';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { PendingAccrualQueue } from './queue/pending-accrual.queue';
import { PendingAccrualWorker } from './queue/pending-accrual.worker';
import { AccrualExecutionService } from './services/accrual-execution.service';
import { CourierFeeAccrualService } from './services/courier-fee-accrual.service';
import { OrderChargesAccrualService } from './services/order-charges-accrual.service';
import { RtoFeeAccrualService } from './services/rto-fee-accrual.service';
import { OrderDeliveredAccrualListener } from './services/order-delivered-accrual-listener.service';
import { PendingAccrualSchedulerService } from './services/pending-accrual-scheduler.service';
import { PendingAccrualSweepService } from './services/pending-accrual-sweep.service';
import { PricingModule } from '../pricing/pricing.module';
import { InboundFreightModule } from '../inbound-freight/inbound-freight.module';

/**
 * Phase 1B M22 — COD accrual on DELIVERED.
 *   - imports LifecycleEventsModule (to subscribe to the bus)
 *   - imports SellerWalletModule (to call WalletService.applyEntry)
 *   - exports `OrderChargesAccrualService` (R1c) — the shared
 *     ORDER_CHARGES debit, so `courier-awb`'s AT_AWB early-accrual
 *     path (a separate, standalone tx at AWB-generation time) can
 *     reuse the exact same idempotent debit logic the DELIVERED
 *     listener uses, rather than duplicating it
 *
 * Listener # 3 on the OrderLifecycleEventBus after:
 *   - NotificationListener (M11)
 *   - OutboundWebhookListener (M24-prev)
 *
 * R2b added the T_PLUS_N wallet-timing tier: `AccrualExecutionService`
 * is the extracted COD-credit+charges-debit execution (called either
 * immediately by the listener for INSTANT-tier sellers, or later by
 * `PendingAccrualSweepService` for T_PLUS_N-tier sellers via the
 * hourly `PendingAccrualQueue`/`PendingAccrualWorker` cron — same
 * in-process BullMQ pattern as `inventory-stock`'s reservation
 * auto-release cron). RedisService is global.
 *
 * Following modules in this batch:
 *   - M23 RemittanceService — DEBITs the wallet when an admin records a payout
 *   - M24 SellerWalletController — exposes balance + ledger to /seller/wallet
 */
@Module({
  imports: [
    LifecycleEventsModule,
    SellerWalletModule,
    SettingsModule,
    // R3 amortisation: the DELIVERED accrual also charges the delivered
    // units' share of the inbound freight bill.
    InboundFreightModule,
    // The return fee is resolved per seller through the pricing engine
    // (global default, seller override wins).
    PricingModule,
  ],
  providers: [
    OrderDeliveredAccrualListener,
    OrderChargesAccrualService,
    RtoFeeAccrualService,
    CourierFeeAccrualService,
    AccrualExecutionService,
    PendingAccrualSchedulerService,
    PendingAccrualSweepService,
    PendingAccrualQueue,
    PendingAccrualWorker,
  ],
  exports: [OrderChargesAccrualService, CourierFeeAccrualService, RtoFeeAccrualService],
})
export class SellerWalletAccrualModule {}
