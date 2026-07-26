import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminSellerSettingsController } from './controllers/admin-seller-settings.controller';
import { SettingsResolverService } from './services/settings-resolver.service';

/**
 * The generic per-seller settings-override primitive (R0 of the
 * revised-plan roadmap). Dependency-free by design — only PrismaService
 * + AuditLogService — so any domain module can import it without a
 * cycle (same R3 shape as call-queue / shipment-provision /
 * lifecycle-events). `SettingsResolverService` is the sole exported
 * surface; the admin controller is this module's own concern.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminSellerSettingsController],
  providers: [SettingsResolverService, StaffJwtGuard],
  exports: [SettingsResolverService],
})
export class SettingsModule {}
