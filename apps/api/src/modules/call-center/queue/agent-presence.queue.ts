import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const AGENT_PRESENCE_QUEUE_NAME = 'call-agent-presence';
export const JOB_SWEEP_PRESENCE = 'sweep-agent-presence';

/**
 * Every minute. The presence window is measured in minutes and an agent
 * who has left is holding a customer's order the whole time, so a
 * coarser schedule would just add its own interval to the delay.
 */
export const AGENT_PRESENCE_CRON = '* * * * *';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 60 * 60, count: 100 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
};

/** Producer half of the presence sweep; the worker consumes it. */
@Injectable()
export class AgentPresenceQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentPresenceQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(AGENT_PRESENCE_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Stable jobId ⇒ re-registering on every boot is idempotent.
    await this.queue.add(
      JOB_SWEEP_PRESENCE,
      {},
      {
        repeat: { pattern: AGENT_PRESENCE_CRON },
        jobId: 'call-agent-presence-sweep',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(`Agent-presence sweep scheduled; cron=${AGENT_PRESENCE_CRON}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
