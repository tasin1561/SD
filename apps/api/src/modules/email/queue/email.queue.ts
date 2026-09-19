import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { emailRetired } from '../../../common/notifications/retired-email-templates';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { EmailDispatchInput } from '../email.types';

export const EMAIL_QUEUE_NAME = 'email';
export const EMAIL_JOB_NAME = 'send';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 }, // 30s, 1m, 2m, 4m, 8m
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};

@Injectable()
export class EmailQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueue.name);
  private queue!: Queue<EmailDispatchInput>;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<EmailDispatchInput>(EMAIL_QUEUE_NAME, {
      connection: this.redis.createConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`Email queue ready (name=${EMAIL_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) await this.queue.close();
  }

  /**
   * Enqueues an email send job. Returns the BullMQ job id, or the empty
   * string when the template's email leg has been retired.
   *
   * THE BACKSTOP for `RETIRED_EMAIL_TEMPLATES` (owner, 2026-09-20).
   * Every email in the estate passes through here — the NOTIF-4
   * lifecycle fan-out, the audience dispatcher, and the dozen pre-M11
   * callers that hold an `EmailQueue` of their own — so this is the one
   * place that can promise a retired template is never sent, whoever
   * asks. The ledger gate upstream is what stops a row being written for
   * a send that will not happen; this is what stops the send itself.
   *
   * Callers that create their notification_logs row inside the send (the
   * pre-M11 CREATE path) leave no trace when this refuses, which is
   * correct: nothing was attempted.
   */
  async enqueue(input: EmailDispatchInput, opts?: JobsOptions): Promise<string> {
    // ONLY withheld from somebody who HAS an inbox to read it in.
    //
    // An `id` of null is an ad-hoc address — a shared mailbox an
    // operator pointed a setting at, not an account. There is no inbox
    // behind it, so withholding the mail would not move the message to
    // another channel, it would delete it. The live case is
    // `marketing.lead_notification_email`: empty by default (every
    // SUPER_ADMIN, all of whom have inboxes), and set to something like
    // sales@ when one team should own the queue.
    const hasInbox = input.recipient.id !== null && input.recipient.id !== undefined;
    if (hasInbox && emailRetired(input.templateCode)) {
      this.logger.debug(
        { templateCode: input.templateCode },
        'Email leg retired in favour of the inbox; not enqueued',
      );
      return '';
    }
    const job = await this.queue.add(EMAIL_JOB_NAME, input, opts);
    return String(job.id);
  }

  /**
   * The notification_logs rows that a job in this queue will still act
   * on — waiting, delayed (quiet hours, NOTIF-15, or a retry backoff),
   * running or paused.
   *
   * For the delivery watchdog: a QUEUED row with a live job behind it is
   * not stuck, it is waiting on purpose, and sending it again would mail
   * the recipient twice. Finished jobs are deliberately NOT counted — a
   * failed one will not run again, which is exactly the row the watchdog
   * exists to find.
   */
  async liveNotificationLogIds(): Promise<ReadonlySet<string>> {
    const jobs = await this.queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'prioritized',
      'paused',
      'waiting-children',
    ]);
    const ids = new Set<string>();
    for (const job of jobs) {
      const id = job?.data?.existingNotificationLogId;
      if (id) ids.add(id);
    }
    return ids;
  }
}
