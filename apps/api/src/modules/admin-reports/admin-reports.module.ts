import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsAssistantReadService } from './services/reports-assistant-read.service';
import { ReportsService } from './services/reports.service';

@Module({
  imports: [AuthCommonModule],
  controllers: [AdminReportsController],
  providers: [ReportsService, ReportsAssistantReadService, StaffJwtGuard],
  // Read-only door for the AI assistant (`ops_metrics`).
  exports: [ReportsAssistantReadService],
})
export class AdminReportsModule {}
