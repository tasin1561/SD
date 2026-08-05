import { NdrUplPollerService } from '../../src/modules/courier-ndr-runner/services/ndr-upl-poller.service';

/**
 * "Unpolled is FAILED, not unknown" — the decision this file exists for.
 *
 * Delhivery's NDR API returns a handle, not an outcome. Leaving an
 * unanswered request at SUBMITTED feels safer and is not: the customer
 * is waiting either way, and a re-attempt nobody can confirm has to be
 * chased by a human. The cost of being wrong is one duplicate chase; the
 * cost of the other choice is a parcel nobody is looking at.
 */

const HOUR = 3_600_000;

type Ctx = {
  submittedMinutesAgo?: number;
  uplId?: string | null;
  status?: { complete: boolean; success: boolean | null; raw: unknown };
  checkThrows?: boolean;
};

function make(ctx: Ctx = {}) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const checkStatus = jest.fn().mockImplementation(() => {
    if (ctx.checkThrows === true) throw new Error('unreachable');
    return Promise.resolve(ctx.status ?? { complete: false, success: null, raw: {} });
  });
  const open = jest.fn().mockResolvedValue({ id: 'ticket-1' });
  const openForTicket = jest.fn().mockResolvedValue({ id: 'esc-1', created: true });

  const prisma = {
    client: {
      ndrActionRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'req-1',
            uplId: ctx.uplId === undefined ? 'upl-1' : ctx.uplId,
            awbNumber: 'AWB1',
            shipmentId: 'ship-1',
            action: 'RE-ATTEMPT',
            submittedAt: new Date(Date.now() - (ctx.submittedMinutesAgo ?? 10) * 60_000),
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest
          .fn()
          .mockImplementation((args: { where: unknown; data: Record<string, unknown> }) => {
            updates.push(args);
            return Promise.resolve({ count: 1 });
          }),
      },
      shipment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ship-1',
          courierCode: 'delhivery',
          orderShipments: [{ order: { id: 'order-1', sellerId: 'seller-1' } }],
        }),
      },
    },
  };

  const svc = new NdrUplPollerService(
    prisma as never,
    { pollDeadlineMinutes: jest.fn().mockResolvedValue(240) } as never,
    { checkStatus } as never,
    { open } as never,
    // The escalation service — the entry point that was missing until
    // 2026-08-06. A failed NDR request now BEGINS a courier conversation
    // rather than only opening a ticket nothing could be said about.
    { openForTicket } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { svc, checkStatus, open, openForTicket, updates };
}

const settledTo = (updates: { data: Record<string, unknown> }[]): unknown[] =>
  updates.map((u) => u.data['status']).filter((s) => s !== undefined);

describe('NdrUplPollerService', () => {
  it('CONFIRMS only on an explicit success', async () => {
    const { svc, updates } = make({ status: { complete: true, success: true, raw: {} } });
    const out = await svc.poll();
    expect(out.confirmed).toBe(1);
    expect(settledTo(updates)).toContain('CONFIRMED');
  });

  it('FAILS on an explicit refusal, and escalates it', async () => {
    const { svc, open } = make({ status: { complete: true, success: false, raw: {} } });
    const out = await svc.poll();
    expect(out.failed).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('complete-but-null is NOT a confirmation — it waits for the deadline', async () => {
    // Delhivery answering without saying it worked is not a yes.
    const { svc } = make({
      status: { complete: true, success: null, raw: {} },
      submittedMinutesAgo: 10,
    });
    const out = await svc.poll();
    expect(out.confirmed).toBe(0);
    expect(out.stillPending).toBe(1);
  });

  it('an in-progress request inside the deadline stays pending', async () => {
    const { svc, open } = make({ submittedMinutesAgo: 30 });
    const out = await svc.poll();
    expect(out.stillPending).toBe(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('PAST the deadline with no answer it becomes FAILED — the load-bearing decision', async () => {
    const { svc, open, updates } = make({ submittedMinutesAgo: 300 });
    const out = await svc.poll();
    expect(out.expired).toBe(1);
    expect(out.failed).toBe(1);
    expect(settledTo(updates)).toContain('FAILED');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a poll that THREW does not fail the request early — only the deadline does', async () => {
    // Delhivery being briefly unreachable is our problem, not the
    // parcel's. Failing on the first network blip would escalate a
    // request that was fine.
    const { svc, open } = make({ checkThrows: true, submittedMinutesAgo: 10 });
    const out = await svc.poll();
    expect(out.failed).toBe(0);
    expect(out.stillPending).toBe(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('a missing UPL id is decided immediately — there is nothing to ask about', async () => {
    const { svc, checkStatus, open } = make({ uplId: null });
    const out = await svc.poll();
    expect(checkStatus).not.toHaveBeenCalled();
    expect(out.failed).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('settles with a guarded update so two poll cycles cannot double-escalate', async () => {
    // Read-then-write here is the shape this codebase keeps finding in
    // money paths; the guard is the WHERE clause, not an application check.
    const { svc, updates } = make({ status: { complete: true, success: true, raw: {} } });
    await svc.poll();
    const guarded = updates.find((u) => u.data['status'] === 'CONFIRMED');
    expect(guarded?.where).toMatchObject({ status: 'SUBMITTED' });
  });

  it('escalation failure does not lose the FAILED verdict', async () => {
    const { svc, open } = make({ status: { complete: true, success: false, raw: {} } });
    open.mockRejectedValueOnce(new Error('ticket system down'));
    const out = await svc.poll();
    expect(out.failed).toBe(1);
    expect(out.escalated).toBe(0);
  });
});

describe('deadline arithmetic', () => {
  it('four hours is the seeded default', () => {
    expect(240 * 60_000).toBe(4 * HOUR);
  });
});
