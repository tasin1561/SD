import { Injectable, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

/**
 * The queue and job names the PORTAL WORKER listens on.
 *
 * Restated here rather than imported from `courier-portal`, and that is
 * the point: `CourierPortalModule` is deliberately unreachable from
 * `AppModule` (a long-lived Chromium must not live in the process
 * serving customer HTTP), and `portal-worker-isolation.spec.ts` enforces
 * it. Importing the worker for its constants would drag the whole portal
 * graph into the API and break that isolation for the sake of a few
 * strings.
 *
 * Two copies of a string is a real cost, so it is paid deliberately and
 * pinned: `wallet-sync-queue-names.spec.ts` reads both files and fails
 * if they drift. A queue name that silently diverges would leave the
 * button enqueueing into a queue nobody is listening to, and the symptom
 * is a run that never happens with no error anywhere.
 */
export const WALLET_SYNC_QUEUE = 'courier-wallet-sync';
export const JOB_WALLET_SYNC = 'sync-delhivery-wallet';
/**
 * The read-only Delhivery billing probe. On the wallet sync's queue so the
 * worker's one-at-a-time rule keeps it off the same login as the sync.
 */
export const JOB_DELHIVERY_BILLING_PROBE = 'probe-delhivery-billing';

const PORTAL_JOB_OPTIONS: JobsOptions = {
  // ONE attempt, matching the scheduled job. A retry loop that logs into
  // a courier's portal repeatedly is how an account gets locked.
  attempts: 1,
  removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
  removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
};

/**
 * Ask the portal worker to run the cost sync (or the billing probe) now.
 *
 * ── WHY A QUEUE AND NOT A CALL ───────────────────────────────────────
 * The sync lives in another PROCESS. It signs in to a courier portal
 * with a real browser, which is exactly what the API is not allowed to
 * contain. Redis is the seam the two already share, so the button
 * enqueues and the worker picks it up — the same job the scheduler
 * adds, by the same name, so there is one code path and not two.
 *
 * The consequence to be honest about: this returns as soon as the job is
 * QUEUED, not when the sync has finished. A run takes a minute or two of
 * browser work, and pretending otherwise — by waiting on it — would tie
 * an HTTP request to a browser session and time out. The panel says so,
 * and the run appears in the history when it lands.
 */
@Injectable()
export class WalletSyncTriggerService {
  private readonly logger = new Logger(WalletSyncTriggerService.name);

  constructor(private readonly redis: RedisService) {}

  async requestRun(): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    const res = await this.enqueue(JOB_WALLET_SYNC, { manual: true }, PORTAL_JOB_OPTIONS);
    this.logger.log({ jobId: res.jobId }, 'Manual wallet sync queued');
    return res;
  }

  /**
   * Queue the read-only billing probe. `runId` names where its findings
   * and files land, and is the job id too (colon-free — a uuid), so the
   * same run cannot be queued twice.
   */
  async requestBillingProbe(
    runId: string,
    requestedByStaffId: string,
  ): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    const res = await this.enqueue(
      JOB_DELHIVERY_BILLING_PROBE,
      { manual: true, runId, requestedByStaffId },
      { ...PORTAL_JOB_OPTIONS, jobId: `delhivery-billing-probe-${runId}` },
    );
    this.logger.log({ jobId: res.jobId, runId }, 'Delhivery billing probe queued');
    return res;
  }

  private async enqueue(
    name: string,
    data: Record<string, unknown>,
    opts: JobsOptions,
  ): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    const queue = new Queue(WALLET_SYNC_QUEUE, { connection: this.redis.createConnection() });
    try {
      const job = await queue.add(name, data, opts);
      return { queued: true, jobId: job.id ?? null };
    } finally {
      // Closed every time: this is a request-scoped producer, and a
      // connection left open per click leaks one per press.
      await queue.close();
    }
  }
}
