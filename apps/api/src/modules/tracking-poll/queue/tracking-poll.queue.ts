import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export const TRACKING_POLL_QUEUE_NAME = 'tracking-poll';
export const JOB_POLL_TRACKING = 'poll-tracking';
/** Default cadence — every 20 minutes. Overridable via the
 *  `courier.tracking_poll_cron` system_setting (no seed required; the
 *  fallback applies when the key is absent). */
export const DEFAULT_POLL_CRON = '*/20 * * * *';
const POLL_CRON_KEY = 'courier.tracking_poll_cron';

/**
 * Module 10 (poll) — repeatable BullMQ cron that fires the Delhivery
 * tracking poll. Stable jobId ('tracking-poll-cron') so re-registering
 * on every boot is idempotent (BullMQ dedups the repeat schedule by
 * key — same pattern as the reservation auto-release + image crons).
 *
 * The poll itself is inert in stub mode (TrackingPollService short-
 * circuits), so this cron is harmless to run in every environment; it
 * only does real work once real mode (the go-live setting) is on.
 */
@Injectable()
export class TrackingPollQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingPollQueue.name);
  private queue!: Queue;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(TRACKING_POLL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    });

    const cron = await this.resolveCron();
    await this.queue.add(
      JOB_POLL_TRACKING,
      {},
      {
        repeat: { pattern: cron },
        jobId: 'tracking-poll-cron',
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    );
    this.logger.log(
      `tracking-poll queue ready (name=${TRACKING_POLL_QUEUE_NAME}, cron=${cron})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  private async resolveCron(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: POLL_CRON_KEY },
      select: { valueString: true },
    });
    const v = (row?.valueString ?? '').trim();
    return v !== '' ? v : DEFAULT_POLL_CRON;
  }
}
