import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AccrualExecutionService } from './accrual-execution.service';

/** Cap per sweep so one run never opens an unbounded number of small
 *  accrual transactions; the hourly cadence drains any backlog
 *  (mirrors ReservationCleanupService's SWEEP_BATCH_LIMIT). */
const SWEEP_BATCH_LIMIT = 200;

export interface PendingAccrualSweepResult {
  scanned: number;
  processed: number;
  failed: number;
}

/**
 * R2b — sweeps T_PLUS_N-tier orders whose delay window has elapsed.
 * Per-row failure isolation (one bad order never blocks the batch,
 * same discipline as AwbGenerationJobService's per-shipment loop).
 *
 * Ordering: execute the accrual FIRST (the durable side effect —
 * `AccrualExecutionService.executeAccrual` is itself idempotent via
 * its own gates), mark `processedAt` SECOND. A crash between the two
 * leaves a row that looks unprocessed but whose underlying credit/
 * debit already landed — the next sweep re-invokes `executeAccrual`
 * safely (its gates no-op) and then marks it processed. Visible-vs-
 * silent failure ordering, same shape as every other saga in this
 * codebase.
 */
@Injectable()
export class PendingAccrualSweepService {
  private readonly logger = new Logger(PendingAccrualSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: AccrualExecutionService,
  ) {}

  async sweep(now: Date = new Date()): Promise<PendingAccrualSweepResult> {
    const due = await this.prisma.client.pendingAccrual.findMany({
      where: { processedAt: null, eligibleAt: { lte: now } },
      orderBy: { eligibleAt: 'asc' },
      take: SWEEP_BATCH_LIMIT,
      select: { id: true, orderId: true },
    });

    let processed = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await this.execution.executeAccrual(row.orderId);
        await this.prisma.client.pendingAccrual.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
        processed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          {
            pendingAccrualId: row.id,
            orderId: row.orderId,
            err: err instanceof Error ? err.message : String(err),
          },
          'Pending accrual execution failed — isolated, continuing sweep',
        );
      }
    }

    const result: PendingAccrualSweepResult = { scanned: due.length, processed, failed };
    if (due.length > 0) {
      this.logger.log(result, 'Pending accrual sweep complete');
    }
    return result;
  }
}
