import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AssistantEvalGateService } from '../services/assistant-eval-gate.service';
import { AssistantRecommendationService } from '../services/assistant-recommendation.service';

export const ASSISTANT_RECOMMENDATION_QUEUE = 'assistant-recommendations';
export const JOB_RECOMMENDATION_DRAFT = 'assistant-recommendation-draft';
export const JOB_RECOMMENDATION_CHECK = 'assistant-recommendation-check';
/**
 * Owner, 2026-11-14 ("yes chain it"): draft from the monitor's new themes
 * automatically after its nightly pass. The monitor must never import
 * recommendation code (assistant-monitor-isolation.spec), so this side PULLS:
 * an hourly check that drafts only themes with no recommendation yet. With
 * nothing new it returns before any model call, so an idle hour costs nothing;
 * it runs only while the monitor is switched on, and every draft is budgeted
 * on the monitor's line. Drafts still wait for the owner's approval.
 */
export const JOB_RECOMMENDATION_AUTO_DRAFT = 'assistant-recommendation-auto-draft';
export const RECOMMENDATION_AUTO_DRAFT_CRON = '15 * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 24 * 60 * 60, count: 50 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 50 },
};

/**
 * Drafting runs on a person's button press AND hourly after the monitor's
 * themes land (owner chained it 2026-11-14; drafts only, never live). The
 * eval gate for one draft runs only on a person's button press. Queued,
 * never run inside the request (MUST #9).
 */
@Injectable()
export class AssistantRecommendationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantRecommendationWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly issues: SystemIssueService,
    private readonly recs: AssistantRecommendationService,
    private readonly gate: AssistantEvalGateService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(ASSISTANT_RECOMMENDATION_QUEUE, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Registered by every instance (stable job id makes that idempotent); consumed by one (SCALE-1).
    await this.queue.add(
      JOB_RECOMMENDATION_AUTO_DRAFT,
      {},
      {
        repeat: { pattern: RECOMMENDATION_AUTO_DRAFT_CRON },
        jobId: `${JOB_RECOMMENDATION_AUTO_DRAFT}-cron`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    if (!this.workerRole.shouldStart(AssistantRecommendationWorker.name)) return;
    this.worker = new Worker(
      ASSISTANT_RECOMMENDATION_QUEUE,
      async (job: Job): Promise<void> => {
        switch (job.name) {
          case JOB_RECOMMENDATION_DRAFT:
            await this.recs.draftFromThemes();
            return;
          case JOB_RECOMMENDATION_AUTO_DRAFT:
            await this.recs.autoDraftFromThemes();
            return;
          case JOB_RECOMMENDATION_CHECK: {
            const runId = (job.data as { runId?: unknown }).runId;
            if (typeof runId === 'string') await this.gate.execute(runId);
            return;
          }
          default:
            return;
        }
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(AssistantRecommendationWorker.name, job, err);
      this.logger.warn(
        { jobId: job?.id, err: err?.message },
        'Assistant recommendation job failed',
      );
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(AssistantRecommendationWorker.name, err);
      this.logger.error({ err: err.message }, 'Assistant recommendation worker error');
    });
  }

  async enqueueDraft(): Promise<void> {
    // One pending drafting job at a time: a second click joins it.
    await this.queue.add(JOB_RECOMMENDATION_DRAFT, {}, { attempts: 1 });
  }

  async enqueueCheck(runId: string): Promise<void> {
    await this.queue.add(
      JOB_RECOMMENDATION_CHECK,
      { runId },
      { attempts: 1, jobId: `check-${runId}` },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
