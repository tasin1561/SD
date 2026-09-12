import { Module } from '@nestjs/common';
// Charges are computed before the money is taken — an order reaching
// delivery with none is billed nothing, silently. No cycle: order-charges
// imports pricing and auth-common only.
import { OrderChargesModule } from '../order-charges/order-charges.module';
import { AdminChargesBillingController } from './controllers/admin-charges-billing.controller';
import { ChargesBillingBackfillService } from './services/charges-billing-backfill.service';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { PendingAccrualQueue } from './queue/pending-accrual.queue';
import { PendingAccrualWorker } from './queue/pending-accrual.worker';
import { AccrualExecutionService } from './services/accrual-execution.service';
import { DeliveredAccrualService } from './services/delivered-accrual.service';
import { CourierFeeAccrualService } from './services/courier-fee-accrual.service';
import { OrderChargesAccrualService } from './services/order-charges-accrual.service';
import { OrderChargesRefundService } from './services/order-charges-refund.service';
import { EndedOrderMoneyService } from './services/ended-order-money.service';
import { CodCreditService } from './services/cod-credit.service';
import { RtoFeeAccrualService } from './services/rto-fee-accrual.service';
import { OrderDeliveredAccrualListener } from './services/order-delivered-accrual-listener.service';
import { PendingAccrualSchedulerService } from './services/pending-accrual-scheduler.service';
import { PendingAccrualSweepService } from './services/pending-accrual-sweep.service';
import { PricingModule } from '../pricing/pricing.module';
import { InboundFreightModule } from '../inbound-freight/inbound-freight.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';
// Instant Pay fronts the COD from our money, as a bank-book pair. No
// cycle: treasury imports prisma and auth-common only.
import { TreasuryModule } from '../treasury/treasury.module';

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
 *   - M23 RemittanceService — DEBITs the wallet when an admin records a withdrawal
 *   - M24 SellerWalletController — exposes balance + ledger to /seller/wallet
 */
@Module({
  imports: [
    OrderChargesModule,
    LifecycleEventsModule,
    SellerWalletModule,
    SettingsModule,
    // R3 amortisation: the DELIVERED accrual also charges the delivered
    // units' share of the inbound freight bill.
    InboundFreightModule,
    // The return fee is resolved per seller through the pricing engine
    // (global default, seller override wins).
    PricingModule,
    // An order credited without being billed is revenue lost silently,
    // one order at a time — it now says so on the board (MONEY).
    SystemIssuesModule,
    TreasuryModule,
  ],
  controllers: [AdminChargesBillingController],
  providers: [
    ChargesBillingBackfillService,
    OrderDeliveredAccrualListener,
    OrderChargesAccrualService,
    OrderChargesRefundService,
    EndedOrderMoneyService,
    RtoFeeAccrualService,
    CodCreditService,
    CourierFeeAccrualService,
    AccrualExecutionService,
    DeliveredAccrualService,
    PendingAccrualSchedulerService,
    PendingAccrualSweepService,
    PendingAccrualQueue,
    PendingAccrualWorker,
  ],
  exports: [
    // DeliveredAccrualService is NOT exported any more: god mode emits
    // to the lifecycle bus like every other writer of DELIVERED, so the
    // listener in this module is the only caller (WAL-8, 2026-09-12).
    OrderChargesAccrualService,
    // Given back when an order is cancelled before it ships — consumed
    // by OrderWriteService's post-commit cancel hook and by god mode's
    // mirror of it (OrderAdminOverrideService).
    OrderChargesRefundService,
    // What else an order ENDING undelivered gives back: the deferred
    // accrual is retired, and an Instant Pay credit no courier paid for
    // is taken back — the shared post-commit hooks call it.
    EndedOrderMoneyService,
    CourierFeeAccrualService,
    RtoFeeAccrualService,
    CodCreditService,
  ],
})
export class SellerWalletAccrualModule {}
