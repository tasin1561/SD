import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { AdminCourierController } from './controllers/admin-courier.controller';
import { AdminCourierAccountController } from './controllers/admin-courier-account.controller';
import { AdminSellerCourierAccountController } from './controllers/admin-seller-courier-account.controller';
import { CourierAccountAdminService } from './services/courier-account-admin.service';

/**
 * R1 (revised-plan roadmap) — admin write surface for CourierAccount +
 * SellerCourierAccountLink. Leaf module (nothing imports it); the
 * read/selection side (`CourierAccountRoutingService`) lives in the
 * dependency-free `courier-shared` primitive instead, so multi-account
 * routing at AWB/dispatch time never needs to import this admin module.
 */
@Module({
  imports: [AuthCommonModule, CourierSharedModule],
  controllers: [
    AdminCourierController,
    AdminCourierAccountController,
    AdminSellerCourierAccountController,
  ],
  providers: [CourierAccountAdminService, StaffJwtGuard],
})
export class CourierAccountAdminModule {}
