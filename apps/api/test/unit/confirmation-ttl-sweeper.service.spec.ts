import { ConflictException } from '@nestjs/common';
import { ActorType, OrderStatus } from '@skydrop/db';
import { CallOutcomeMappingService } from '../../src/modules/call-center/services/call-outcome-mapping.service';
import {
  AUTO_CONFIRM_EVENT_TEXT,
  ConfirmationTtlSweeperService,
} from '../../src/modules/call-center/services/confirmation-ttl-sweeper.service';

function make(opts: { callsRequired?: boolean; transitionError?: Error } = {}) {
  const findMany = jest.fn(async (_a: Record<string, unknown>) => [
    { id: 'o1', sellerId: 'c1', orderNumber: 'SD-1' },
  ]);
  const transitionStatus = jest.fn(async (_i: Record<string, unknown>) => {
    if (opts.transitionError) throw opts.transitionError;
    return { status: OrderStatus.CONFIRMED };
  });
  const enqueueOrDefer = jest.fn(async () => 'ENQUEUED');
  const audit = { log: jest.fn(async () => 'a') };
  const svc = new ConfirmationTtlSweeperService(
    { client: { order: { findMany } } } as never,
    { transitionStatus } as never,
    { callsRequired: jest.fn(async () => opts.callsRequired ?? false), enqueueOrDefer } as never,
    new CallOutcomeMappingService(),
    audit as never,
  );
  return { svc, findMany, transitionStatus, enqueueOrDefer, audit };
}

describe('ConfirmationTtlSweeperService', () => {
  it('only selects PENDING_CONFIRMATION orders whose deadline is set and due (a queued order has none)', async () => {
    const { svc, findMany } = make();
    const now = new Date();
    await svc.sweep(now);
    expect(findMany.mock.calls[0]![0]['where']).toMatchObject({
      status: OrderStatus.PENDING_CONFIRMATION,
      confirmationDeadlineAt: { not: null, lte: now },
    });
  });

  it('confirms an expired order to the status a CONFIRMED call outcome maps to, as a guarded SYSTEM claim, and says it was never called', async () => {
    const { svc, transitionStatus, audit } = make();
    const r = await svc.sweep();
    expect(r).toEqual({ confirmed: 1, queued: 0, skipped: 0 });
    const input = transitionStatus.mock.calls[0]![0];
    expect(input).toMatchObject({
      orderId: 'o1',
      to: OrderStatus.CONFIRMED,
      expectedFrom: OrderStatus.PENDING_CONFIRMATION,
      autoConfirmClaim: true,
      actor: { type: ActorType.SYSTEM, id: null },
      reason: AUTO_CONFIRM_EVENT_TEXT,
    });
    expect(AUTO_CONFIRM_EVENT_TEXT).toMatch(/NO confirmation call was made/);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.auto_confirmed_ttl' }),
    );
  });

  it('RACE: losing the guarded claim to a human confirm is a skip, not a failure or a double confirm', async () => {
    const { svc, audit } = make({
      transitionError: new ConflictException({ code: 'AUTO_CONFIRM_CLAIM_LOST' }),
    });
    await expect(svc.sweep()).resolves.toEqual({ confirmed: 0, queued: 0, skipped: 1 });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('if the client switched calls back ON while it waited, queue it for a call instead of confirming unspoken-to', async () => {
    const { svc, transitionStatus, enqueueOrDefer } = make({ callsRequired: true });
    await expect(svc.sweep()).resolves.toEqual({ confirmed: 0, queued: 1, skipped: 0 });
    expect(enqueueOrDefer).toHaveBeenCalledWith('o1');
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});
