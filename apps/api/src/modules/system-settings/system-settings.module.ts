import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminSystemSettingsController } from './controllers/admin-system-settings.controller';
import { SystemSettingsService } from './services/system-settings.service';

/**
 * Module 14 — System Settings UI backend. The service is the only
 * sanctioned WRITE path; reads are unaffected (each consumer continues
 * to use `prisma.systemSetting.findUnique` for its specific key —
 * centralizing reads is a Phase-2 cleanup).
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminSystemSettingsController],
  providers: [SystemSettingsService, StaffJwtGuard],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
