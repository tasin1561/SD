import { Injectable, Logger } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/** Written by scripts/backup/record-backup-run.cjs at the end of every run. */
export const BACKUP_COMPLETED_ACTION = 'system.backup.completed';
export const BACKUP_FAILED_ACTION = 'system.backup.failed';

/**
 * The backup runs every two hours. Past five hours without a success, two
 * runs in a row have been missed — one missed run can be a network blip,
 * two is a stopped backup.
 */
export const BACKUP_STALE_AFTER_HOURS = 5;

export const BACKUP_STALE_ISSUE_KEY = 'backup-stale';
export const BACKUP_FAILED_ISSUE_KEY = 'backup-failed';

export interface BackupRun {
  readonly at: Date;
  /** The step the run stopped at (`database dump`, `stored files`, …). */
  readonly step: string | null;
}

export interface BackupVerdict {
  /** No successful off-site backup inside the window, or never. */
  readonly stale: boolean;
  /** The most recent run failed (no success since). */
  readonly failed: boolean;
  readonly hoursSinceSuccess: number | null;
}

/** Pure: what the latest runs say about the off-site backup. */
export function judgeBackups(input: {
  readonly lastCompleted: BackupRun | null;
  readonly lastFailed: BackupRun | null;
  readonly now: Date;
}): BackupVerdict {
  const { lastCompleted, lastFailed, now } = input;
  const hours =
    lastCompleted === null ? null : (now.getTime() - lastCompleted.at.getTime()) / 3_600_000;
  return {
    stale: hours === null || hours > BACKUP_STALE_AFTER_HOURS,
    failed:
      lastFailed !== null &&
      (lastCompleted === null || lastFailed.at.getTime() > lastCompleted.at.getTime()),
    hoursSinceSuccess: hours === null ? null : Math.round(hours * 10) / 10,
  };
}

const RECOVERY_HINT =
  'On the server: the log is ~/.local/state/skydrop-backup/backup.log, and ' +
  '~/app/scripts/backup/skydrop-backup.sh runs a backup by hand. ' +
  'docs/disaster-recovery.md says what each step needs.';

/**
 * Watches the off-site backup (scripts/backup/skydrop-backup.sh) and says
 * so when it fails or stops. The backup runs OUTSIDE this process — on the
 * server, from cron — so the only evidence of it here is the audit row each
 * run writes; this reads the latest two and never touches the backup.
 *
 * A backup that silently stopped is the common way data is lost, so both
 * cases are HIGH (they notify) and both clear themselves once a run
 * succeeds inside the window.
 */
@Injectable()
export class BackupWatchService {
  private readonly logger = new Logger(BackupWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: SystemIssueService,
  ) {}

  async check(now: Date = new Date()): Promise<BackupVerdict> {
    const [completed, failed] = await Promise.all([
      this.latest(BACKUP_COMPLETED_ACTION),
      this.latest(BACKUP_FAILED_ACTION),
    ]);
    const verdict = judgeBackups({ lastCompleted: completed, lastFailed: failed, now });

    if (verdict.failed && failed !== null) {
      await this.issues.raise({
        kind: SystemIssueKind.OTHER,
        severity: SystemIssueSeverity.HIGH,
        title: 'The off-site backup failed',
        detail:
          `The latest backup to Google Drive stopped at "${failed.step ?? 'an unknown step'}" ` +
          `(${failed.at.toISOString()}). Until one succeeds, the newest copy outside ` +
          `DigitalOcean is ${completed ? completed.at.toISOString() : 'none'}. ${RECOVERY_HINT}`,
        source: 'backup-watch',
        dedupeKey: BACKUP_FAILED_ISSUE_KEY,
        metadata: { failedAt: failed.at.toISOString(), step: failed.step },
      });
    } else {
      await this.issues.resolveByKey(BACKUP_FAILED_ISSUE_KEY, 'A later backup succeeded.');
    }

    if (verdict.stale) {
      await this.issues.raise({
        kind: SystemIssueKind.OTHER,
        severity: SystemIssueSeverity.HIGH,
        title:
          completed === null
            ? 'No off-site backup has ever completed'
            : `No off-site backup for ${verdict.hoursSinceSuccess} hours`,
        detail:
          (completed === null
            ? 'Nothing has been copied to Google Drive yet. '
            : `The last successful backup to Google Drive was ${completed.at.toISOString()}; ` +
              `they run every two hours. `) +
          'If the server or the database were lost now, this is how much would be lost with ' +
          `it. ${RECOVERY_HINT}`,
        source: 'backup-watch',
        dedupeKey: BACKUP_STALE_ISSUE_KEY,
        metadata: {
          lastCompletedAt: completed?.at.toISOString() ?? null,
          hoursSinceSuccess: verdict.hoursSinceSuccess,
        },
      });
    } else {
      await this.issues.resolveByKey(
        BACKUP_STALE_ISSUE_KEY,
        'A backup succeeded within the window.',
      );
    }

    if (verdict.failed || verdict.stale)
      this.logger.warn(verdict, 'Off-site backup needs attention');
    return verdict;
  }

  private async latest(action: string): Promise<BackupRun | null> {
    const row = await this.prisma.client.auditLog.findFirst({
      where: { action },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    });
    if (row === null) return null;
    const meta = row.metadata;
    const step =
      meta !== null &&
      typeof meta === 'object' &&
      !Array.isArray(meta) &&
      typeof meta.step === 'string'
        ? meta.step
        : null;
    return { at: row.createdAt, step };
  }
}
