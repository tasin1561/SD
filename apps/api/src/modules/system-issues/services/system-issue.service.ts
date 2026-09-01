import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface RaiseIssueInput {
  readonly kind: SystemIssueKind;
  readonly severity: SystemIssueSeverity;
  readonly title: string;
  /** What to DO. Written here, where the context is. */
  readonly detail: string;
  readonly source: string;
  /**
   * What makes this the SAME problem across runs. Include the thing it
   * is about (an account id, a courier code) and NOT the moment — a key
   * carrying a timestamp opens a new row every night.
   */
  readonly dedupeKey: string;
  readonly metadata?: Prisma.InputJsonValue;
}

export interface SystemIssueView {
  readonly id: string;
  readonly kind: SystemIssueKind;
  readonly severity: SystemIssueSeverity;
  readonly title: string;
  readonly detail: string;
  readonly source: string;
  readonly occurrenceCount: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
  readonly metadata: unknown;
}

/**
 * The one place the system says "a person is needed here".
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Everything that fails quietly used to end as a line in a log nobody
 * reads: a courier portal asking for an OTP, a nightly cost sync that
 * could not log in, a credential that stopped working. Each is
 * invisible until somebody notices a number looks wrong weeks later.
 *
 * `audit_logs` records what HAPPENED. This records what is still WRONG
 * — it has a state, and it stays visible until a person closes it.
 *
 * ── RAISING IS IDEMPOTENT AND MUST NEVER THROW ───────────────────────
 * Callers are already in a failure path. An issue-tracker that throws
 * inside a catch block turns a handled problem into an unhandled one,
 * so every failure here is swallowed and logged — the same discipline
 * as AuditLogService.
 */
@Injectable()
export class SystemIssueService {
  private readonly logger = new Logger(SystemIssueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Open an issue, or record that an open one happened again.
   *
   * A nightly job failing for a fortnight is ONE issue seen fourteen
   * times. The partial unique index on `dedupe_key WHERE resolved_at IS
   * NULL` is what enforces that — not a read-then-write, which under
   * READ COMMITTED lets two concurrent raises both insert.
   */
  async raise(input: RaiseIssueInput): Promise<{ id: string; isNew: boolean } | null> {
    const now = new Date();
    try {
      // Bump first: the common case after the first failure is a repeat.
      const bumped = await this.prisma.client.systemIssue.updateMany({
        where: { dedupeKey: input.dedupeKey, resolvedAt: null },
        data: {
          occurrenceCount: { increment: 1 },
          lastSeenAt: now,
          // A recurrence re-states the current detail: the second
          // failure may say more than the first.
          detail: input.detail,
          severity: input.severity,
        },
      });
      if (bumped.count > 0) {
        const existing = await this.prisma.client.systemIssue.findFirst({
          where: { dedupeKey: input.dedupeKey, resolvedAt: null },
          select: { id: true },
        });
        return existing === null ? null : { id: existing.id, isNew: false };
      }

      const created = await this.prisma.client.systemIssue.create({
        data: {
          kind: input.kind,
          severity: input.severity,
          title: input.title,
          detail: input.detail,
          source: input.source,
          dedupeKey: input.dedupeKey,
          firstSeenAt: now,
          lastSeenAt: now,
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
        select: { id: true },
      });
      this.logger.warn({ ...input, issueId: created.id }, 'System issue raised');
      return { id: created.id, isNew: true };
    } catch (err) {
      // Lost a race to another raise of the same key, or the write
      // failed. Either way the caller is already handling a failure and
      // must not inherit a second one.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), dedupeKey: input.dedupeKey },
        'Could not raise a system issue',
      );
      return null;
    }
  }

  /**
   * Close an issue the system fixed by itself.
   *
   * Called on the SUCCESS path, so a job that starts working again
   * clears its own alarm rather than leaving a stale row for a human to
   * tidy. No-op when nothing is open.
   */
  async resolveByKey(dedupeKey: string, note: string): Promise<number> {
    try {
      const res = await this.prisma.client.systemIssue.updateMany({
        where: { dedupeKey, resolvedAt: null },
        data: { resolvedAt: new Date(), resolutionNote: note },
      });
      if (res.count > 0) this.logger.log({ dedupeKey }, 'System issue cleared itself');
      return res.count;
    } catch {
      return 0;
    }
  }

  /**
   * A background worker fell over.
   *
   * Every BullMQ worker has an `on('error')` that logged and stopped
   * there — twenty-two of them. A worker erroring is the definition of a
   * quiet failure: nothing 500s, no screen breaks, the work simply stops
   * happening. Whichever one it is, somebody should be told.
   *
   * Keyed on the WORKER, so one failing every minute for a day is one
   * issue seen many times rather than a wall of rows.
   *
   * MEDIUM by default: BullMQ emits `error` for transient connection
   * blips too, and crying CRITICAL at every Redis hiccup is how a list
   * stops being read. The occurrence count is what tells a blip from a
   * fault, and it is on the card.
   */
  /**
   * A queued job gave up.
   *
   * Distinct from reportWorkerError, and the distinction is the whole
   * point: `error` is usually a Redis blip, whereas an EXHAUSTED job is
   * a piece of work that definitively did not happen — an email nobody
   * got, a CSV row nobody imported, an accrual nobody was paid.
   *
   * Only reported once BullMQ has stopped retrying. A job on attempt 2
   * of 5 is not a failure yet, and raising there would fill the board
   * with things that fixed themselves thirty seconds later — which is
   * how a board stops being read.
   */
  async reportJobFailure(
    workerName: string,
    job: { id?: string; attemptsMade?: number; opts?: { attempts?: number } } | undefined,
    err: unknown,
  ): Promise<void> {
    const attempts = job?.opts?.attempts ?? 1;
    const made = job?.attemptsMade ?? 1;
    if (made < attempts) return; // still retrying — not yet a fact

    const message = err instanceof Error ? err.message : String(err);
    await this.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.MEDIUM,
      title: `${workerName} gave up on a job`,
      detail:
        `A job failed ${made} time(s) and will not be retried: ${message}\n\n` +
        'That work did not happen and nothing will pick it up by itself. Check the count — ' +
        'a single occurrence is usually one bad row, while a climbing count means every job ' +
        'this worker takes is failing.',
      source: workerName,
      dedupeKey: `job-failed:${workerName}`,
      metadata: { workerName, jobId: job?.id ?? null, attemptsMade: made, error: message },
    });
  }

  async reportWorkerError(workerName: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.MEDIUM,
      title: `${workerName} is erroring`,
      detail:
        `A background worker reported: ${message}\n\n` +
        'Whatever this worker does is not happening while this persists. A handful of ' +
        'occurrences is usually a Redis blip and clears itself; a count that keeps climbing ' +
        'means the work has genuinely stopped — check the process logs for this worker.',
      source: workerName,
      dedupeKey: `worker-error:${workerName}`,
      metadata: { workerName, error: message },
    });
  }

  async list(opts: { includeResolved?: boolean } = {}): Promise<readonly SystemIssueView[]> {
    return this.prisma.client.systemIssue.findMany({
      where: opts.includeResolved === true ? {} : { resolvedAt: null },
      // Worst first, then most recently seen — the order somebody would
      // work them in.
      orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        kind: true,
        severity: true,
        title: true,
        detail: true,
        source: true,
        occurrenceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        resolutionNote: true,
        metadata: true,
      },
    });
  }

  /** Somebody is on it. Does NOT close it. */
  async acknowledge(id: string, staffId: string): Promise<{ acknowledgedAt: Date }> {
    const now = new Date();
    const res = await this.prisma.client.systemIssue.updateMany({
      where: { id, resolvedAt: null },
      data: { acknowledgedAt: now, acknowledgedByStaffId: staffId },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        code: 'ISSUE_NOT_OPEN',
        message: 'That issue is not open — it may have cleared itself already.',
      });
    }
    return { acknowledgedAt: now };
  }

  /** A person says it is dealt with. */
  async resolve(id: string, staffId: string, note: string): Promise<{ resolvedAt: Date }> {
    const now = new Date();
    const res = await this.prisma.client.systemIssue.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: now, resolvedByStaffId: staffId, resolutionNote: note },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        code: 'ISSUE_NOT_OPEN',
        message: 'That issue is not open — somebody may have closed it already.',
      });
    }
    return { resolvedAt: now };
  }
}
