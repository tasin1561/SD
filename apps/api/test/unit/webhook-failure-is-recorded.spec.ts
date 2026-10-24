import { WebhookStatus } from '@skydrop/db';

import { WebhookProcessorService } from '../../src/modules/tracking-ingestion/services/webhook-processor.service';

/**
 * TRK-11: a job that throws must leave a trace ON THE ROW.
 *
 * Before this, a thrown job wrote nothing at all — no message, no
 * counter, no status — so a webhook whose processing died looked
 * exactly like one that was never enqueued. Seven Shiprocket scans sat
 * at RECEIVED for six weeks and had to be diagnosed from a git commit,
 * while the watchdog that found them selected `errorMessage` only to
 * report null for every row.
 *
 * The assertion that matters most here is the NEGATIVE one: the row
 * stays at RECEIVED. Moving a failure to `WebhookStatus.FAILED` is the
 * obvious-looking change and it would break two things at once — the
 * TRK-11 watchdog counts RECEIVED, so the dropped scan would vanish
 * from the only detector built to find it; and TRK-2's master gate is
 * `status !== RECEIVED`, so the row could never be replayed.
 */
describe('WebhookProcessorService.recordProcessingFailure', () => {
  const WEBHOOK_ID = '019f8dda-d1cc-75a8-988d-df978ed68122';

  const makeService = (updateMany: jest.Mock): WebhookProcessorService =>
    Object.assign(Object.create(WebhookProcessorService.prototype) as WebhookProcessorService, {
      prisma: { client: { courierWebhook: { updateMany } } },
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });

  it('records the message and counts the attempt', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = makeService(updateMany);

    await svc.recordProcessingFailure(WEBHOOK_ID, new Error('Invalid Date'));

    const args = updateMany.mock.calls[0]?.[0];
    expect(args.data.errorMessage).toBe('Invalid Date');
    expect(args.data.retryCount).toEqual({ increment: 1 });
    expect(args.data.errorStack).toEqual(expect.any(String));
  });

  it('leaves the row at RECEIVED so the watchdog and a replay can still see it', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = makeService(updateMany);

    await svc.recordProcessingFailure(WEBHOOK_ID, new Error('boom'));

    const args = updateMany.mock.calls[0]?.[0];
    // Guarded like every other writer in the processor.
    expect(args.where).toEqual({ id: WEBHOOK_ID, status: WebhookStatus.RECEIVED });
    // The row must NOT be moved out of RECEIVED, and must NOT be given
    // a processedAt — either would hide a dropped scan.
    expect(args.data.status).toBeUndefined();
    expect(args.data.processedAt).toBeUndefined();
  });

  it('handles a non-Error throw without losing the message', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = makeService(updateMany);

    await svc.recordProcessingFailure(WEBHOOK_ID, 'a string was thrown');

    expect(updateMany.mock.calls[0]?.[0].data.errorMessage).toBe('a string was thrown');
  });

  it('never throws on its own — the job must fail with ITS error, not this one', async () => {
    // If recording the note threw, it would replace the real failure and
    // BullMQ would retry against the wrong diagnosis.
    const updateMany = jest.fn().mockRejectedValue(new Error('database is down'));
    const svc = makeService(updateMany);

    await expect(svc.recordProcessingFailure(WEBHOOK_ID, new Error('real cause'))).resolves.toBe(
      undefined,
    );
  });

  it('caps a pathological message so the watchdog listing stays readable', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = makeService(updateMany);

    await svc.recordProcessingFailure(WEBHOOK_ID, new Error('x'.repeat(10_000)));

    expect(updateMany.mock.calls[0]?.[0].data.errorMessage.length).toBe(2_000);
  });
});
