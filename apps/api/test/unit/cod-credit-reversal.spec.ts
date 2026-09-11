import { Prisma } from '@skydrop/db';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

/**
 * Taking back a COD the courier reversed.
 *
 * The seller was credited the whole COD and we took tax and a fee out of
 * it. When the courier claws that COD back, the seller must lose the
 * credit and get the deductions back — exactly, entry for entry, each
 * pointing at the one it returns, so the P&L can take it off the right
 * line. A COD can be reversed, paid and credited again, and reversed
 * again, so each reversal takes back the LATEST credit not yet reversed
 * and returns only what has not been returned already.
 */

const SELLER = '019fad84-7acd-754e-8ee4-43cf858fed82';
const ORDER = '019fad84-7acd-754e-8ee4-43cf858fed83';
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Entry {
  direction: string;
  amount: Prisma.Decimal;
  linkedEntryId?: string;
}

interface Row {
  id: string;
  amount: Prisma.Decimal;
  direction: string;
  linkedEntryId?: string;
}

function makeSut(opts: { rows?: Row[] }) {
  const rows: Row[] = opts.rows ?? [
    { id: 'cod-1', amount: D('1000.00'), direction: 'COD_COLLECTION' },
    { id: 'gst-1', amount: D('152.54'), direction: 'GST_WITHHOLDING' },
    { id: 'fee-1', amount: D('21.19'), direction: 'INSTANT_PAY_FEE' },
  ];
  const entries: Entry[] = [];
  const lock = jest.fn(async () => 1);
  const matches = (r: Row, direction: unknown): boolean =>
    typeof direction === 'string'
      ? r.direction === direction
      : ((direction as { in: string[] }).in ?? []).includes(r.direction);
  const tx = {
    $executeRaw: lock,
    sellerWalletEntry: {
      findMany: jest.fn(
        async (args: { where: { direction: unknown }; orderBy?: { id: 'desc' | 'asc' } }) => {
          const found = rows.filter((r) => matches(r, args.where.direction));
          // ids here sort like uuidv7s: the later row has the larger id.
          return args.orderBy?.id === 'desc'
            ? [...found].sort((a, b) => b.id.localeCompare(a.id))
            : found;
        },
      ),
    },
  } as unknown as Prisma.TransactionClient;
  const settings = { resolve: jest.fn() } as unknown as SettingsResolverService;
  const wallet = {
    applyEntry: jest.fn(async (_tx: unknown, input: Entry) => {
      entries.push({
        direction: input.direction,
        amount: input.amount,
        ...(input.linkedEntryId === undefined ? {} : { linkedEntryId: input.linkedEntryId }),
      });
      return { id: `e${entries.length}` };
    }),
  } as unknown as WalletService;
  return { svc: new CodCreditService(settings, wallet), tx, entries, lock };
}

const input = {
  orderId: ORDER,
  sellerId: SELLER,
  note: 'COD reversed by the courier on payout X',
};

describe('CodCreditService.reverseForOrder', () => {
  it('debits the whole credit back and returns each deduction against the one it returns', async () => {
    const { svc, tx, entries, lock } = makeSut({});
    const r = await svc.reverseForOrder(tx, input);

    expect(lock).toHaveBeenCalled();
    expect(r).toEqual({ reversed: true, grossInr: '1000.00', returnedInr: '173.73' });
    expect(entries).toEqual([
      { direction: 'COD_REVERSAL', amount: D('1000.00'), linkedEntryId: 'cod-1' },
      { direction: 'COD_DEDUCTION_REFUND', amount: D('152.54'), linkedEntryId: 'gst-1' },
      { direction: 'COD_DEDUCTION_REFUND', amount: D('21.19'), linkedEntryId: 'fee-1' },
    ]);
  });

  it('nets the seller to nothing for that order — credit, deductions and reversal cancel', async () => {
    const { svc, tx, entries } = makeSut({});
    await svc.reverseForOrder(tx, input);
    // Credited 1000, deducted 173.73: they held 826.27. The reversal takes
    // back 1000 and returns 173.73 — exactly what they held.
    const out = entries.find((e) => e.direction === 'COD_REVERSAL')?.amount ?? D('0');
    const back = entries
      .filter((e) => e.direction === 'COD_DEDUCTION_REFUND')
      .reduce((t, e) => t.add(e.amount), D('0'));
    expect(out.sub(back).toFixed(2)).toBe('826.27');
  });

  it('is idempotent — a COD with as many reversals as credits is not reversed again', async () => {
    const { svc, tx, entries } = makeSut({
      rows: [
        { id: 'cod-1', amount: D('1000.00'), direction: 'COD_COLLECTION' },
        { id: 'rev-1', amount: D('1000.00'), direction: 'COD_REVERSAL', linkedEntryId: 'cod-1' },
      ],
    });
    const r = await svc.reverseForOrder(tx, input);
    expect(r).toMatchObject({ reversed: false, reason: 'ALREADY_REVERSED' });
    expect(entries).toHaveLength(0);
  });

  it('writes nothing for an order whose seller was never credited', async () => {
    const { svc, tx, entries } = makeSut({ rows: [] });
    const r = await svc.reverseForOrder(tx, input);
    expect(r).toMatchObject({ reversed: false, reason: 'NEVER_CREDITED' });
    expect(entries).toHaveLength(0);
  });

  it('a second reversal takes back the SECOND credit and returns only its own deductions', async () => {
    // Credited, reversed (tax + fee returned), credited again on a later
    // payout, now reversed again. Returning the first credit's tax a second
    // time would hand the seller ₹152.54 they were already given.
    const { svc, tx, entries } = makeSut({
      rows: [
        { id: 'cod-1', amount: D('1000.00'), direction: 'COD_COLLECTION' },
        { id: 'gst-1', amount: D('152.54'), direction: 'GST_WITHHOLDING' },
        { id: 'rev-1', amount: D('1000.00'), direction: 'COD_REVERSAL', linkedEntryId: 'cod-1' },
        {
          id: 'ref-1',
          amount: D('152.54'),
          direction: 'COD_DEDUCTION_REFUND',
          linkedEntryId: 'gst-1',
        },
        { id: 'cod-2', amount: D('1000.00'), direction: 'COD_COLLECTION' },
        { id: 'gst-2', amount: D('152.54'), direction: 'GST_WITHHOLDING' },
      ],
    });
    const r = await svc.reverseForOrder(tx, input);
    expect(r).toEqual({ reversed: true, grossInr: '1000.00', returnedInr: '152.54' });
    expect(entries).toEqual([
      { direction: 'COD_REVERSAL', amount: D('1000.00'), linkedEntryId: 'cod-2' },
      { direction: 'COD_DEDUCTION_REFUND', amount: D('152.54'), linkedEntryId: 'gst-2' },
    ]);
  });
});
