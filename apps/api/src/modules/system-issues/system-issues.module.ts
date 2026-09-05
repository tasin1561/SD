import { Global, Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminSystemIssueController } from './controllers/admin-system-issue.controller';
import { SystemIssueService } from './services/system-issue.service';
import { ScanBlockService } from './services/scan-block.service';
import { SystemIssueNotifier } from './services/system-issue-notifier.service';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';

/**
 * The system's own problem list.
 *
 * GLOBAL, deliberately. Anything that can fail quietly should be able
 * to say so without its module first negotiating an import — and the
 * failure paths that most need this are the ones nobody thought about
 * in advance.
 *
 * It now depends on ONE thing: the notification dispatcher, so that
 * raising an issue also tells a person (recording a problem and
 * announcing it are not the same, and for months only the first
 * happened). No cycle — `notification-audience` knows nothing about
 * system issues, and its own dependencies (email, auth-common) do not
 * reach back here. The boot test is what holds that true.
 */
@Global()
@Module({
  imports: [AuthCommonModule, NotificationAudienceModule],
  controllers: [AdminSystemIssueController],
  providers: [SystemIssueService, ScanBlockService, SystemIssueNotifier, StaffJwtGuard],
  exports: [SystemIssueService, ScanBlockService, SystemIssueNotifier],
})
export class SystemIssuesModule {}
