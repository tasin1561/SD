import { CallQueueStatus } from '@skydrop/db';
import { AdminCallQueueService } from '../../src/modules/call-center/services/admin-call-queue.service';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';

/**
 * Moving WHEN a queued call becomes callable.
 *
 * The only thing that set `available_at` was the re-queue after an
 * attempt, computed from the outcome — so a supervisor watching an order
 * sit four hours out had no way to bring it forward when the customer
 * rang back. Force-outcome was the only lever, and it works by RECORDING
 * a conversation that did not happen.
 *
 * The load-bearing property is what it does NOT touch: the attempt
 * count. This is scheduling, not a claim about whether a call was made.
 */
describe('AdminCallQueueService.reschedule', () => {
  function make(entry: { status: CallQueueStatus; availableAt?: Date } | null) {
    const findUnique = jest.fn().mockResolvedValue(
      entry === null
        ? null
        : {
            id: 'q1',
            orderId: 'o1',
            status: entry.status,
            availableAt: entry.availableAt ?? new Date('2026-08-20T10:00:00Z'),
          },
    );
    const update = jest
      .fn()
      .mockImplementation(async ({ data }: { data: { availableAt: Date } }) => ({
        id: 'q1',
        availableAt: data.availableAt,
        status: entry?.status ?? CallQueueStatus.PENDING,
      }));
    const log = jest.fn().mockResolvedValue('a1');
    const svc = new AdminCallQueueService(
      { client: { callQueueEntry: { findUnique, update } } } as never,
      { log } as never,
      {} as never,
      {} as never,
      {} as never,
      new CallOutcomeMappingService(),
      // Cap resolution is CallCapService's job and irrelevant here.
      {
        grantedExtraByOrder: jest.fn(async () => new Map()),
        baseForSeller: jest.fn(async () => 3),
      } as never,
    );
    return { svc, update, log };
  }

  it('moves the time and NOTHING else', async () => {
    const { svc, update } = make({ status: CallQueueStatus.PENDING });
    const when = new Date(Date.now() + 3600_000);
    await svc.reschedule('q1', when, 'Customer rang back', 'admin-1');

    // Only availableAt. Touching scheduledAttempts or the status here
    // would make a scheduling tool quietly spend a customer's chances.
    expect(update.mock.calls[0]?.[0].data).toEqual({ availableAt: when });
  });

  it('accepts a PAST time — that is how a call is brought forward', async () => {
    const { svc, update } = make({ status: CallQueueStatus.PENDING });
    const past = new Date(Date.now() - 60_000);
    await svc.reschedule('q1', past, 'Customer is on the line now', 'admin-1');
    // Deliberately not clamped to now: it differs only in a value
    // nobody reads, and pullNext's predicate is `available_at <= now()`.
    expect(update.mock.calls[0]?.[0].data.availableAt).toBe(past);
  });

  it('works on an ASSIGNED entry too', async () => {
    // No effect while an agent holds it — available_at is only read when
    // choosing what to hand out — but it is the right value for when the
    // entry returns, and refusing would force a supervisor to wait for
    // an expiry before they could act.
    const { svc, update } = make({ status: CallQueueStatus.ASSIGNED });
    await svc.reschedule('q1', new Date(), 'Agent is off shift', 'admin-1');
    expect(update).toHaveBeenCalled();
  });

  it('refuses a closed entry', async () => {
    const { svc } = make({ status: CallQueueStatus.COMPLETED });
    await expect(svc.reschedule('q1', new Date(), 'anything', 'admin-1')).rejects.toMatchObject({
      response: { code: 'ENTRY_NOT_OPEN' },
    });
  });

  it('refuses a date past the ceiling — a year out is a typo', async () => {
    const { svc } = make({ status: CallQueueStatus.PENDING });
    const farFuture = new Date(Date.now() + 200 * 24 * 60 * 60_000);
    await expect(svc.reschedule('q1', farFuture, 'oops', 'admin-1')).rejects.toMatchObject({
      response: { code: 'RESCHEDULE_TOO_FAR' },
    });
  });

  it('audits the move with both times and the reason', async () => {
    const { svc, log } = make({
      status: CallQueueStatus.PENDING,
      availableAt: new Date('2026-08-20T10:00:00Z'),
    });
    const when = new Date('2026-08-20T12:00:00Z');
    await svc.reschedule('q1', when, 'Customer asked for noon', 'admin-1');
    const entry = log.mock.calls[0]?.[0];
    expect(entry.action).toBe('call_queue.rescheduled');
    expect(entry.severity).toBe('MEDIUM');
    expect(entry.metadata.from).toBe('2026-08-20T10:00:00.000Z');
    expect(entry.metadata.to).toBe('2026-08-20T12:00:00.000Z');
    expect(entry.metadata.reason).toBe('Customer asked for noon');
  });
});
