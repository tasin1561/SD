import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export const MARGIN_QUEUE_NAME = 'courier-margin-pricing';
export const JOB_PRICE_UNPRICED = 'margin-price-unpriced';

/**
 * Overnight, in the timezone the warehouse is actually in.
 *
 * The droplet runs UTC, so a bare `0 2 * * *` fires at 07:30 IST — the
 * middle of the working day, competing with the tracking poll and the
 * AWB jobs for the same rate-limited courier. `tz` is what makes "2am"
 * mean 2am. The same trap the NDR queue documents at length; it is
 * repeated here rather than referenced because the next person adding a
 * schedule will copy THIS file.
 */
export const MARGIN_TIMEZONE = 'Asia/Kolkata';

/** 02:40 — after the wallet-ledger sync, before anyone is working. */
const MARGIN_CRON = '40 2 * * *';

@Injectable()
export class MarginPricingQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarginPricingQueue.name);
  private queue!: Queue;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(MARGIN_QUEUE_NAME, { connection: this.redis.createConnection() });

    // Repeatable jobs are keyed on (name, pattern, tz), so changing the
    // schedule leaves the old one registered and adds a second nightly
    // run rather than moving the first.
    for (const r of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(r.key);
    }

    await this.queue.add(
      JOB_PRICE_UNPRICED,
      {},
      {
        repeat: { pattern: MARGIN_CRON, tz: MARGIN_TIMEZONE },
        removeOnComplete: 30,
        removeOnFail: 60,
      },
    );
    this.logger.log(`Margin pricing scheduled ("${MARGIN_CRON}", tz=${MARGIN_TIMEZONE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
