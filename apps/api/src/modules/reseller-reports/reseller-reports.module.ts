import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { ResellerStoreModule } from '../reseller-store/reseller-store.module';
import { ResellerStoreWalletModule } from '../reseller-store-wallet/reseller-store-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AdminResellerAnalysisController } from './controllers/admin-reseller-analysis.controller';
import { SellerResellerReportsController } from './controllers/seller-reseller-reports.controller';
import { StoreExpenseController } from './controllers/store-expense.controller';
import { StoreReportsController } from './controllers/store-reports.controller';
import { ResellerReportsWorker } from './queue/reseller-reports.worker';
import { AdminResellerAnalysisService } from './services/admin-reseller-analysis.service';
import { ResellerAutoPauseService } from './services/reseller-auto-pause.service';
import { ResellerReportsNotifier } from './services/reseller-reports-notifier.service';
import { ResellerSweepsService } from './services/reseller-sweeps.service';
import { SellerResellerAnalysisService } from './services/seller-reseller-analysis.service';
import { StoreAnalysisService } from './services/store-analysis.service';
import { StoreExpenseService } from './services/store-expense.service';
import { StorePnlPeriodService } from './services/store-pnl-period.service';
import { StorePnlService } from './services/store-pnl.service';

/**
 * RS-8 / RS-9 — reseller reports and analysis (docs/reseller-stores.md
 * "Reports and analysis as built").
 *
 * A LEAF: nothing imports it and it exports nothing. Every report is
 * derived on read from append-only ledgers and the order snapshot; the
 * only rows it writes are the store's expenses, frozen store P&L months
 * and their carry-forwards, and the seller's auto-pause rule. Stock is
 * read through `StockReadService` (MUST #15), variants through
 * `CatalogReadService` (MUST #13), a store's status is changed only
 * through `ResellerStoreService`, and the store's wallet position through
 * `StoreWalletService`.
 */
@Module({
  imports: [
    AuthCommonModule,
    CatalogReadModule,
    InventoryStockModule,
    NotificationAudienceModule,
    ResellerStoreModule,
    ResellerStoreWalletModule,
    SettingsModule,
    TreasuryModule,
  ],
  controllers: [
    StoreReportsController,
    StoreExpenseController,
    SellerResellerReportsController,
    AdminResellerAnalysisController,
  ],
  providers: [
    StorePnlService,
    StorePnlPeriodService,
    StoreExpenseService,
    StoreAnalysisService,
    SellerResellerAnalysisService,
    AdminResellerAnalysisService,
    ResellerAutoPauseService,
    ResellerSweepsService,
    ResellerReportsNotifier,
    ResellerReportsWorker,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
})
export class ResellerReportsModule {}
