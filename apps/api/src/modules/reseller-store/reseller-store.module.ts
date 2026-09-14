import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { OrderModule } from '../order/order.module';
import { AdminResellerStoreController } from './controllers/admin-reseller-store.controller';
import { SellerResellerStoreController } from './controllers/seller-reseller-store.controller';
import { StoreProfileController } from './controllers/store-profile.controller';
import { StoreTeamController } from './controllers/store-team.controller';
import { ResellerStoreNotifier } from './services/reseller-store-notifier.service';
import { ResellerStoreService } from './services/reseller-store.service';
import { StoreProfileService } from './services/store-profile.service';
import { StoreTeamService } from './services/store-team.service';

/**
 * RS-1 / RS-2 — reseller stores, phase 1: the store record and its life,
 * its team, and the three faces onto it (the seller's, Skydrop's and the
 * store's own).
 *
 * A LEAF: nothing imports it and it exports nothing. It reads orders only
 * through `OrderReadService` (the close check), and reaches notifications
 * through the audience dispatcher and the ledger — none of which imports
 * anything store-shaped, so there is no cycle.
 */
@Module({
  imports: [
    AuthCommonModule,
    EmailModule,
    OrderModule,
    NotificationAudienceModule,
    NotificationLedgerModule,
  ],
  controllers: [
    SellerResellerStoreController,
    AdminResellerStoreController,
    StoreProfileController,
    StoreTeamController,
  ],
  providers: [
    ResellerStoreService,
    StoreTeamService,
    StoreProfileService,
    ResellerStoreNotifier,
    SellerJwtGuard,
    StaffJwtGuard,
    StoreJwtGuard,
  ],
})
export class ResellerStoreModule {}
