import { Module } from '@nestjs/common';
import { BackupWatchService } from './services/backup-watch.service';
import { BackupWatchQueue } from './queue/backup-watch.queue';

/**
 * Leaf module: watches the off-site backup (scripts/backup) through the
 * audit row each run writes. Exports nothing. SystemIssueService comes
 * from the @Global SystemIssuesModule.
 */
@Module({
  providers: [BackupWatchService, BackupWatchQueue],
})
export class BackupWatchModule {}
