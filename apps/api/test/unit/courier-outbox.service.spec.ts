import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CourierDispatchErrorClass, CourierOutboxStatus, CourierWriteMode } from '@skydrop/db';
import {
  CourierOutboxService,
  classifyDispatchError,
} from '../../src/modules/courier-escalation/services/courier-outbox.service';

/**
 * The three rules the outbox exists to enforce.
 *
 * All three are about NOT posting the same message twice into a thread a
 * customer reads. A duplicate there is invisible to us and permanent to
 * them, which is why none of this is left to a retry policy.
 */

function make(opts: { mode?: CourierWriteMode; paused?: boolean; mayAuto?: boolean } = {}) {
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma = {
    client: {
      courierOutboxItem: {
        create: jest.fn().mockResolvedValue({ id: 'item-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'item-1', categoryId: 'cat-1' }]),
        findUnique: jest.fn().mockResolvedValue({
          requestFingerprint: 'fp',
          kind: 'COMMENT',
          status: 'SENDING',
          externalRef: null,
          routedMode: null,
          escalation: { awbNumber: 'AWB1', externalTicketId: 'TKT1', courierCode: 'delhivery' },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'item-1',
          escalationId: 'esc-1',
          kind: 'COMMENT',
          body: 'hello',
          categoryId: 'cat-1',
          // The claim carries WHICH courier's desk this belongs to, so
          // the dispatcher picks that adapter rather than a default.
          escalation: { courierCode: 'delhivery' },
        }),
        updateMany: jest
          .fn()
          .mockImplementation(
            (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
              updates.push(a);
              return Promise.resolve({ count: 1 });
            },
          ),
      },
    },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      writeMode: opts.mode ?? CourierWriteMode.AUTO,
      effectivelyPaused: opts.paused ?? false,
      autoCategories: ['cat-1'],
    }),
    mayAutoAct: jest.fn().mockResolvedValue(opts.mayAuto ?? true),
  };
  const svc = new CourierOutboxService(
    prisma as never,
    settings as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { svc, updates, settings, prisma };
}

describe('classifyDispatchError — by what it lets us do, not what it was', () => {
  it('DNS / refused / auth failures are PRE_DISPATCH — nothing happened, failover is safe', () => {
    expect(classifyDispatchError({ code: 'ENOTFOUND' })).toBe(
      CourierDispatchErrorClass.PRE_DISPATCH,
    );
    expect(classifyDispatchError({ code: 'ECONNREFUSED' })).toBe(
      CourierDispatchErrorClass.PRE_DISPATCH,
    );
    expect(classifyDispatchError({ status: 401 })).toBe(CourierDispatchErrorClass.PRE_DISPATCH);
  });

  it('timeouts and 5xx are AMBIGUOUS — it MAY have landed', () => {
    // The whole reason the outbox exists. A retried timeout is how one
    // comment becomes two.
    expect(classifyDispatchError({ code: 'ETIMEDOUT' })).toBe(CourierDispatchErrorClass.AMBIGUOUS);
    expect(classifyDispatchError({ name: 'AbortError' })).toBe(CourierDispatchErrorClass.AMBIGUOUS);
    expect(classifyDispatchError({ status: 503 })).toBe(CourierDispatchErrorClass.AMBIGUOUS);
  });

  it('a plain 4xx is REJECTED — they answered, and the answer was no', () => {
    expect(classifyDispatchError({ status: 422 })).toBe(CourierDispatchErrorClass.REJECTED);
  });

  it('anything UNRECOGNISED defaults to AMBIGUOUS — the safe direction', () => {
    // Defaulting to pre-dispatch would authorise an immediate retry of
    // something that may already have landed.
    expect(classifyDispatchError(new Error('who knows'))).toBe(CourierDispatchErrorClass.AMBIGUOUS);
    expect(classifyDispatchError(null)).toBe(CourierDispatchErrorClass.AMBIGUOUS);
    expect(classifyDispatchError(undefined)).toBe(CourierDispatchErrorClass.AMBIGUOUS);
  });
});

describe('an AMBIGUOUS failure never becomes FAILED', () => {
  it('goes to SENT_UNCONFIRMED so the reconciler decides, not a retry', async () => {
    const { svc, updates } = make();
    await svc.fail({
      itemId: 'item-1',
      error: 'socket hang up',
      errorClass: CourierDispatchErrorClass.AMBIGUOUS,
      actorType: 'SYSTEM' as never,
    });
    const status = updates.find((u) => u.data['status'] !== undefined)?.data['status'];
    expect(status).toBe(CourierOutboxStatus.SENT_UNCONFIRMED);
  });

  it('a PRE_DISPATCH failure DOES become FAILED — safe to re-enqueue', async () => {
    const { svc, updates } = make();
    await svc.fail({
      itemId: 'item-1',
      error: 'ECONNREFUSED',
      errorClass: CourierDispatchErrorClass.PRE_DISPATCH,
      actorType: 'SYSTEM' as never,
    });
    const status = updates.find((u) => u.data['status'] !== undefined)?.data['status'];
    expect(status).toBe(CourierOutboxStatus.FAILED);
  });
});

describe('routing happens at CLAIM time, not at enqueue', () => {
  it('enqueue does NOT stamp a mode', async () => {
    // A backlog stamped at enqueue would execute yesterday's intent, and
    // flipping the switch would appear not to have worked.
    const { svc, prisma } = make();
    await svc.enqueue({ escalationId: 'esc-1', kind: 'COMMENT' as never, body: 'x' });
    const data = prisma.client.courierOutboxItem.create.mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(data['routedMode']).toBeUndefined();
  });

  it('MANUAL means the worker claims NOTHING', async () => {
    const { svc, settings } = make({ mode: CourierWriteMode.MANUAL });
    expect(await svc.claimForWorker()).toBeNull();
    // It must not even look — the mode is the first question.
    expect(settings.mayAutoAct).not.toHaveBeenCalled();
  });

  it('a PAUSE stops claiming without anyone changing the mode', async () => {
    const { svc } = make({ mode: CourierWriteMode.AUTO, paused: true });
    expect(await svc.claimForWorker()).toBeNull();
  });

  it('a claim stamps the mode read at PICKUP', async () => {
    const { svc, updates } = make({ mode: CourierWriteMode.AUTO });
    const claimed = await svc.claimForWorker();
    expect(claimed?.routedMode).toBe(CourierWriteMode.AUTO);
    expect(updates[0]?.data['routedMode']).toBe(CourierWriteMode.AUTO);
  });

  it('the claim is a GUARDED update, not a read-then-write', async () => {
    // Two workers reading PENDING and both proceeding is the double-post
    // this table exists to prevent. The guard is the WHERE clause.
    const { svc, updates } = make();
    await svc.claimForWorker();
    expect(updates[0]?.where).toMatchObject({ status: CourierOutboxStatus.PENDING });
  });

  it('an item whose category is not on the auto list is left for a human', async () => {
    const { svc } = make({ mayAuto: false });
    expect(await svc.claimForWorker()).toBeNull();
  });
});

describe('nobody can assert success (structural)', () => {
  const src = readFileSync(
    join(__dirname, '../../src/modules/courier-escalation/services/courier-outbox.service.ts'),
    'utf8',
  );

  it('the ONLY path to CONFIRMED is named for the read-back', () => {
    // If a plain `markConfirmed` ever appears, someone will use it to
    // clear a stuck queue — and the queue will then be clean and wrong.
    expect(src).toContain('confirmFromReadBack');
    expect(src).not.toMatch(/async markConfirmed\b/);
  });

  it('the ops controller exposes no confirm endpoint', () => {
    const controller = readFileSync(
      join(
        __dirname,
        '../../src/modules/courier-escalation/controllers/admin-courier-escalation.controller.ts',
      ),
      'utf8',
    );
    expect(controller).not.toContain('confirmFromReadBack');
    expect(controller).not.toMatch(/mark-confirmed/);
  });

  it('markSentUnconfirmed sets SENT_UNCONFIRMED and nothing better', async () => {
    const { svc, updates } = make();
    await svc.markSentUnconfirmed({ itemId: 'item-1', actorType: 'STAFF' as never, staffId: 's1' });
    expect(updates[0]?.data['status']).toBe(CourierOutboxStatus.SENT_UNCONFIRMED);
  });
});
