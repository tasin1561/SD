import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportsService } from './services/reports.service';

@Module({
  imports: [AuthCommonModule],
  controllers: [AdminReportsController],
  providers: [ReportsService, StaffJwtGuard],
})
export class AdminReportsModule {}
