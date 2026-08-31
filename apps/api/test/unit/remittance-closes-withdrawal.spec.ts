import { Prisma } from '@skydrop/db';
import { RemittanceService } from '../../src/modules/admin-remittance/services/remittance.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * Recording the payment and closing the request it settles is ONE act.
 * Leaving the link to a second manual step is how a seller who has been
 * paid stays "awaiting review" for a week — nothing reminds anybody,
 * and the queue looks like work that has not happened.
 *
 * It lives on the server so it holds however the remittance was made:
 * the general Record button, the Pay button on the approved list, or a
 * direct API call.
 */
function makeSut(approved: Array<{ id: string; amountRequested: Prisma.Decimal }>) {
  const markPaid = jest.fn<Promise<never>, [string, string, string]>(async () => ({}) as never);
  // Typed: an untyped jest.fn gives `mock.calls` an empty tuple, so
  // reading calls[0][0] is a conversion from undefined. A warm
  // incremental typecheck misses it and a cold one does not.
  const findMany = jest.fn<Promise<typeof approved>, [AnyArgs]>(async () => approved);
  const svc = Object.create(RemittanceService.prototype) as RemittanceService;
  Object.assign(svc, {
    prisma: { client: { withdrawalRequest: { findMany } } } as unknown as PrismaService,
    withdrawals: { markPaid },
    logger: { log: jest.fn(), warn: jest.fn() },
  });
  const close = (
    svc as unknown as {
      closeMatchingWithdrawal: (
        s: string,
        r: string,
        a: Prisma.Decimal,
        staff: string,
      ) => Promise<void>;
    }
  ).closeMatchingWithdrawal.bind(svc);
  return { close, markPaid, findMany };
}

describe('a remittance closes the withdrawal it paid', () => {
  it('links when there is exactly one approved request and the amount matches', async () => {
    const { close, markPaid } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).toHaveBeenCalledWith('wr-1', 'staff-1', 'rem-1');
  });

  it('leaves it alone when the amount does not match', async () => {
    // Which debt was settled, and by how much, is a judgement. Guessing
    // marks a request paid against money that did not pay it, and the
    // seller is told so.
    const { close, markPaid } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    await close('s-1', 'rem-1', D('400.00'), 'staff-1');
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('leaves it alone when two requests are open — it cannot know which', async () => {
    const { close, markPaid } = makeSut([
      { id: 'wr-1', amountRequested: D('500.00') },
      { id: 'wr-2', amountRequested: D('500.00') },
    ]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('does nothing when the seller has no approved request', async () => {
    const { close, markPaid } = makeSut([]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('never throws — the money has already committed', async () => {
    // The remittance IS the payment and its transaction is closed. A
    // failure here leaves the request open, which is the state it was
    // in a moment ago and which a person can still resolve.
    const { close, markPaid } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    markPaid.mockRejectedValueOnce(new Error('conflict'));
    await expect(close('s-1', 'rem-1', D('500.00'), 'staff-1')).resolves.toBeUndefined();
  });

  it('only ever considers APPROVED requests', async () => {
    const { close, findMany } = makeSut([]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs)['where'] as AnyArgs;
    // A PENDING request has not been decided; paying one would skip the
    // balance re-check that approval exists to perform.
    expect(where['status']).toBe('APPROVED');
    expect(where['sellerId']).toBe('s-1');
  });
});
