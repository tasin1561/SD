import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminStaffRbacController } from './controllers/admin-staff-rbac.controller';
import { StaffRbacService } from './services/staff-rbac.service';

/**
 * Roles as data (R-RBAC). A LEAF module: nothing imports it, and it
 * exports nothing — the permission KEYS other modules declare live in
 * `common/auth/permissions.ts`, not here, so no module ever needs to
 * reach into this one.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminStaffRbacController],
  providers: [StaffRbacService],
})
export class StaffRbacModule {}
