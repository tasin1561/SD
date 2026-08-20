import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { AgentPresenceService } from '../services/agent-presence.service';
import { AGENT_PRESENCE_QUEUE_NAME, JOB_SWEEP_PRESENCE } from './agent-presence.queue';

/**
 * Stands down agents who are marked available but are not at the desk,
 * returning whatever they hold to the queue. See AgentPresenceService
 * for why availability has to expire rather than simply be stored.
 *
 * The sweep is naturally idempotent — it only ever acts on rows still
 * matching "available and not seen since the cutoff" — so a BullMQ retry
 * or a duplicate delivery cannot double-stand-down anyone.
 */
@Injectable()
export class AgentPresenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentPresenceWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly presence: AgentPresenceService,
    private readonly workerRole: WorkerRoleService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance runs workers.
    if (!this.workerRole.shouldStart(AgentPresenceWorker.name)) return;
    this.worker = new Worker(
      AGENT_PRESENCE_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name === JOB_SWEEP_PRESENCE) {
          await this.presence.sweep();
          return;
        }
        this.logger.warn({ name: job.name }, 'Unknown agent-presence job; ignoring');
      },
      { connection: this.redis.createConnection(), concurrency: 1 },
    );
    this.worker.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Agent-presence worker error');
    });
    this.logger.log('Agent-presence worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
