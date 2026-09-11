import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketPortalProbeService } from '../services/shiprocket-portal-probe.service';

/**
 * Restated in `shiprocket-cost-sync/services/shiprocket-portal-trigger.service.ts`
 * rather than imported — the API must not reach into this module (the
 * portal owns a browser). `shiprocket-portal-queue-names.spec.ts` fails if
 * the two copies drift; drift here has no symptom but a button that
 * queues into nothing.
 */
export const SHIPROCKET_PORTAL_QUEUE = 'shiprocket-portal';
export const JOB_SHIPROCKET_PORTAL_PROBE = 'probe-shiprocket-portal';

@Injectable()
export class ShiprocketPortalWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShiprocketPortalWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly probe: ShiprocketPortalProbeService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // Only the portal process drives a browser (see WorkerRoleService).
    if (!this.workerRole.shouldStartPortal(ShiprocketPortalWorker.name)) return;
    this.worker = new Worker(
      SHIPROCKET_PORTAL_QUEUE,
      async (job: Job<{ manual?: boolean }>): Promise<void> => {
        if (job.name === JOB_SHIPROCKET_PORTAL_PROBE) {
          await this.probe.probe(job.data.manual === true ? 'MANUAL' : 'SCHEDULE');
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
  }
}
