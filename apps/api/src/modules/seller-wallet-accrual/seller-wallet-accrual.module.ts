import { Module } from '@nestjs/common';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { CourierFeeAccrualService } from './services/courier-fee-accrual.service';
import { OrderChargesAccrualService } from './services/order-charges-accrual.service';
import { OrderDeliveredAccrualListener } from './services/order-delivered-accrual-listener.service';

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
 * Following modules in this batch:
 *   - M23 RemittanceService — DEBITs the wallet when an admin records a payout
 *   - M24 SellerWalletController — exposes balance + ledger to /seller/wallet
 */
@Module({
  imports: [LifecycleEventsModule, SellerWalletModule, SettingsModule],
  providers: [OrderDeliveredAccrualListener, OrderChargesAccrualService, CourierFeeAccrualService],
  exports: [OrderChargesAccrualService, CourierFeeAccrualService],
})
export class SellerWalletAccrualModule {}
