import { SystemIssueSeverity } from '@skydrop/db';
import {
  BACKUP_COMPLETED_ACTION,
  BACKUP_FAILED_ACTION,
  BACKUP_FAILED_ISSUE_KEY,
  BACKUP_STALE_AFTER_HOURS,
  BACKUP_STALE_ISSUE_KEY,
  BackupWatchService,
  judgeBackups,
} from '../../src/modules/backup-watch/services/backup-watch.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

const NOW = new Date('2026-09-15T12:00:00Z');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

describe('judgeBackups', () => {
  it('a recent success with no later failure is fine', () => {
    expect(
      judgeBackups({
        lastCompleted: { at: hoursAgo(1), step: 'done' },
        lastFailed: null,
        now: NOW,
      }),
    ).toEqual({ stale: false, failed: false, hoursSinceSuccess: 1 });
  });

  it('one missed run is not yet stale; two are', () => {
    const ok = judgeBackups({
      lastCompleted: { at: hoursAgo(BACKUP_STALE_AFTER_HOURS - 1), step: 'done' },
      lastFailed: null,
      now: NOW,
    });
    const late = judgeBackups({
      lastCompleted: { at: hoursAgo(BACKUP_STALE_AFTER_HOURS + 0.5), step: 'done' },
      lastFailed: null,
      now: NOW,
    });
    expect(ok.stale).toBe(false);
    expect(late.stale).toBe(true);
  });

  it('never having completed is stale', () => {
    expect(judgeBackups({ lastCompleted: null, lastFailed: null, now: NOW }).stale).toBe(true);
  });

  it('a failure after the last success is failed; one before it is history', () => {
    const failedNow = judgeBackups({
      lastCompleted: { at: hoursAgo(6), step: 'done' },
      lastFailed: { at: hoursAgo(1), step: 'stored files' },
      now: NOW,
    });
    const recovered = judgeBackups({
      lastCompleted: { at: hoursAgo(1), step: 'done' },
      lastFailed: { at: hoursAgo(6), step: 'database dump' },
      now: NOW,
    });
    expect(failedNow.failed).toBe(true);
    expect(recovered.failed).toBe(false);
  });
});

function harness(rows: Record<string, { createdAt: Date; metadata: unknown } | null>) {
  const issues = {
    raise: jest.fn().mockResolvedValue({ id: 'i1', isNew: true }),
    resolveByKey: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    client: {
      auditLog: {
        findFirst: jest.fn(
          async (args: { where: { action: string } }) => rows[args.where.action] ?? null,
        ),
      },
    },
  } as unknown as PrismaService;
  return {
    issues,
    svc: new BackupWatchService(prisma, issues as unknown as SystemIssueService),
  };
}

describe('BackupWatchService.check', () => {
  it('a healthy backup raises nothing and clears both issues', async () => {
    const { svc, issues } = harness({
      [BACKUP_COMPLETED_ACTION]: {
        createdAt: hoursAgo(BACKUP_STALE_AFTER_HOURS - 1),
        metadata: { step: 'done' },
      },
    });
    await svc.check(NOW);
    expect(issues.raise).not.toHaveBeenCalled();
    expect(issues.resolveByKey).toHaveBeenCalledWith(BACKUP_FAILED_ISSUE_KEY, expect.any(String));
    expect(issues.resolveByKey).toHaveBeenCalledWith(BACKUP_STALE_ISSUE_KEY, expect.any(String));
  });

  it('a failed latest run raises HIGH naming the step it stopped at', async () => {
    const { svc, issues } = harness({
      // Inside the stale window, so only the failure is raised.
      [BACKUP_COMPLETED_ACTION]: {
        createdAt: hoursAgo(BACKUP_STALE_AFTER_HOURS - 1),
        metadata: { step: 'done' },
      },
      [BACKUP_FAILED_ACTION]: { createdAt: hoursAgo(1), metadata: { step: 'stored files' } },
    });
    await svc.check(NOW);
    expect(issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: BACKUP_FAILED_ISSUE_KEY,
        severity: SystemIssueSeverity.HIGH,
        detail: expect.stringContaining('stored files'),
      }),
    );
    expect(issues.resolveByKey).toHaveBeenCalledWith(BACKUP_STALE_ISSUE_KEY, expect.any(String));
  });

  it('no backup ever raises the stale issue', async () => {
    const { svc, issues } = harness({});
    await svc.check(NOW);
    expect(issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: BACKUP_STALE_ISSUE_KEY,
        title: 'No off-site backup has ever completed',
      }),
    );
  });
});
