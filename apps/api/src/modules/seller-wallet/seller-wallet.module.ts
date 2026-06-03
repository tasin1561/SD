import { Module } from '@nestjs/common';
import { WalletService } from './services/wallet.service';

/**
 * Phase 1B M21 — wallet primitive module.
 *
 * Exports `WalletService` as the SOLE WRITER of
 * seller_wallet_entries (W-2). Consumed by:
 *   - M22 OrderDeliveredWalletListener (COD accrual on DELIVERED)
 *   - M23 RemittanceService (admin payout)
 *   - M24 SellerWalletController (balance + ledger reads)
 *
 * No HTTP endpoint at this layer — that's M24's job.
 * No bus subscription — that's M22's job.
 *
 * R3 family: this is the FIFTH dependency-free shared primitive
 * after inventory-shared (M5) / call-queue (M7) /
 * shipment-provision (M8) / lifecycle-events (M11).
 */
@Module({
  providers: [WalletService],
  exports: [WalletService],
})
export class SellerWalletModule {}
