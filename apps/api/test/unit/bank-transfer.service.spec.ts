import { Currency, Prisma } from '@skydrop/db';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';

function make(fromCur: Currency, toCur: Currency) {
  const posted: Array<{ type: string; signedAmount: string; ownerKind: string }> = [];
  const ledger = {
    post: jest.fn(
      async (i: { type: string; signedAmount: Prisma.Decimal; owner: { kind: string } }) => {
        posted.push({
          type: i.type,
          signedAmount: new Prisma.Decimal(i.signedAmount).toFixed(2),
          ownerKind: i.owner.kind,
        });
        return { id: 'e' };
      },
    ),
  };
  const prisma = {
    client: {
      platformBankAccount: {
        findUnique: jest.fn(async (a: { where: { id: string } }) => ({
          id: a.where.id,
          label: a.where.id,
          currency: a.where.id === 'from' ? fromCur : toCur,
          deletedAt: null,
        })),
      },
      bankTransfer: { create: jest.fn(async () => ({ id: 't1' })) },
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ bankTransfer: { create: async () => ({ id: 't1' }) } }),
    },
  };
  const svc = new BankTransferService(
    prisma as never,
    ledger as never,
    { log: jest.fn() } as never,
  );
  return { svc, posted };
}

const BASE = { fromAccountId: 'from', toAccountId: 'to', movedAt: new Date(), staffId: 's1' };

describe('BankTransferService — the quoted rate is a promise', () => {
  it('credits the seller at the QUOTED rate and keeps the upside', async () => {
    const { svc, posted } = make(Currency.INR, Currency.BDT);
    // ₹1,000 quoted at 1.30 → the seller is owed ৳1,300.
    // The bank gave 1.35 → ৳1,350 arrived, so ৳50 is ours.
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1350',
      quotedRate: '1.30',
      sellerId: 'seller-a',
    });

    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('50.00');
    expect(r.achievedRate).toBe('1.35');
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-1000.00', ownerKind: 'SELLER' },
      { type: 'TRANSFER_IN', signedAmount: '1300.00', ownerKind: 'SELLER' },
      { type: 'FX_SPREAD', signedAmount: '50.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('honours the quote when the rate goes against us, from capital', async () => {
    const { svc, posted } = make(Currency.INR, Currency.BDT);
    // The bank gave 1.25 → only ৳1,250 arrived, but ৳1,300 was promised.
    // The seller still gets ৳1,300; the ৳50 comes out of capital.
    const r = await svc.transfer({
      ...BASE,
      amountOut: '1000',
      amountIn: '1250',
      quotedRate: '1.30',
      sellerId: 'seller-a',
    });

    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('-50.00');
    expect(posted[1]).toEqual({
      type: 'TRANSFER_IN',
      signedAmount: '1300.00',
      ownerKind: 'SELLER',
    });
    expect(posted[2]).toEqual({
      type: 'FX_SPREAD',
      signedAmount: '-50.00',
      ownerKind: 'CAPITAL',
    });
  });

  it('a same-currency move of our own money posts two entries and no spread', async () => {
    const { svc, posted } = make(Currency.INR, Currency.INR);
    const r = await svc.transfer({ ...BASE, amountOut: '300', amountIn: '300' });
    expect(r.fxSpread).toBeNull();
    expect(posted).toEqual([
      { type: 'TRANSFER_OUT', signedAmount: '-300.00', ownerKind: 'CAPITAL' },
      { type: 'TRANSFER_IN', signedAmount: '300.00', ownerKind: 'CAPITAL' },
    ]);
  });

  it('refuses a same-currency transfer that loses money on the way', async () => {
    const { svc } = make(Currency.INR, Currency.INR);
    // A bank fee is an EXPENSE with a name, not a quiet shortfall hidden
    // inside a transfer.
    await expect(svc.transfer({ ...BASE, amountOut: '300', amountIn: '295' })).rejects.toThrow();
  });

  it('refuses a transfer to the same account', async () => {
    const { svc } = make(Currency.INR, Currency.INR);
    await expect(
      svc.transfer({ ...BASE, toAccountId: 'from', amountOut: '10', amountIn: '10' }),
    ).rejects.toThrow();
  });
});
