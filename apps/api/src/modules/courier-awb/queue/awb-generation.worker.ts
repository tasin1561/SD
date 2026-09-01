import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { wafAwareBackoff } from '../../courier-delhivery/util/waf-backoff';
import { AwbGenerationJobService } from '../services/awb-generation-job.service';
import {
  AWB_BACKOFF_STRATEGY,
  AWB_GENERATION_QUEUE_NAME,
  AwbGenerationQueue,
  JOB_GENERATE_MANIFEST_AWBS,
  JOB_GENERATE_ORDER_AWB,
  type AwbGenerationJob,
  type GenerateManifestAwbsJob,
  type GenerateOrderAwbJob,
} from './awb-generation.queue';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';

/**
 * In-process AWB-generation worker (Phase 1A pattern, mirrors M7/M8
 * expiration workers). Delegates to AwbGenerationJobService.processManifest,
 * which is idempotent (CUR-2/CUR-9) — a stale / re-delivered job re-runs
 * safely (already-AWB'd shipments skipped, superseded ones self-detached,
 * an already-CONFIRMED/FAILED manifest is a no-op).
 *
 * The custom `awb-per-attempt` backoff strategy maps BullMQ's attempt
 * counter onto the courier.awb_job_retry_backoff_ms array.
 */
@Injectable()
export class AwbGenerationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AwbGenerationWorker.name);
  private worker!: Worker<AwbGenerationJob>;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly jobService: AwbGenerationJobService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Only the queue-owning instance starts workers; every other
    // API instance serves HTTP only. See WorkerRoleService.
    if (!this.workerRole.shouldStart(AwbGenerationWorker.name)) return;
    const backoffMs = await AwbGenerationQueue.resolveBackoffMs(this.prisma);

    this.worker = new Worker<AwbGenerationJob>(
      AWB_GENERATION_QUEUE_NAME,
      async (job: Job<AwbGenerationJob>): Promise<void> => {
        if (job.name === JOB_GENERATE_MANIFEST_AWBS) {
          await this.jobService.processManifest((job.data as GenerateManifestAwbsJob).manifestId);
          return;
        }
        if (job.name === JOB_GENERATE_ORDER_AWB) {
          await this.jobService.processOrder((job.data as GenerateOrderAwbJob).orderId);
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown AWB-generation job; ignoring');
      },
      {
        connection: this.redis.createConnection(),
        concurrency: 1,
        settings: {
          // Custom per-attempt backoff over courier.awb_job_retry_backoff_ms,
          // EXCEPT on an AWS WAF 403, where the configured schedule
          // ([1000,5000,15000]) would spend every attempt inside the 30s
          // block window and re-hit the WAF each time — see waf-backoff.ts.
          backoffStrategy: wafAwareBackoff(backoffMs),
        },
      },
    );

    this.worker.on('failed', (job, err) => {
      // Only once BullMQ has stopped retrying: an exhausted job is
      // work that definitively did not happen.
      void this.issues.reportJobFailure(AwbGenerationWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'AWB-generation job failed (will retry per BullMQ policy)',
      );
    });
    this.worker.on('error', (err) => {
      // Say it where somebody will see it: a worker erroring
      // breaks no screen, the work simply stops happening.
      void this.issues.reportWorkerError(AwbGenerationWorker.name, err);
      this.logger.error({ err: err.message }, 'AWB-generation worker error');
    });
    this.logger.log(
      `AWB-generation worker ready (queue=${AWB_GENERATION_QUEUE_NAME}, backoff=${AWB_BACKOFF_STRATEGY})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
