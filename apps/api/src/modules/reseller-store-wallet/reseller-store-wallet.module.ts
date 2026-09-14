import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SellerWalletWithdrawalModule } from '../seller-wallet-withdrawal/seller-wallet-withdrawal.module';
import { SettingsModule } from '../settings/settings.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AdminStoreWalletController } from './controllers/admin-store-wallet.controller';
import { SellerStoreWalletController } from './controllers/seller-store-wallet.controller';
import { StoreWalletController } from './controllers/store-wallet.controller';
import { SellerManagedStoreWalletService } from './services/seller-managed-store-wallet.service';
import { StoreTopupService } from './services/store-topup.service';
import { StoreWalletService } from './services/store-wallet.service';
import { StoreWithdrawalService } from './services/store-withdrawal.service';

/**
 * RS-6 — reseller store wallets (docs/reseller-stores.md "Store wallet as
 * built"): the ledger primitive (`StoreWalletService`), the seller-managed
 * moves, and the Skydrop-managed top-up claims and withdrawals, with the
 * three faces onto them (the store's, the seller's and ours).
 *
 * EXPORTS `StoreWalletService` — the primitive phase 3b's store orders
 * post into (`applyEntry`, `storeCanSpend`). It imports the treasury and
 * the seller wallet but nothing store-shaped imports back into those, and
 * the combined-balance read lives in the dependency-free
 * `treasury/services/store-wallet-balances.ts`, so there is no cycle.
 */
@Module({
  imports: [
    AuthCommonModule,
    SellerWalletModule,
    SellerWalletWithdrawalModule,
    SettingsModule,
    TreasuryModule,
  ],
  controllers: [StoreWalletController, SellerStoreWalletController, AdminStoreWalletController],
  providers: [
    StoreWalletService,
    SellerManagedStoreWalletService,
    StoreTopupService,
    StoreWithdrawalService,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
  exports: [StoreWalletService],
})
export class ResellerStoreWalletModule {}
