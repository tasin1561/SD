import { Injectable, Logger, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueNotifier } from './system-issue-notifier.service';

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
  /**
   * Stop this staff member scanning until the issue is resolved.
   *
   * Set by `ScanBlockService` only. Per operator rather than per
   * station: parcels are packed and loaded by several people at once,
   * and one person's duplicate must not halt the others.
   */
  readonly blocksScanForStaffId?: string;
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
export class SystemIssueService implements OnModuleDestroy {
  private readonly logger = new Logger(SystemIssueService.name);

  /**
   * Raises still going out.
   *
   * Fifty-odd call sites reach this service as `void this.issues…` —
   * every worker's failure hooks, the exception filter, the sweeps —
   * because raising an issue must never delay or break the failure path
   * that triggered it. That is right in production and is exactly the
   * shape CLAUDE.md's drain rule exists for: work that outlives its
   * caller needs a way to be quiesced, or in the e2e harness it races
   * the reset. Its INSERT holds a RowShareLock on the tables it
   * references while the harness's TRUNCATE wants an
   * AccessExclusiveLock, and Postgres kills one with a 40P01 naming
   * neither the test nor the cause.
   *
   * Tracked HERE rather than at each caller: fifty-three `void`s cannot
   * each be remembered, and the fifty-fourth would reopen the hole. The
   * notifier already had its own drain (NOTIF-19) — this is the layer
   * beneath it, which nothing was awaiting.
   */
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: SystemIssueNotifier,
  ) {}

  /**
   * Await every raise still in flight. Public for the e2e harness, and
   * awaited in `onModuleDestroy` so a shutdown cannot cut one short.
   */
  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drainInFlight();
  }

  /**
   * Open an issue, or record that an open one happened again.
   *
   * A nightly job failing for a fortnight is ONE issue seen fourteen
   * times. The partial unique index on `dedupe_key WHERE resolved_at IS
   * NULL` is what enforces that — not a read-then-write, which under
   * READ COMMITTED lets two concurrent raises both insert.
   */
  raise(input: RaiseIssueInput): Promise<{ id: string; isNew: boolean } | null> {
    // Registered before it is returned, so a caller that fires and
    // forgets is still drainable. `finally` rather than `then`: a
    // rejected raise must leave the set too, or the drain waits forever
    // on work that already gave up.
    const p = this.raiseInner(input);
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
    return p;
  }

  private async raiseInner(input: RaiseIssueInput): Promise<{ id: string; isNew: boolean } | null> {
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
          ...(input.blocksScanForStaffId === undefined
            ? {}
            : { blocksScanForStaffId: input.blocksScanForStaffId }),
        },
        select: { id: true },
      });
      this.logger.warn({ ...input, issueId: created.id }, 'System issue raised');
      // Tell somebody. ONLY on a new issue — a recurrence bumps the
      // count above and returns before reaching here, so a job failing
      // nightly for a fortnight interrupts one person once rather than
      // fourteen times. Awaited rather than fired-and-forgotten so a
      // caller that finishes immediately (a sweep, a request handler)
      // cannot exit with the notification still in flight; the notifier
      // swallows its own failures, so this cannot throw.
      await this.notifier.notify({
        issueId: created.id,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        detail: input.detail,
      });
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
  async resolveByKey(dedupeKey: string, note: string, staffId?: string | null): Promise<number> {
    try {
      const res = await this.prisma.client.systemIssue.updateMany({
        where: { dedupeKey, resolvedAt: null },
        data: {
          resolvedAt: new Date(),
          resolutionNote: note,
          // Optional because the ordinary caller is a sweep noticing the
          // problem has gone, and crediting a person with that would be
          // a false record. A person who answered the issue by acting on
          // it — recording the payment the issue asked for — passes it,
          // so the row says who rather than "it cleared itself".
          ...(staffId == null ? {} : { resolvedByStaffId: staffId }),
        },
      });
      if (res.count > 0) this.logger.log({ dedupeKey }, 'System issue cleared itself');
      return res.count;
    } catch {
      return 0;
    }
  }

  /**
   * The dedupe keys of every OPEN issue whose key starts with `prefix`.
   *
   * For a sweep that has to clear issues about things that are no longer
   * in its candidate set — a voided waybill that got cancelled drops out
   * of the query that found it, so the sweep cannot reach its issue by
   * iterating candidates. Asking for the open keys is bounded by what is
   * actually open, not by history.
   */
  async openDedupeKeys(prefix: string): Promise<readonly string[]> {
    const rows = await this.prisma.client.systemIssue.findMany({
      where: { dedupeKey: { startsWith: prefix }, resolvedAt: null },
      select: { dedupeKey: true },
    });
    return rows.map((r) => r.dedupeKey);
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

  /**
   * An endpoint threw something nobody anticipated.
   *
   * A 5xx used to reach a log file and stop there: the caller saw
   * "something went wrong", and we found out when somebody rang. This
   * is the other half of the board — the workers report the work that
   * did not happen in the background, and this reports the work that
   * did not happen while a person was waiting for it.
   *
   * MEDIUM, deliberately, not HIGH. "Something has stopped working and
   * will stay stopped" is exactly what an unhandled exception is, and
   * MEDIUM puts it on the page without interrupting anybody (NOTIF-16
   * notifies on HIGH and CRITICAL only). A board that pages on every
   * 500 is a board people mute, and the muting outlasts the incident.
   * The COUNT is what carries urgency here: one occurrence is usually
   * one bad row, and a number climbing through the hundreds is an
   * endpoint that is down.
   *
   * Deduped on `METHOD route + error name`, so the same bug on the same
   * endpoint is one row that gets heavier rather than a thousand rows
   * that get scrolled past. The error NAME and not its message: a
   * message often carries the id it choked on, which would split one
   * bug across every request that hit it.
   */
  async reportRequestFailure(input: {
    method: string;
    route: string;
    exception: unknown;
    requestId: string | null;
  }): Promise<void> {
    const err = input.exception;
    const name = err instanceof Error ? err.name : typeof err;
    const message = err instanceof Error ? err.message : String(err);
    const where = `${input.method} ${input.route}`;
    await this.raise({
      kind: SystemIssueKind.API_ERROR,
      severity: SystemIssueSeverity.MEDIUM,
      title: `${where} is failing`,
      detail:
        `A request failed with an unhandled ${name}: ${message}\n\n` +
        'Whoever made this request was told "something went wrong" and got nothing. ' +
        'Check the count — one occurrence is usually a single bad row, while a climbing ' +
        'count means this endpoint is down for everybody using it. The request id below ' +
        'finds the full stack trace in the process logs.',
      source: where,
      dedupeKey: `api-error:${where}:${name}`,
      metadata: {
        method: input.method,
        route: input.route,
        errorName: name,
        error: message,
        requestId: input.requestId,
      },
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
