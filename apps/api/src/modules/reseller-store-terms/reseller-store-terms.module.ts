import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminCreditAfterConfirmationController } from './controllers/admin-credit-after-confirmation.controller';
import { AdminResellerStoreTermsController } from './controllers/admin-reseller-store-terms.controller';
import { SellerResellerStoreTermsController } from './controllers/seller-reseller-store-terms.controller';
import { StoreTermsController } from './controllers/store-terms.controller';
import { CreditAfterConfirmationService } from './services/credit-after-confirmation.service';
import { ResellerStoreTermsService } from './services/reseller-store-terms.service';
import { ResellerTermsNotifier } from './services/reseller-terms-notifier.service';

/**
 * RS-4 — reseller store terms: the fee split, both credit timings, versions
 * and acceptance, and the per-seller credit-after-confirmation switch.
 *
 * ── WHY ITS OWN MODULE, AND WHY IT EXPORTS ───────────────────────────
 * Phase 3b's store-order create must ask "has this store accepted the
 * terms in force, and which version am I snapshotting?" — so this module
 * EXPORTS `ResellerStoreTermsService` (the read surface: `currentTerms`,
 * `acceptedCurrentTerms`, `orderReadiness`), and the pure `splitFeeLines`
 * lives in `terms/fee-split.ts` for it to import.
 *
 * It imports nothing order-shaped (no `OrderModule`, unlike the phase-1
 * `ResellerStoreModule`), so the order module can import THIS one later
 * without a cycle — the R3 rule applied up front rather than discovered.
 */
@Module({
  imports: [AuthCommonModule, SettingsModule, NotificationAudienceModule, NotificationLedgerModule],
  controllers: [
    SellerResellerStoreTermsController,
    StoreTermsController,
    AdminResellerStoreTermsController,
    AdminCreditAfterConfirmationController,
  ],
  providers: [
    ResellerStoreTermsService,
    CreditAfterConfirmationService,
    ResellerTermsNotifier,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
  exports: [ResellerStoreTermsService],
})
export class ResellerStoreTermsModule {}
