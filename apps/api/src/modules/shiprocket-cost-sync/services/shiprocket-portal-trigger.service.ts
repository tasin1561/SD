import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../../../infrastructure/redis/redis.service';

/**
 * The queue and job the PORTAL worker listens on for Shiprocket.
 *
 * Restated, not imported: `CourierPortalModule` is unreachable from the
 * API by design (it owns a browser holding a courier login), and
 * importing it for two strings would break that. `shiprocket-portal-queue-names.spec.ts`
 * fails if these drift from the worker's copy.
 */
export const SHIPROCKET_PORTAL_QUEUE = 'shiprocket-portal';
export const JOB_SHIPROCKET_PORTAL_PROBE = 'probe-shiprocket-portal';
export const JOB_SHIPROCKET_WALLET_SYNC = 'sync-shiprocket-wallet';
export const JOB_SHIPROCKET_INVOICE_CHECK = 'check-shiprocket-invoices';

@Injectable()
export class ShiprocketPortalTriggerService {
  constructor(private readonly redis: RedisService) {}

  /** Queued, not finished: a sign-in and three pages take a minute or two. */
  requestProbe(): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    return this.enqueue(JOB_SHIPROCKET_PORTAL_PROBE);
  }

  /** The nightly wallet sync, now. Queued: about three minutes of reading. */
  requestWalletSync(): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    return this.enqueue(JOB_SHIPROCKET_WALLET_SYNC);
  }

  /** The nightly invoice check, now. Queued: a sign-in, the list and each itemized file. */
  requestInvoiceCheck(): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    return this.enqueue(JOB_SHIPROCKET_INVOICE_CHECK);
  }

  private async enqueue(
    jobName: string,
  ): Promise<{ readonly queued: boolean; readonly jobId: string | null }> {
    const queue = new Queue(SHIPROCKET_PORTAL_QUEUE, { connection: this.redis.createConnection() });
    try {
      const job = await queue.add(
        jobName,
        { manual: true },
        {
          // ONE attempt: a retry loop against a courier's login page is how
          // an account gets locked.
          attempts: 1,
          removeOnComplete: { age: 14 * 24 * 60 * 60, count: 30 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 60 },
        },
      );
      return { queued: true, jobId: job.id ?? null };
    } finally {
      // Request-scoped producer: closed every time, or each click leaks a
      // connection.
      await queue.close();
    }
  }
}
