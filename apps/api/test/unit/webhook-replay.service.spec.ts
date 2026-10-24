import { ConflictException, NotFoundException } from '@nestjs/common';
import { WebhookStatus } from '@skydrop/db';

import { WebhookReplayService } from '../../src/modules/tracking-ingestion/services/webhook-replay.service';

/**
 * TRK-11's other half: the hand-operated replay.
 *
 * What these pin is the part that is easy to get wrong later — that a
 * replay refuses any row the processor would refuse anyway, that it
 * never silently reports success, and that it leaves an audit trail
 * saying who pressed it and why. The safety of the replay ITSELF is
 * TRK-2/3/4's job and is covered where those live.
 */
describe('WebhookReplayService', () => {
  const WEBHOOK_ID = '019f8dda-d1cc-75a8-988d-df978ed68122';
  const STAFF_ID = '019fad7a-bf7e-7679-8665-67f27bd7cf12';
  const REASON = 'Parser bug fixed; applying the scan this job dropped.';

  const makeDeps = (row: unknown) => {
    const findUnique = jest.fn().mockResolvedValue(row);
    const findMany = jest.fn().mockResolvedValue([]);
    const replayWebhook = jest.fn().mockResolvedValue({ jobId: 'job-1', alreadyQueued: false });
    const log = jest.fn().mockResolvedValue('audit-1');
    const svc = new WebhookReplayService(
      { client: { courierWebhook: { findUnique, findMany } } } as never,
      { replayWebhook } as never,
      { log } as never,
    );
    return { svc, findUnique, findMany, replayWebhook, log };
  };

  const receivedRow = {
    id: WEBHOOK_ID,
    status: WebhookStatus.RECEIVED,
    courierCode: 'shiprocket',
    awbNumber: '80156885583',
  };

  it('hands a RECEIVED webhook back to the queue', async () => {
    const { svc, replayWebhook } = makeDeps(receivedRow);

    const result = await svc.replay(WEBHOOK_ID, STAFF_ID, REASON);

    expect(replayWebhook).toHaveBeenCalledWith(WEBHOOK_ID);
    expect(result).toEqual({ webhookId: WEBHOOK_ID, jobId: 'job-1', alreadyQueued: false });
  });

  it('records who replayed it and why', async () => {
    const { svc, log } = makeDeps(receivedRow);

    await svc.replay(WEBHOOK_ID, STAFF_ID, REASON);

    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      action: 'tracking.webhook_replayed',
      entityType: 'courier_webhook',
      entityId: WEBHOOK_ID,
      actorId: STAFF_ID,
    });
    // The reason is the whole point of requiring one: a six-week-old
    // scan being applied now has to explain itself to the next reader.
    expect(entry.metadata).toMatchObject({ reason: REASON, courierCode: 'shiprocket' });
  });

  it('refuses a webhook that is already PROCESSED, rather than no-opping quietly', async () => {
    // TRK-2's master gate would make this a no-op in the processor, so a
    // silent "queued!" would tell the operator their stale screen was
    // right. Saying so is the useful answer.
    const { svc, replayWebhook } = makeDeps({
      ...receivedRow,
      status: WebhookStatus.PROCESSED,
    });

    await expect(svc.replay(WEBHOOK_ID, STAFF_ID, REASON)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(replayWebhook).not.toHaveBeenCalled();
  });

  it('refuses an IGNORED webhook too', async () => {
    const { svc, replayWebhook } = makeDeps({ ...receivedRow, status: WebhookStatus.IGNORED });

    await expect(svc.replay(WEBHOOK_ID, STAFF_ID, REASON)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(replayWebhook).not.toHaveBeenCalled();
  });

  it('404s an unknown id without touching the queue', async () => {
    const { svc, replayWebhook, log } = makeDeps(null);

    await expect(svc.replay(WEBHOOK_ID, STAFF_ID, REASON)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(replayWebhook).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('reports a job that was already queued instead of claiming a fresh one', async () => {
    const { svc, replayWebhook } = makeDeps(receivedRow);
    replayWebhook.mockResolvedValue({ jobId: 'job-existing', alreadyQueued: true });

    const result = await svc.replay(WEBHOOK_ID, STAFF_ID, REASON);

    expect(result.alreadyQueued).toBe(true);
    expect(result.jobId).toBe('job-existing');
  });

  it('lists only webhooks still stuck at RECEIVED, oldest first', async () => {
    const { svc, findMany } = makeDeps(receivedRow);

    await svc.listUnprocessed();

    const args = findMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({ status: WebhookStatus.RECEIVED });
    expect(args.orderBy).toEqual({ receivedAt: 'asc' });
    // The error the worker now records is the reason this listing is
    // worth reading at all.
    expect(args.select.errorMessage).toBe(true);
  });
});
