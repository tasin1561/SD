import { BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { TreasuryReadService } from '../../src/modules/treasury/services/treasury-read.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Client-money coverage: what we OWE sellers (every positive wallet)
 * against what we HOLD for them — in rupees AND in any other currency,
 * the latter at its rupee BOOK value (TRE-8). Counting rupee rows alone
 * left a taka top-up out of "held" while its credit sat in "owed".
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface Row {
  ownerKind: BankOwnerKind;
  currency: Currency;
  signedAmount: Prisma.Decimal;
  inrBookValue: Prisma.Decimal | null;
}

function makeSut(opts: { wallets: string[]; rows: Row[] }) {
  const client = {
    platformBankAccount: { findMany: async () => [] },
    sellerWalletBalance: {
      findMany: async () =>
        opts.wallets.map((b) => ({ balance: D(b) })).filter((w) => w.balance.greaterThan(0)),
    },
    bankEntry: {
      // Applies the where-clause it is sent: owner, and currency either
      // equal to or NOT a value.
      aggregate: async (a: {
        where: { ownerKind: BankOwnerKind; currency: Currency | { not: Currency } };
      }) => {
        const c = a.where.currency;
        const hit = opts.rows.filter(
          (r) =>
            r.ownerKind === a.where.ownerKind &&
            (typeof c === 'string' ? r.currency === c : r.currency !== c.not),
        );
        return {
          _sum: {
            signedAmount: hit.reduce((t, r) => t.add(r.signedAmount), D('0')),
            inrBookValue: hit.reduce((t, r) => t.add(r.inrBookValue ?? D('0')), D('0')),
          },
        };
      },
    },
    courierAccount: { findMany: async () => [] },
  };
  const ledger = { balances: async () => [] } as unknown as BankLedgerService;
  return new TreasuryReadService({ client } as unknown as PrismaService, ledger);
}

const seller = (currency: Currency, units: string, book: string | null = null): Row => ({
  ownerKind: BankOwnerKind.SELLER,
  currency,
  signedAmount: D(units),
  inrBookValue: book === null ? null : D(book),
});

describe('TreasuryReadService — client money held in taka counts, at its book value', () => {
  it('a ৳1,300 top-up credited ₹1,000: held ₹1,000, owed ₹1,000, covered', async () => {
    const o = await makeSut({
      wallets: ['1000'],
      rows: [seller(Currency.BDT, '1300', '1000')],
    }).overview();
    expect(o.clientMoney).toEqual({
      owedToSellersInr: '1000.00',
      heldForSellersInr: '1000.00',
      gapInr: '0.00',
      covered: true,
    });
  });

  it('rupees at face value plus taka at book — never taka units as rupees', async () => {
    const o = await makeSut({
      wallets: ['1500', '-200'],
      rows: [
        seller(Currency.INR, '500'),
        seller(Currency.BDT, '1300', '1000'),
        // Capital is ours, not held for anybody.
        {
          ownerKind: BankOwnerKind.CAPITAL,
          currency: Currency.BDT,
          signedAmount: D('9999'),
          inrBookValue: null,
        },
      ],
    }).overview();
    expect(o.clientMoney.heldForSellersInr).toBe('1500.00');
    // The negative wallet is a receivable and does not net off the debt.
    expect(o.clientMoney.owedToSellersInr).toBe('1500.00');
    expect(o.clientMoney.covered).toBe(true);
  });
});
