import { Prisma } from '@skydrop/db';
import { RemittanceService } from '../../src/modules/admin-remittance/services/remittance.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

type Open = Array<{ id: string; amountRequested: Prisma.Decimal }>;

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
function makeSut(approved: Open, pending: Open = []) {
  const markPaid = jest.fn<
    Promise<never>,
    [string, string, string, { allowPending?: boolean } | undefined]
  >(async () => ({}) as never);
  // A payout that cannot close its request now says so on the board:
  // the money has left the bank and the request still reads as owed,
  // which is how the same payout goes out twice.
  const raise = jest.fn(async () => ({ id: 'issue-1', isNew: true }));
  // Typed: an untyped jest.fn gives `mock.calls` an empty tuple, so
  // reading calls[0][0] is a conversion from undefined. A warm
  // incremental typecheck misses it and a cold one does not.
  const findMany = jest.fn<Promise<Open>, [AnyArgs]>(async (a) =>
    (a['where'] as AnyArgs)['status'] === 'PENDING' ? pending : approved,
  );
  const svc = Object.create(RemittanceService.prototype) as RemittanceService;
  Object.assign(svc, {
    prisma: { client: { withdrawalRequest: { findMany } } } as unknown as PrismaService,
    withdrawals: { markPaid },
    issues: { raise },
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
  return { close, markPaid, findMany, raise };
}

describe('a remittance closes the withdrawal it paid', () => {
  it('links when there is exactly one approved request and the amount matches', async () => {
    const { close, markPaid } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).toHaveBeenCalledWith('wr-1', 'staff-1', 'rem-1', undefined);
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

  it('does nothing when the seller has no open request', async () => {
    const { close, markPaid } = makeSut([]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('closes a matching PENDING request when none was approved — never leaves it to be auto-rejected', async () => {
    // Left open, the wallet has already fallen by the payout, so the
    // unpayable-withdrawal sweep would reject it telling the seller "a
    // new request can be made" for money they have just been sent.
    const { close, markPaid } = makeSut([], [{ id: 'wr-p', amountRequested: D('500.00') }]);
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).toHaveBeenCalledWith('wr-p', 'staff-1', 'rem-1', { allowPending: true });
  });

  it('the same rule for pending: two open, or a different amount, is left to a person', async () => {
    const two = makeSut(
      [],
      [
        { id: 'wr-p1', amountRequested: D('500.00') },
        { id: 'wr-p2', amountRequested: D('500.00') },
      ],
    );
    await two.close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(two.markPaid).not.toHaveBeenCalled();

    const other = makeSut([], [{ id: 'wr-p', amountRequested: D('450.00') }]);
    await other.close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(other.markPaid).not.toHaveBeenCalled();
  });

  it('an approved request is the one a payout pays — a pending one is not considered beside it', async () => {
    // One approved request that does not match, and a pending one that
    // does: which was paid is a judgement, so nothing is closed.
    const { close, markPaid, findMany } = makeSut(
      [{ id: 'wr-a', amountRequested: D('300.00') }],
      [{ id: 'wr-p', amountRequested: D('500.00') }],
    );
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(markPaid).not.toHaveBeenCalled();
    const where = (findMany.mock.calls[0]?.[0] as AnyArgs)['where'] as AnyArgs;
    expect(where['status']).toBe('APPROVED');
    expect(where['sellerId']).toBe('s-1');
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('never throws — the money has already committed', async () => {
    // The remittance IS the payment and its transaction is closed. A
    // failure here leaves the request open, which is the state it was
    // in a moment ago and which a person can still resolve.
    const { close, markPaid } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    markPaid.mockRejectedValueOnce(new Error('conflict'));
    await expect(close('s-1', 'rem-1', D('500.00'), 'staff-1')).resolves.toBeUndefined();
  });

  it('raises it on the board, naming the remittance', async () => {
    // "A human can still resolve it" was true and was not enough: no
    // human was ever told to.
    const { close, markPaid, raise } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    markPaid.mockRejectedValueOnce(new Error('conflict'));
    await close('s-1', 'rem-1', D('500.00'), 'staff-1');
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        // Keyed on the remittance: a second bad payout next month is
        // its own problem, not a count on a row somebody already closed.
        dedupeKey: 'remittance-withdrawal-unclosed:rem-1',
      }),
    );
  });

  it('still never throws when the BOARD is the thing that is broken', async () => {
    // The reason this case exists: an alerting layer that throws inside
    // a catch turns a handled problem into an unhandled one, and this
    // catch is on the money path. Caught by this very suite when the
    // raise was first added without a guard.
    const { close, markPaid, raise } = makeSut([{ id: 'wr-1', amountRequested: D('500.00') }]);
    markPaid.mockRejectedValueOnce(new Error('conflict'));
    raise.mockImplementationOnce(() => {
      throw new Error('the board is down');
    });
    await expect(close('s-1', 'rem-1', D('500.00'), 'staff-1')).resolves.toBeUndefined();
  });
});
