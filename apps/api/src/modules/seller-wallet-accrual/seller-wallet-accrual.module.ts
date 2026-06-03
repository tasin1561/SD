import { Module } from '@nestjs/common';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { OrderDeliveredAccrualListener } from './services/order-delivered-accrual-listener.service';

/**
 * Phase 1B M22 — COD accrual on DELIVERED. Leaf consumer:
 *   - imports LifecycleEventsModule (to subscribe to the bus)
 *   - imports SellerWalletModule (to call WalletService.applyEntry)
 *   - exports nothing (the listener subscribes on bootstrap)
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
  imports: [LifecycleEventsModule, SellerWalletModule],
  providers: [OrderDeliveredAccrualListener],
})
export class SellerWalletAccrualModule {}
