import { Prisma, WalletEntryDirection } from '@skydrop/db';
import { OrderChargesRefundService } from '../../src/modules/seller-wallet-accrual/services/order-charges-refund.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function makeSut(
  opts: {
    /** The ORDER_CHARGES debit already on the ledger, if any. */
    charged?: { id: string; amount: string; currency?: 'INR' | 'BDT' } | null;
    /** A refund already issued for this order. */
    alreadyRefunded?: boolean;
  } = {},
) {
  const charged =
    opts.charged === undefined
      ? { id: 'we-debit', amount: '200.00', currency: 'INR' }
      : opts.charged;

  const entryFindFirst = jest.fn(async (args: AnyArgs) => {
    const where = args['where'] as AnyArgs;
    if (where['direction'] === WalletEntryDirection.ORDER_CHARGES_REFUND) {
      return opts.alreadyRefunded ? { id: 'we-refund-prior' } : null;
    }
    return charged === null
      ? null
      : {
          id: charged.id,
          amount: new Prisma.Decimal(charged.amount),
          currency: charged.currency ?? 'INR',
        };
  });

  const txClient = { sellerWalletEntry: { findFirst: entryFindFirst } };
  const client = {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient),
  };

  // Params are declared so the mock's call tuple is typed — an argless
  // `jest.fn` infers `[]` and every `.mock.calls[0]![1]` below becomes a
  // compile error that only CI would surface.
  const applyEntry = jest.fn(async (_tx: unknown, _input: AnyArgs) => ({
    id: 'we-refund',
    runningBalanceAfter: new Prisma.Decimal(0),
  }));
  const auditLog = jest.fn(async (_entry: AnyArgs, _tx?: unknown) => 'a1');

  const svc = new OrderChargesRefundService(
    { client } as unknown as PrismaService,
    { applyEntry } as never,
    { log: auditLog } as never,
  );
  return { svc, applyEntry, auditLog };
}

describe('OrderChargesRefundService', () => {
  it('gives back exactly what was charged, linked to the original debit', async () => {
    const { svc, applyEntry } = makeSut();

    const refunded = await svc.refundIfCharged('o1', 's1', 'Order cancelled before dispatch');

    expect(refunded?.toString()).toBe('200');
    expect(applyEntry).toHaveBeenCalledTimes(1);
    const input = applyEntry.mock.calls[0]![1];
    expect(input['direction']).toBe(WalletEntryDirection.ORDER_CHARGES_REFUND);
    expect((input['amount'] as Prisma.Decimal).toString()).toBe('200');
    expect(input['linkedOrderId']).toBe('o1');
    // The pair reads as one round trip rather than two loose lines.
    expect(input['linkedEntryId']).toBe('we-debit');
  });

  it('reads the ORIGINAL ENTRY rather than re-summing the charges', async () => {
    // Re-deriving the total would let the debit and the refund drift
    // the day a charge type is added, and the seller would get back a
    // different number from the one they were charged.
    const { svc, applyEntry } = makeSut({
      charged: { id: 'we-debit', amount: '236.00' },
    });
    await svc.refundIfCharged('o1', 's1', 'cancelled');
    const input = applyEntry.mock.calls[0]![1];
    expect((input['amount'] as Prisma.Decimal).toString()).toBe('236');
  });

  it('is a silent no-op when nothing was ever charged', async () => {
    // The ordinary case: an AT_DELIVERY seller is not debited until the
    // parcel arrives, so a cancellation has nothing to return.
    const { svc, applyEntry } = makeSut({ charged: null });

    await expect(svc.refundIfCharged('o1', 's1', 'cancelled')).resolves.toBeNull();
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run does not double-credit', async () => {
    const { svc, applyEntry } = makeSut({ alreadyRefunded: true });

    await expect(svc.refundIfCharged('o1', 's1', 'cancelled')).resolves.toBeNull();
    expect(applyEntry).not.toHaveBeenCalled();
  });

  it('refunds in the currency the charge was taken in', async () => {
    const { svc, applyEntry } = makeSut({
      charged: { id: 'we-debit', amount: '50.00', currency: 'BDT' },
    });
    await svc.refundIfCharged('o1', 's1', 'cancelled');
    expect(applyEntry.mock.calls[0]![1]['currency']).toBe('BDT');
  });

  it('writes an audit row naming the order and the amount', async () => {
    const { svc, auditLog } = makeSut();
    await svc.refundIfCharged('o1', 's1', 'Order cancelled before dispatch');
    const entry = auditLog.mock.calls[0]![0];
    expect(entry['action']).toBe('wallet.order_charges_refunded');
    expect(entry['entityId']).toBe('o1');
    expect((entry['metadata'] as AnyArgs)['amountInr']).toBe('200');
  });
});

describe('WAL-1 — ORDER_CHARGES_REFUND must be a CREDIT', () => {
  it('is registered in WalletService.CREDIT_DIRECTIONS', async () => {
    // WAL-1: a direction missing from that set is treated as a DEBIT,
    // so forgetting it here would charge the seller a SECOND time for a
    // parcel that never moved — and nothing would fail.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/seller-wallet/services/wallet.service.ts'),
      'utf8',
    );
    const set = src.slice(
      src.indexOf('CREDIT_DIRECTIONS: ReadonlySet'),
      src.indexOf(']);', src.indexOf('CREDIT_DIRECTIONS: ReadonlySet')),
    );
    expect(set).toContain('ORDER_CHARGES_REFUND');
  });

  it("matches the UI's exhaustive switch EXACTLY, in both directions", async () => {
    // WAL-1 used to be carried by this API Set plus a hand-copied one in
    // apps/seller, checked only by asserting a single value appeared in
    // both. That check passes while the two disagree about any OTHER
    // direction — and disagreement renders a credit as a red debit while
    // the ledger says the opposite.
    //
    // The UI half is now ONE exhaustive switch in @skydrop/ui/status,
    // read by both apps, so the sets can be compared whole. A direction
    // added to one side and not the other fails HERE rather than on a
    // seller's screen.
    const fs = await import('node:fs');
    const path = await import('node:path');

    const api = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/seller-wallet/services/wallet.service.ts'),
      'utf8',
    );
    const apiSet = new Set(
      (
        api
          .slice(
            api.indexOf('CREDIT_DIRECTIONS: ReadonlySet'),
            api.indexOf(']);', api.indexOf('CREDIT_DIRECTIONS: ReadonlySet')),
          )
          .match(/WalletEntryDirection\.([A-Z_]+)/g) ?? []
      ).map((m) => m.replace('WalletEntryDirection.', '')),
    );

    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../../../packages/ui/src/status/index.ts'),
      'utf8',
    );
    // The credits are the cases that fall through to `return true`.
    const fn = ui.slice(ui.indexOf('export function isWalletCredit'));
    const uiSet = new Set(
      (fn.slice(0, fn.indexOf('return true;')).match(/WalletEntryDirection\.([A-Z_]+)/g) ?? []).map(
        (m) => m.replace('WalletEntryDirection.', ''),
      ),
    );

    expect(uiSet.size).toBeGreaterThan(0);
    expect([...uiSet].sort()).toEqual([...apiSet].sort());
    // The one this suite is about, named so a whole-set failure still
    // says which invariant it broke.
    expect(uiSet.has('ORDER_CHARGES_REFUND')).toBe(true);
  });
});
