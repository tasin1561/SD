import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { NdrSettingsService } from '../services/ndr-settings.service';

export const NDR_QUEUE_NAME = 'courier-ndr';
export const JOB_NIGHTLY_RUN = 'ndr-nightly-run';
export const JOB_POLL_UPLS = 'ndr-poll-upls';
export const JOB_RECONCILE = 'ndr-reconcile';

/**
 * The timezone every schedule in this file is evaluated in.
 *
 * ── THIS IS THE MOST IMPORTANT LINE IN THE MODULE ────────────────────
 * The droplet runs UTC, and no other queue in this codebase passes `tz`.
 * Without it, `35 21 * * *` fires at 21:35 UTC — which is 03:35 in
 * Dhaka, five and a half hours BEFORE Delhivery's 21:00 IST cutoff. Every
 * submission would be rejected as out-of-window, the UPL results would
 * be uniformly negative, and the symptom would read as "Delhivery is
 * ignoring our re-attempts". Nothing would crash, no test would fail,
 * and the diagnosis would take weeks because the cron string is
 * correct — it is the frame of reference that is wrong.
 *
 * `ndr-schedule.spec.ts` asserts the RESOLVED next-run instant rather
 * than this string, because a test on the string passes under exactly
 * this bug.
 */
export const NDR_TIMEZONE = 'Asia/Dhaka';

@Injectable()
export class NdrQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NdrQueue.name);
  private queue!: Queue;

  constructor(
    private readonly redis: RedisService,
    private readonly settings: NdrSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(NDR_QUEUE_NAME, { connection: this.redis.createConnection() });

    const [runnerCron, pollCron, reconcileCron] = await Promise.all([
      this.settings.runnerCron(),
      this.settings.pollCron(),
      this.settings.reconcileCron(),
    ]);

    // Repeatable jobs are keyed on (name, pattern, tz): changing the
    // setting leaves the OLD schedule registered, so each is removed
    // before being re-added. Otherwise editing the cron adds a second
    // nightly run rather than moving the first.
    await this.clearRepeatables();

    await this.queue.add(
      JOB_NIGHTLY_RUN,
      {},
      {
        repeat: { pattern: runnerCron, tz: NDR_TIMEZONE },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );
    await this.queue.add(
      JOB_POLL_UPLS,
      {},
      { repeat: { pattern: pollCron, tz: NDR_TIMEZONE }, removeOnComplete: 50, removeOnFail: 100 },
    );
    await this.queue.add(
      JOB_RECONCILE,
      {},
      {
        repeat: { pattern: reconcileCron, tz: NDR_TIMEZONE },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );

    this.logger.log(
      `NDR queue ready (runner="${runnerCron}", poll="${pollCron}", reconcile="${reconcileCron}", tz=${NDR_TIMEZONE})`,
    );
  }

  private async clearRepeatables(): Promise<void> {
    for (const r of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(r.key);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }
}
