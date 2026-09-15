import { Currency, Prisma } from '@skydrop/db';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import { SellerCashAttributionService } from '../../src/modules/treasury/services/seller-cash-attribution.service';

/**
 * TRE-4 / TRE-8, end to end in memory: after every payout, the cash the
 * bank book holds for a seller equals what their wallet says they are owed
 * — max(0, balance) — and the account moves by exactly what landed.
 *
 * The REAL CodCreditService and SellerCashAttributionService run here, over
 * an in-memory wallet and bank book; only Prisma is faked. This is the
 * test that caught the tax on a settled COD never becoming ours: the
 * credit ran before the seller's cash was posted, so the attribution found
 * nothing to take and the seller was held the gross.
 *
 * A seller's cash in another currency (a taka top-up) is valued at the
 * rate it was credited at — the rate the attribution itself converts at —
 * so "held" below is rupees plus taka at that rate.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = D('0');
const CREDITS = new Set([
  'COD_COLLECTION',
  'COD_DEDUCTION_REFUND',
  'TOPUP',
  'ORDER_CHARGES_REFUND',
  'SCRAP_REFUND',
]);
/** Our accounts: the rupee one the courier pays into, and a taka one. */
const ACCOUNT_CURRENCY: Record<string, string> = { hdfc: 'INR', tasin: 'BDT' };

interface WalletRow {
  id: string;
  sellerId: string;
  currency: string;
  direction: string;
  amount: Prisma.Decimal;
  runningBalanceAfter: Prisma.Decimal;
  linkedOrderId: string | null;
  linkedEntryId: string | null;
}
interface BankRow {
  accountId: string;
  currency: string;
  ownerKind: string;
  sellerId: string | null;
  signedAmount: Prisma.Decimal;
}
interface Topup {
  sellerId: string;
  bankAccountId: string;
  currency: string;
  amount: Prisma.Decimal;
  credited: Prisma.Decimal;
}

function makeWorld(orders: Array<{ id: string; sellerId: string; cod: string }>) {
  const wallet: WalletRow[] = [];
  const bank: BankRow[] = [];
  const topups: Topup[] = [];
  const lines: Array<{
    orderId: string;
    settledInr: Prisma.Decimal;
    shortfallInr: Prisma.Decimal;
  }> = [];
  let seq = 0;
  const nextId = (): string => `id-${String((seq += 1)).padStart(6, '0')}`;

  const dirMatch = (direction: unknown, d: string): boolean =>
    direction === undefined ||
    (typeof direction === 'string'
      ? direction === d
      : ((direction as { in: string[] }).in ?? []).includes(d));
  const walletWhere = (w: Record<string, unknown>) => (r: WalletRow) =>
    (w['linkedOrderId'] === undefined || r.linkedOrderId === w['linkedOrderId']) &&
    (w['sellerId'] === undefined || r.sellerId === w['sellerId']) &&
    (w['currency'] === undefined || r.currency === w['currency']) &&
    dirMatch(w['direction'], r.direction);

  const ledger = {
    post: jest.fn(
      async (input: {
        accountId: string;
        amountCurrency: string;
        signedAmount: Prisma.Decimal;
        owner: { kind: string; sellerId?: string };
      }) => {
        // As the real post() does: an account takes only its own currency.
        if (ACCOUNT_CURRENCY[input.accountId] !== input.amountCurrency) {
          throw new Error(`BANK_CURRENCY_MISMATCH on ${input.accountId}`);
        }
        bank.push({
          accountId: input.accountId,
          currency: input.amountCurrency,
          ownerKind: input.owner.kind,
          sellerId: input.owner.sellerId ?? null,
          signedAmount: input.signedAmount,
        });
        return { id: nextId() };
      },
    ),
  };
  const attribution = new SellerCashAttributionService(ledger as never);

  const tx: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: {
      findFirst: jest.fn(async (a: { where: Record<string, unknown> }) => {
        const found = wallet.filter(walletWhere(a.where));
        return found.length === 0 ? null : found[found.length - 1];
      }),
      findMany: jest.fn(
        async (a: { where: Record<string, unknown>; orderBy?: { id: 'desc' | 'asc' } }) => {
          const found = wallet.filter(walletWhere(a.where));
          return a.orderBy?.id === 'desc' ? [...found].reverse() : found;
        },
      ),
      count: jest.fn(
        async (a: { where: Record<string, unknown> }) => wallet.filter(walletWhere(a.where)).length,
      ),
    },
    gstWithholding: { upsert: jest.fn(async () => ({})) },
    bankEntry: {
      // Grouped by account (one currency asked for) or by account AND currency.
      groupBy: jest.fn(
        async (a: { by: string[]; where: { sellerId: string; currency?: string } }) => {
          const by = new Map<string, { accountId: string; currency: string; s: Prisma.Decimal }>();
          for (const b of bank) {
            if (b.ownerKind !== 'SELLER' || b.sellerId !== a.where.sellerId) continue;
            if (a.where.currency !== undefined && b.currency !== a.where.currency) continue;
            const key = `${b.accountId}|${b.currency}`;
            const cur = by.get(key) ?? { accountId: b.accountId, currency: b.currency, s: ZERO };
            by.set(key, { ...cur, s: cur.s.add(b.signedAmount) });
          }
          return [...by.values()].map((g) => ({
            accountId: g.accountId,
            ...(a.by.includes('currency') ? { currency: g.currency } : {}),
            _sum: { signedAmount: g.s },
          }));
        },
      ),
    },
    walletTopupRequest: {
      findFirst: jest.fn(async (a: { where: { sellerId: string; bankAccountId: string } }) => {
        const t = topups
          .filter(
            (x) => x.sellerId === a.where.sellerId && x.bankAccountId === a.where.bankAccountId,
          )
          .at(-1);
        return t === undefined ? null : { amount: t.amount, walletEntry: { amount: t.credited } };
      }),
    },
    fxRate: { findUnique: jest.fn(async () => null) },
    platformBankAccount: { findFirst: jest.fn(async () => ({ id: 'hdfc' })) },
    courierSettlementLine: {
      groupBy: jest.fn(async (a: { where: { orderId: { in: string[] } } }) => {
        const by = new Map<string, { settled: Prisma.Decimal; short: Prisma.Decimal }>();
        for (const l of lines) {
          if (!a.where.orderId.in.includes(l.orderId)) continue;
          const cur = by.get(l.orderId) ?? { settled: ZERO, short: ZERO };
          by.set(l.orderId, {
            settled: cur.settled.add(l.settledInr),
            short: cur.short.add(l.shortfallInr),
          });
        }
        return [...by].map(([orderId, v]) => ({
          orderId,
          _sum: { settledInr: v.settled, shortfallInr: v.short },
        }));
      }),
    },
    courierSettlement: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        const created = ((a.data['lines'] as { create: typeof lines }).create ?? []).map((l) => ({
          ...l,
        }));
        lines.push(...created);
        return {
          id: nextId(),
          ...a.data,
          earlyCodFeeInr: ZERO,
          freightDeductedInr: ZERO,
          rtoReversalInr: a.data['rtoReversalInr'] ?? ZERO,
          createdAt: new Date(),
          lines: created.map((l) => ({ ...l, expectedInr: ZERO, order: { orderNumber: 'x' } })),
        };
      }),
    },
    courierAccount: {
      findFirst: jest.fn(async () => ({
        id: 'acct-1',
        courier: { code: 'delhivery' },
        payoutBankAccount: { id: 'hdfc', currency: 'INR', isActive: true, deletedAt: null },
      })),
    },
    order: {
      findMany: jest.fn(async (a: { where: { id: { in: string[] } } }) =>
        orders
          .filter((o) => a.where.id.in.includes(o.id))
          .map((o) => ({
            id: o.id,
            orderNumber: o.id,
            codAmountInr: D(o.cod),
            sellerId: o.sellerId,
          })),
      ),
    },
    shipment: { findMany: jest.fn(async () => []) },
    systemSetting: { findUnique: jest.fn(async () => ({ valueDecimal: '100' })) },
  };
  tx['$transaction'] = async (fn: (t: unknown) => unknown) => fn(tx);

  const walletService = {
    applyEntry: jest.fn(
      async (
        _t: unknown,
        input: {
          sellerId: string;
          currency: Currency;
          direction: string;
          amount: Prisma.Decimal;
          linkedOrderId?: string;
          linkedEntryId?: string;
        },
      ) => {
        const last = wallet.filter((r) => r.sellerId === input.sellerId).at(-1);
        const before = last?.runningBalanceAfter ?? ZERO;
        const signed = CREDITS.has(input.direction) ? input.amount : input.amount.neg();
        const row: WalletRow = {
          id: nextId(),
          sellerId: input.sellerId,
          currency: input.currency,
          direction: input.direction,
          amount: input.amount,
          runningBalanceAfter: before.add(signed),
          linkedOrderId: input.linkedOrderId ?? null,
          linkedEntryId: input.linkedEntryId ?? null,
        };
        wallet.push(row);
        // As the real WalletService does, inside the same transaction.
        await attribution.apply(tx as never, {
          sellerId: input.sellerId,
          currency: input.currency,
          direction: input.direction as never,
          amount: input.amount,
          walletEntryId: row.id,
          balanceAfter: row.runningBalanceAfter,
        });
        return { id: row.id, runningBalanceAfter: row.runningBalanceAfter };
      },
    ),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  };
  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      value: key.includes('gst') ? '18.00' : key.includes('fee') ? '0.00' : 'SETTLEMENT',
    })),
  };
  const codCredit = new CodCreditService(settings as never, walletService as never);
  const svc = new CourierSettlementService(
    { client: tx } as never,
    { log: jest.fn(async () => 'a1') } as never,
    codCredit,
    walletService as never,
    ledger as never,
    attribution,
  );

  const entry = async (sellerId: string, direction: string, amount: string): Promise<void> => {
    await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction,
      amount: D(amount),
    });
  };
  /** A charge: made ours out of whatever they hold, a receivable beyond it. */
  const owe = (sellerId: string, amount: string): Promise<void> =>
    entry(sellerId, 'ORDER_CHARGES', amount);
  const refund = (sellerId: string, amount: string): Promise<void> =>
    entry(sellerId, 'ORDER_CHARGES_REFUND', amount);
  /**
   * An accepted taka top-up, as WalletTopupService.accept writes it: the
   * wallet credited in rupees, the taka posted as theirs in the taka
   * account, the request recorded with both figures.
   */
  const topupTaka = async (sellerId: string, bdt: string, inr: string): Promise<void> => {
    await entry(sellerId, 'TOPUP', inr);
    bank.push({
      accountId: 'tasin',
      currency: 'BDT',
      ownerKind: 'SELLER',
      sellerId,
      signedAmount: D(bdt),
    });
    topups.push({
      sellerId,
      bankAccountId: 'tasin',
      currency: 'BDT',
      amount: D(bdt),
      credited: D(inr),
    });
  };
  const heldIn = (sellerId: string, accountId: string): Prisma.Decimal =>
    bank
      .filter((b) => b.ownerKind === 'SELLER' && b.sellerId === sellerId && b.accountId === accountId)
      .reduce((t, b) => t.add(b.signedAmount), ZERO);
  /** Everything held for them, in rupees — taka at its credited rate. */
  const held = (sellerId: string): string => {
    const taka = heldIn(sellerId, 'tasin');
    const t = topups.filter((x) => x.sellerId === sellerId).at(-1);
    const takaInr = t === undefined ? ZERO : taka.mul(t.credited).div(t.amount);
    return heldIn(sellerId, 'hdfc').add(takaInr).toFixed(2);
  };
  const owed = (sellerId: string): string => {
    const bal = wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO;
    return (bal.lessThan(0) ? ZERO : bal).toFixed(2);
  };
  const accountTotal = (accountId = 'hdfc'): string =>
    bank
      .filter((b) => b.accountId === accountId)
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  let n = 0;
  const pay = async (
    amountInr: string,
    paid: Array<[string, string]>,
    reversals: Array<[string, string]> = [],
  ): Promise<void> => {
    n += 1;
    await svc.record('staff-1', {
      courierAccountId: 'acct-1',
      reference: `PAYOUT-${n}`,
      amountInr,
      receivedAt: '2026-09-01T10:00:00.000Z',
      lines: paid.map(([orderId, settledInr]) => ({ orderId, settledInr })),
      ...(reversals.length === 0
        ? {}
        : {
            deductions: {
              rtoReversals: reversals.map(([orderId, amt]) => ({ orderId, amountInr: amt })),
            },
          }),
    });
  };
  return { pay, owe, refund, topupTaka, held, heldIn, owed, accountTotal };
}

describe('the bank book holds each seller exactly what their wallet owes them', () => {
  it('a seller in credit: held the COD less the tax on it', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    // Credited 1000, tax 152.54 withheld: owed 847.46, and the tax is ours.
    expect(w.owed('s')).toBe('847.46');
    expect(w.held('s')).toBe('847.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a seller in debt by less than the COD: the debt is repaid first', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '300');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('547.46');
    expect(w.held('s')).toBe('547.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a seller in debt by more than the COD: nothing is held for them', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '1500');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
  });

  it('when the tax is more than the COD left after the debt, nothing is held', async () => {
    // Owes 900: 100 of the 1000 is theirs, then 152.54 of tax takes that
    // and leaves them 52.54 in debt.
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.owe('s', '900');
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
  });

  it('a part-payment then the rest: held once, for the credit the first payout made', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('600', [['a', '600']]);
    await w.pay('400', [['a', '400']]);
    expect(w.owed('s')).toBe('847.46');
    expect(w.held('s')).toBe('847.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a COD reversed on a later payout is taken back, tax returned, and the books still agree', async () => {
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('1000', [['a', '1000']]);
    // Payout 2 pays for b (2000) and claws back a's 1000: 1000 lands.
    await w.pay('1000', [['b', '2000']], [['a', '1000']]);
    // 847.46 + (2000 − 305.08) − 1000 + 152.54 = 1694.92.
    expect(w.owed('s')).toBe('1694.92');
    expect(w.held('s')).toBe('1694.92');
    expect(w.accountTotal()).toBe('2000.00');
  });

  it('a reversed COD paid again later is credited again', async () => {
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('1000', [['a', '1000']]);
    await w.pay('1000', [['b', '2000']], [['a', '1000']]);
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('2542.38'); // 1694.92 + 847.46
    expect(w.held('s')).toBe('2542.38');
    expect(w.accountTotal()).toBe('3000.00');
  });

  it('a SHORT-PAID COD reversed: the whole credit leaves the seller, the gap comes back to us', async () => {
    // a (COD 1000) was paid 950 — we absorbed 50. Later the courier takes
    // back the 950 it paid. The seller loses the whole ₹1,000 credit, not
    // just the 950: capped at 950 they kept ₹50 against a wallet that no
    // longer owed it. The ₹50 is the short-payment returning to capital.
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 's', cod: '2000' },
    ]);
    await w.pay('950', [['a', '950']]);
    expect(w.owed('s')).toBe('847.46');
    expect(w.held('s')).toBe('847.46');
    await w.pay('1050', [['b', '2000']], [['a', '950']]);
    expect(w.owed('s')).toBe('1694.92');
    expect(w.held('s')).toBe('1694.92');
    expect(w.accountTotal()).toBe('2000.00');
  });
});

describe('a seller who topped up in TAKA', () => {
  it('is charged out of that taka, at the rate it was credited at', async () => {
    // ৳1,300 credited ₹1,000; a ₹200 charge makes ৳260 of it ours.
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.topupTaka('s', '1300', '1000');
    await w.owe('s', '200');
    expect(w.owed('s')).toBe('800.00');
    expect(w.held('s')).toBe('800.00');
    expect(w.heldIn('s', 'tasin').toFixed(2)).toBe('1040.00');
    // Reclassified, not moved: the taka account still holds every taka.
    expect(w.accountTotal('tasin')).toBe('1300.00');

    // Their COD then lands in rupees, and the two currencies together are
    // still exactly what the wallet owes.
    await w.pay('1000', [['a', '1000']]);
    expect(w.owed('s')).toBe('1647.46');
    expect(w.held('s')).toBe('1647.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a charge bigger than all of it leaves the rest as a receivable', async () => {
    const w = makeWorld([]);
    await w.topupTaka('s', '1300', '1000');
    await w.owe('s', '1500');
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.heldIn('s', 'tasin').toFixed(2)).toBe('0.00');
  });

  it('rupees are spent before taka', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]); // ₹847.46 in rupees
    await w.topupTaka('s', '1300', '1000');
    await w.owe('s', '900');
    // 847.46 from the rupees, 52.54 more out of the taka (৳68.30).
    expect(w.heldIn('s', 'hdfc').toFixed(2)).toBe('0.00');
    expect(w.heldIn('s', 'tasin').toFixed(2)).toBe('1231.70');
    expect(w.owed('s')).toBe('947.46');
    expect(w.held('s')).toBe('947.46');
  });
});

describe('a refund to a seller in debt', () => {
  it('holds them only what lifts the wallet above zero', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300'); // −300, nothing held: a receivable
    await w.refund('s', '200'); // −100: the receivable shrank, no cash moved
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    await w.refund('s', '250'); // +150: that much is now theirs
    expect(w.owed('s')).toBe('150.00');
    expect(w.held('s')).toBe('150.00');
    // Whose it is changed; the account did not.
    expect(w.accountTotal()).toBe('0.00');
  });
});
