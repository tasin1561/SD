import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketPortalProbeService } from '../services/shiprocket-portal-probe.service';
import { ShiprocketWalletSyncService } from '../services/shiprocket-wallet-sync.service';
import { ShiprocketInvoiceCheckService } from '../services/shiprocket-invoice-check.service';

/**
 * Restated in `shiprocket-cost-sync/services/shiprocket-portal-trigger.service.ts`
 * rather than imported — the API must not reach into this module (the
 * portal owns a browser). `shiprocket-portal-queue-names.spec.ts` fails if
 * the two copies drift; drift here has no symptom but a button that
 * queues into nothing.
 */
export const SHIPROCKET_PORTAL_QUEUE = 'shiprocket-portal';
export const JOB_SHIPROCKET_PORTAL_PROBE = 'probe-shiprocket-portal';
export const JOB_SHIPROCKET_WALLET_SYNC = 'sync-shiprocket-wallet';
export const JOB_SHIPROCKET_INVOICE_CHECK = 'check-shiprocket-invoices';

/**
 * 03:50 IST — after the day's charges have posted, and clear of the
 * Delhivery wallet sync (02:40 IST) so two browsers are not signing in to
 * two panels from one small droplet at once.
 */
export const SHIPROCKET_WALLET_CRON = '50 3 * * *';
export const SHIPROCKET_WALLET_TZ = 'Asia/Kolkata';
/**
 * 04:30 IST — after the wallet sync (03:50) has stored the night's
 * movements, because the invoice check compares against OUR ledger.
 * Nightly, not monthly: invoices arrive several times a month, and a
 * discrepancy can only be disputed within 15 days of its invoice.
 */
export const SHIPROCKET_INVOICE_CRON = '30 4 * * *';

@Injectable()
export class ShiprocketPortalWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiprocketPortalWorker.name);
  private worker!: Worker;
  private queue: Queue | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly probe: ShiprocketPortalProbeService,
    private readonly wallet: ShiprocketWalletSyncService,
    private readonly invoices: ShiprocketInvoiceCheckService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the portal process drives a browser (see WorkerRoleService).
    if (!this.workerRole.shouldStartPortal(ShiprocketPortalWorker.name)) return;

    // The nightly wallet sync. ONE attempt: a retry loop signing in to a
    // courier's panel is how an account gets locked, and the window is
    // rolling, so a missed night is read by the next.
    this.queue = new Queue(SHIPROCKET_PORTAL_QUEUE, { connection: this.redis.createConnection() });
    await this.queue.add(
      JOB_SHIPROCKET_WALLET_SYNC,
      { manual: false },
      {
        repeat: { pattern: SHIPROCKET_WALLET_CRON, tz: SHIPROCKET_WALLET_TZ },
        jobId: 'shiprocket-wallet-sync-cron',
        attempts: 1,
        removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
      },
    );
    // The nightly invoice check: reads only, ONE attempt for the same reason.
    await this.queue.add(
      JOB_SHIPROCKET_INVOICE_CHECK,
      { manual: false },
      {
        repeat: { pattern: SHIPROCKET_INVOICE_CRON, tz: SHIPROCKET_WALLET_TZ },
        jobId: 'shiprocket-invoice-check-cron',
        attempts: 1,
        removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
      },
    );

    this.worker = new Worker(
      SHIPROCKET_PORTAL_QUEUE,
      async (job: Job<{ manual?: boolean }>): Promise<void> => {
        const trigger = job.data.manual === true ? 'MANUAL' : 'SCHEDULE';
        if (job.name === JOB_SHIPROCKET_PORTAL_PROBE) {
          await this.probe.probe(trigger);
          return;
        }
        if (job.name === JOB_SHIPROCKET_WALLET_SYNC) {
          await this.wallet.sync(trigger);
          return;
        }
        if (job.name === JOB_SHIPROCKET_INVOICE_CHECK) {
          await this.invoices.check(trigger);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown shiprocket-portal job; ignoring');
      },
      // One at a time: two browsers signing in to one account at once is
      // how a session gets invalidated.
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(ShiprocketPortalWorker.name, job, err);
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(ShiprocketPortalWorker.name, err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}
