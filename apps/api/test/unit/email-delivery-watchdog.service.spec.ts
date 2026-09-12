import {
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import {
  EMAIL_RESEND_MAX_AGE_MS,
  EMAIL_STALE_AFTER_MS,
  EMAIL_UNDELIVERED_ISSUE_KEY,
  EmailDeliveryWatchdogService,
} from '../../src/modules/email/services/email-delivery-watchdog.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const NOW = new Date('2026-09-12T12:00:00Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);

interface Row {
  id: string;
  templateCode: string;
  recipientType: NotificationRecipientType;
  recipientId: string | null;
  toEmail: string | null;
  variables: unknown;
  orderId: string | null;
  shipmentId: string | null;
  callAttemptId: string | null;
  triggerEvent: string | null;
  attemptNumber: number;
  createdAt: Date;
  failureCode: string | null;
  failureMessage: string | null;
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'log-1',
    templateCode: 'system.alert.email',
    recipientType: NotificationRecipientType.STAFF,
    recipientId: 'staff-1',
    toEmail: 'ops@x.io',
    variables: { title: 'Critical: x', body: 'y', name: 'Ops' },
    orderId: null,
    shipmentId: null,
    callAttemptId: null,
    triggerEvent: 'system_issue.money',
    attemptNumber: 1,
    createdAt: minutesAgo(45),
    failureCode: null,
    failureMessage: null,
    ...over,
  };
}

function makeSut(opts: { rows: Row[]; live?: string[]; claimCount?: number }) {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const findMany = jest.fn(async () => opts.rows);
  const prisma = {
    client: {
      notificationLog: {
        findMany,
        updateMany: jest.fn(
          async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updates.push(args);
            return { count: opts.claimCount ?? 1 };
          },
        ),
      },
    },
  } as unknown as PrismaService;
  const emailQueue = {
    liveNotificationLogIds: jest.fn(async () => new Set(opts.live ?? [])),
    enqueue: jest.fn(async () => 'job-1'),
  };
  const issues = { raise: jest.fn(async () => ({ id: 'issue-1', isNew: true })) };
  const svc = new EmailDeliveryWatchdogService(
    prisma,
    emailQueue as unknown as EmailQueue,
    issues as unknown as SystemIssueService,
  );
  return { svc, findMany, updates, emailQueue, issues };
}

describe('EmailDeliveryWatchdogService', () => {
  it('looks only at stale QUEUED email rows', async () => {
    const { svc, findMany, emailQueue } = makeSut({ rows: [] });
    const res = await svc.sweep(NOW);

    expect(res).toEqual({ examined: 0, stillLive: 0, reenqueued: 0, givenUp: 0 });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    const staleBefore = new Date(NOW.getTime() - EMAIL_STALE_AFTER_MS);
    expect(where).toEqual({
      channel: NotificationChannel.EMAIL,
      status: NotificationStatus.QUEUED,
      createdAt: { lt: staleBefore },
      updatedAt: { lt: staleBefore },
    });
    // Nothing stale ⇒ Redis is not even asked.
    expect(emailQueue.liveNotificationLogIds).not.toHaveBeenCalled();
  });

  it('leaves a row alone while a live job still holds it (quiet hours, backoff)', async () => {
    const { svc, updates, emailQueue, issues } = makeSut({ rows: [row()], live: ['log-1'] });
    const res = await svc.sweep(NOW);

    expect(res.stillLive).toBe(1);
    expect(updates).toHaveLength(0);
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(issues.raise).not.toHaveBeenCalled();
  });

  it('re-queues a stuck row ONCE, claiming the attempt before enqueuing', async () => {
    const { svc, updates, emailQueue, issues } = makeSut({ rows: [row()] });
    const res = await svc.sweep(NOW);

    expect(res.reenqueued).toBe(1);
    expect(updates).toEqual([
      {
        where: { id: 'log-1', status: NotificationStatus.QUEUED, attemptNumber: 1 },
        data: { attemptNumber: { increment: 1 } },
      },
    ]);
    // Back through the ordinary UPDATE path onto the SAME row (NOTIF-2).
    expect(emailQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        templateCode: 'system.alert.email',
        existingNotificationLogId: 'log-1',
        recipient: { type: NotificationRecipientType.STAFF, id: 'staff-1', email: 'ops@x.io' },
        variables: { title: 'Critical: x', body: 'y', name: 'Ops' },
      }),
      { jobId: 'email-watchdog-log-1' },
    );
    expect(issues.raise).not.toHaveBeenCalled();
  });

  it('does not enqueue when another sweep won the claim', async () => {
    const { svc, emailQueue } = makeSut({ rows: [row()], claimCount: 0 });
    const res = await svc.sweep(NOW);
    expect(res.reenqueued).toBe(0);
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
  });

  it('closes a row still unsent after its re-queue, and reports it HIGH', async () => {
    const { svc, updates, emailQueue, issues } = makeSut({
      rows: [
        row({
          attemptNumber: 2,
          failureCode: 'TEMPLATE_NOT_FOUND',
          failureMessage: 'Email template not found: x/en',
        }),
      ],
    });
    const res = await svc.sweep(NOW);

    expect(res.givenUp).toBe(1);
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(updates[0]?.where).toEqual({ id: 'log-1', status: NotificationStatus.QUEUED });
    expect(updates[0]?.data).toMatchObject({
      status: NotificationStatus.FAILED,
      failureCode: 'UNSENT_AFTER_RETRY',
      failedAt: NOW,
    });
    // The reason it never went is carried, not overwritten away.
    expect(String(updates[0]?.data['failureMessage'])).toContain('TEMPLATE_NOT_FOUND');

    expect(issues.raise).toHaveBeenCalledTimes(1);
    expect(issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: SystemIssueKind.INTEGRATION,
        // HIGH ⇒ in-app, NOT email — the channel that is failing.
        severity: SystemIssueSeverity.HIGH,
        dedupeKey: EMAIL_UNDELIVERED_ISSUE_KEY,
        title: 'An email was never sent',
      }),
    );
  });

  it('the 7 Sep shape: a days-old row is closed and reported, never sent late', async () => {
    const stuck = ['a', 'b', 'c'].map((id) =>
      row({
        id,
        templateCode: 'system_issue.money',
        createdAt: new Date(NOW.getTime() - EMAIL_RESEND_MAX_AGE_MS * 5),
      }),
    );
    const { svc, updates, emailQueue, issues } = makeSut({ rows: stuck });
    const res = await svc.sweep(NOW);

    expect(res.givenUp).toBe(3);
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(updates.map((u) => u.data['failureCode'])).toEqual([
      'EXPIRED_UNSENT',
      'EXPIRED_UNSENT',
      'EXPIRED_UNSENT',
    ]);
    // ONE issue for the sweep, not one per row.
    expect(issues.raise).toHaveBeenCalledTimes(1);
    const raised = (issues.raise.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(raised['title']).toBe('3 emails were never sent');
    expect(raised['metadata']).toEqual({
      notificationLogIds: ['a', 'b', 'c'],
      byReason: { EXPIRED_UNSENT: 3 },
    });
    // No addresses in what is shown to staff.
    expect(String(raised['detail'])).not.toContain('ops@x.io');
  });

  it('closes a row with no address rather than re-queuing it', async () => {
    const { svc, updates, emailQueue } = makeSut({ rows: [row({ toEmail: null })] });
    await svc.sweep(NOW);
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(updates[0]?.data['failureCode']).toBe('NO_ADDRESS');
  });

  it('does not report a row it failed to close (someone else moved it)', async () => {
    const { svc, issues } = makeSut({ rows: [row({ attemptNumber: 2 })], claimCount: 0 });
    const res = await svc.sweep(NOW);
    expect(res.givenUp).toBe(0);
    expect(issues.raise).not.toHaveBeenCalled();
  });
});
