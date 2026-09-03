import { Global, Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminSystemIssueController } from './controllers/admin-system-issue.controller';
import { SystemIssueService } from './services/system-issue.service';
import { ScanBlockService } from './services/scan-block.service';

/**
 * The system's own problem list.
 *
 * GLOBAL, deliberately. Anything that can fail quietly should be able
 * to say so without its module first negotiating an import — and the
 * failure paths that most need this are the ones nobody thought about
 * in advance. The service writes one table and depends on nothing, so
 * there is no cycle to create.
 */
@Global()
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminSystemIssueController],
  providers: [SystemIssueService, ScanBlockService, StaffJwtGuard],
  exports: [SystemIssueService, ScanBlockService],
})
export class SystemIssuesModule {}
