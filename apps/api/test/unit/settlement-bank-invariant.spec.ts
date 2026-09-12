import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { CourierSettlementService } from '../../src/modules/courier-settlement/services/courier-settlement.service';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';
import { BankTransferService } from '../../src/modules/treasury/services/bank-transfer.service';
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
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = D('0');
const CREDITS = new Set([
  'COD_COLLECTION',
  'COD_DEDUCTION_REFUND',
  'TOPUP',
  'ORDER_CHARGES_REFUND',
]);

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
  /** A seller's non-rupee entry: what it is worth to their wallet. */
  inrBookValue: Prisma.Decimal | null;
}
interface Topup {
  sellerId: string;
  bankAccountId: string;
  currency: string;
  amount: Prisma.Decimal;
  credited: Prisma.Decimal;
}

function makeWorld(
  orders: Array<{ id: string; sellerId: string; cod: string }>,
  /** The two independent COD fees, as percents. Both off by default. */
  fees: { collection?: string; instant?: string } = {},
) {
  const wallet: WalletRow[] = [];
  const bank: BankRow[] = [];
  // Accepted top-ups: what arrived in the account, what the wallet was credited.
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
        signedAmount: Prisma.Decimal;
        amountCurrency: string;
        owner: { kind: string; sellerId?: string };
        inrBookValue?: Prisma.Decimal | null;
      }) => {
        bank.push({
          accountId: input.accountId,
          currency: input.amountCurrency,
          ownerKind: input.owner.kind,
          sellerId: input.owner.sellerId ?? null,
          signedAmount: input.signedAmount,
          inrBookValue: input.inrBookValue ?? null,
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
      // By account, or by account AND currency — as the real one is asked.
      groupBy: jest.fn(async (a: { by: string[]; where: { sellerId: string } }) => {
        const withCurrency = a.by.includes('currency');
        const by = new Map<
          string,
          { accountId: string; currency: string; sum: Prisma.Decimal; book: Prisma.Decimal }
        >();
        for (const b of bank) {
          if (b.ownerKind !== 'SELLER' || b.sellerId !== a.where.sellerId) continue;
          const key = withCurrency ? `${b.accountId}|${b.currency}` : b.accountId;
          const cur = by.get(key) ?? {
            accountId: b.accountId,
            currency: b.currency,
            sum: ZERO,
            book: ZERO,
          };
          by.set(key, {
            ...cur,
            sum: cur.sum.add(b.signedAmount),
            book: cur.book.add(b.inrBookValue ?? ZERO),
          });
        }
        return [...by.values()].map((v) => ({
          accountId: v.accountId,
          ...(withCurrency ? { currency: v.currency } : {}),
          _sum: { signedAmount: v.sum, inrBookValue: v.book },
        }));
      }),
    },
    walletTopupRequest: {
      findFirst: jest.fn(
        async (a: { where: { sellerId: string; bankAccountId: string; currency: string } }) => {
          const t = topups
            .filter(
              (x) =>
                x.sellerId === a.where.sellerId &&
                x.bankAccountId === a.where.bankAccountId &&
                x.currency === a.where.currency,
            )
            .at(-1);
          return t === undefined ? null : { amount: t.amount, walletEntry: { amount: t.credited } };
        },
      ),
    },
    fxRate: { findFirst: jest.fn(async () => null) },
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
        });
        return { id: row.id, runningBalanceAfter: row.runningBalanceAfter };
      },
    ),
    recomputeCacheAfterCommit: jest.fn(async () => undefined),
  };
  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      value: key.includes('gst')
        ? '18.00'
        : key.includes('instant_pay_fee')
          ? (fees.instant ?? '0.00')
          : key.includes('cod_collection_fee')
            ? (fees.collection ?? '0.00')
            : 'SETTLEMENT',
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

  /** A charge taken while the seller held nothing: a receivable, no bank entry. */
  const owe = async (sellerId: string, amount: string): Promise<void> => {
    await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'ORDER_CHARGES',
      amount: D(amount),
    });
  };
  /**
   * A top-up in taka into our Tasin account, as `WalletTopupService.accept`
   * does it: the wallet is credited the rupees, the taka lands as theirs,
   * and the share of it that repays a debt becomes ours in proportion.
   */
  const topUp = async (sellerId: string, taka: string, inr: string): Promise<void> => {
    const amount = D(taka);
    const credited = D(inr);
    const split = await attribution.debtSplit(tx as never, sellerId, credited);
    const entry = await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'TOPUP',
      amount: credited,
    });
    topups.push({ sellerId, bankAccountId: 'tasin', currency: 'BDT', amount, credited });
    await ledger.post({
      accountId: 'tasin',
      signedAmount: amount,
      amountCurrency: 'BDT',
      owner: { kind: 'SELLER', sellerId },
      inrBookValue: credited,
    });
    await attribution.repayDebt(tx as never, {
      sellerId,
      accountId: 'tasin',
      currency: Currency.BDT,
      amount: amount.mul(split.toCapital).div(credited).toDecimalPlaces(2),
      reference: entry.id,
      inrValue: split.toCapital,
    });
  };
  /** A charge given back (ORDER_CHARGES_REFUND): TO_SELLER, clamped by debt. */
  const refund = async (sellerId: string, amount: string): Promise<void> => {
    await walletService.applyEntry(null, {
      sellerId,
      currency: Currency.INR,
      direction: 'ORDER_CHARGES_REFUND',
      amount: D(amount),
    });
  };
  /**
   * What the book holds for them, every currency valued in rupees: rupees
   * as they are, anything else by its BOOK value — what it is worth to
   * their wallet, which is what the invariant compares.
   */
  const held = (sellerId: string): string =>
    bank
      .filter((b) => b.ownerKind === 'SELLER' && b.sellerId === sellerId)
      .reduce(
        (t, b) => t.add(b.currency === 'INR' ? b.signedAmount : (b.inrBookValue ?? ZERO)),
        ZERO,
      )
      .toFixed(2);
  /** The units of one currency held for them — a spent holding must read 0. */
  const units = (sellerId: string, currency: string): string =>
    bank
      .filter((b) => b.ownerKind === 'SELLER' && b.sellerId === sellerId && b.currency === currency)
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  /** Our own rupees across the book. */
  const capital = (): string =>
    bank
      .filter((b) => b.ownerKind === 'CAPITAL' && b.currency === 'INR')
      .reduce((t, b) => t.add(b.signedAmount), ZERO)
      .toFixed(2);
  const owed = (sellerId: string): string => {
    const bal = wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO;
    return (bal.lessThan(0) ? ZERO : bal).toFixed(2);
  };
  const accountTotal = (): string =>
    bank
      .filter((b) => b.currency === 'INR')
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
  /**
   * Delivered under Instant Pay, as `AccrualExecutionService` does it: the
   * COD is fronted from capital (less any part that repays a debt), THEN
   * credited, so its tax and both fees find cash to make ours.
   */
  const deliverInstantPay = async (orderId: string): Promise<void> => {
    const o = orders.find((x) => x.id === orderId);
    if (o === undefined) throw new Error(`no order ${orderId}`);
    const gross = D(o.cod);
    if (!(await codCredit.isCredited(tx as never, orderId))) {
      const split = await attribution.debtSplit(tx as never, o.sellerId, gross);
      await attribution.front(tx as never, {
        sellerId: o.sellerId,
        amount: split.toSeller,
        accountId: 'hdfc',
        reference: orderId,
      });
    }
    await codCredit.creditForOrder(tx as never, {
      orderId,
      sellerId: o.sellerId,
      grossInr: gross,
      mode: 'INSTANT_PAY',
    });
  };
  /** The raw wallet balance — owed() clamps at zero and would hide a debt. */
  const balance = (sellerId: string): string =>
    (wallet.filter((r) => r.sellerId === sellerId).at(-1)?.runningBalanceAfter ?? ZERO).toFixed(2);
  /** Every wallet entry on an order, as `direction amount`. */
  const entriesOf = (orderId: string): string[] =>
    wallet
      .filter((r) => r.linkedOrderId === orderId)
      .map((r) => `${r.direction} ${r.amount.toFixed(2)}`);
  return {
    pay,
    owe,
    topUp,
    refund,
    held,
    units,
    owed,
    accountTotal,
    capital,
    deliverInstantPay,
    balance,
    entriesOf,
  };
}

type World = ReturnType<typeof makeWorld>;

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

  it('a taka top-up is theirs, and a charge beyond their rupees takes it at the top-up rate', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    // ৳10,000 credited as ₹8,000: ₹0.80 a taka.
    await w.topUp('s', '10000', '8000');
    expect(w.owed('s')).toBe('8847.46');
    expect(w.held('s')).toBe('8847.46');
    // ₹1,047.46 of charges: the ₹847.46 of rupees, then ₹200 = ৳250. It
    // used to stop at the rupees and leave the ₹200 "theirs" in taka.
    await w.owe('s', '1047.46');
    expect(w.owed('s')).toBe('7800.00');
    expect(w.held('s')).toBe('7800.00');
  });

  it('a taka top-up while in debt repays the debt first, in proportion', async () => {
    const w = makeWorld([]);
    await w.owe('s', '300');
    // ₹800 credited: ₹300 repays the debt (৳375 is ours), ₹500 is theirs (৳625).
    await w.topUp('s', '1000', '800');
    expect(w.owed('s')).toBe('500.00');
    expect(w.held('s')).toBe('500.00');
  });

  it('a refund while in debt repays the debt before any of it is theirs', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1000' }]);
    await w.pay('1000', [['a', '1000']]);
    await w.owe('s', '1000'); // 847.46 taken, 152.54 owed
    expect(w.held('s')).toBe('0.00');
    await w.refund('s', '100'); // still 52.54 in debt: nothing is theirs
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    await w.refund('s', '200'); // 52.54 repays the debt, 147.46 is theirs
    expect(w.owed('s')).toBe('147.46');
    expect(w.held('s')).toBe('147.46');
    expect(w.accountTotal()).toBe('1000.00');
  });

  it('a short-paid reversal takes the whole credit back — and capital recovers the gap it absorbed', async () => {
    // G = ₹1,000 credited on a COD the courier paid ₹950 for (capital
    // absorbed ₹50), tax ₹152.54. The courier then takes its ₹950 back on
    // a payout that also pays another seller's ₹2,000.
    const w = makeWorld([
      { id: 'a', sellerId: 's', cod: '1000' },
      { id: 'b', sellerId: 't', cod: '2000' },
    ]);
    await w.pay('950', [['a', '950']]);
    expect(w.held('s')).toBe('847.46');
    expect(w.capital()).toBe('102.54'); // 152.54 of tax less the 50 absorbed
    await w.pay('1050', [['b', '2000']], [['a', '950']]);
    // The seller is owed nothing and holds nothing: capped at the courier's
    // ₹950, ₹50 used to stay "theirs" for a wallet at zero.
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.owed('t')).toBe('1694.92');
    expect(w.held('t')).toBe('1694.92');
    expect(w.accountTotal()).toBe('2000.00');
    // All that is left ours is t's tax: the ₹50 absorbed on a came back.
    expect(w.capital()).toBe('305.08');
  });

  it('two taka top-ups at different rates are held at what was credited, and a charge of it all leaves nothing', async () => {
    // ৳1,000 credited ₹700, then ৳1,000 credited ₹800. Valued at the last
    // top-up's rate this read ৳2,000 × 0.80 = ₹1,600 against a ₹1,500
    // wallet, and a ₹1,500 charge took ৳1,875 and stranded ৳125 "theirs".
    const w = makeWorld([]);
    await w.topUp('s', '1000', '700');
    await w.topUp('s', '1000', '800');
    expect(w.owed('s')).toBe('1500.00');
    expect(w.held('s')).toBe('1500.00');
    await w.owe('s', '1500');
    expect(w.owed('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.units('s', 'BDT')).toBe('0.00');
  });

  it('charges in pieces go at the average rate, and the last one spends every unit exactly', async () => {
    const w = makeWorld([]);
    await w.topUp('s', '1000', '700');
    await w.topUp('s', '1000', '800');
    for (const charge of ['500', '333.33', '0.01', '666.66']) {
      await w.owe('s', charge);
      expect(w.held('s')).toBe(w.owed('s'));
    }
    expect(w.owed('s')).toBe('0.00');
    expect(w.units('s', 'BDT')).toBe('0.00');
  });

  describe('a COD reversal takes back what the wallet lost — whatever they held before it', () => {
    // s is paid ₹1,000 COD on a (₹847.46 after tax), moved to a starting
    // balance, then the courier takes a back on a payout that pays t ₹2,000.
    const run = async (moveTo: (w: World) => Promise<void>): Promise<World> => {
      const w = makeWorld([
        { id: 'a', sellerId: 's', cod: '1000' },
        { id: 'b', sellerId: 't', cod: '2000' },
      ]);
      await w.pay('1000', [['a', '1000']]);
      await moveTo(w);
      await w.pay('1000', [['b', '2000']], [['a', '1000']]);
      expect(w.accountTotal()).toBe('2000.00');
      expect(w.held('t')).toBe(w.owed('t'));
      return w;
    };

    it('starting at ₹0: nothing held before, nothing after', async () => {
      const w = await run((x) => x.owe('s', '847.46'));
      expect(w.owed('s')).toBe('0.00');
      expect(w.held('s')).toBe('0.00');
    });

    it('starting between the COD less its tax and the COD (₹900): the returned tax stays theirs', async () => {
      // 900 − 1,000 + 152.54 = 52.54. Taking the whole ₹1,000 after the
      // tax refund had moved in took the refund too, and held them ₹0.
      const w = await run((x) => x.refund('s', '52.54'));
      expect(w.owed('s')).toBe('52.54');
      expect(w.held('s')).toBe('52.54');
    });

    it('starting above the COD (₹1,500)', async () => {
      const w = await run((x) => x.refund('s', '652.54'));
      expect(w.owed('s')).toBe('652.54');
      expect(w.held('s')).toBe('652.54');
    });

    it('starting in debt (−₹200): nothing to take, and the debt grows by the reversal', async () => {
      const w = await run((x) => x.owe('s', '1047.46'));
      expect(w.owed('s')).toBe('0.00');
      expect(w.held('s')).toBe('0.00');
    });
  });
});

/**
 * The COD fee and the Instant Pay fee are INDEPENDENT (2026-09-12): the COD
 * fee on every COD credit, the Instant Pay fee on top of it for an Instant
 * Pay credit. Each is a charge, so each makes the seller's cash ours — and
 * the book must still hold exactly what the wallet owes after every step.
 * ₹1,180 at 18%: tax ₹180; 1% COD fee ₹10; 2.5% Instant Pay ₹25.
 */
describe('both COD fees keep the book equal to the wallet', () => {
  const FEES = { collection: '1.00', instant: '2.50' };

  it('a settled COD pays the COD fee only, and it is ours', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.pay('1180', [['a', '1180']]);
    expect(w.owed('s')).toBe('990.00');
    expect(w.held('s')).toBe('990.00');
    expect(w.accountTotal()).toBe('1180.00');
    expect(w.capital()).toBe('190.00'); // tax 180 + COD fee 10
    expect(w.entriesOf('a')).toEqual([
      'COD_COLLECTION 1180.00',
      'GST_WITHHOLDING 180.00',
      'COD_COLLECTION_FEE 10.00',
    ]);
  });

  it('an Instant Pay COD is fronted, pays BOTH fees, and the payout repays the front', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.deliverInstantPay('a');
    expect(w.owed('s')).toBe('965.00');
    expect(w.held('s')).toBe('965.00');
    // Fronting is a zero-sum pair: nothing has arrived yet.
    expect(w.accountTotal()).toBe('0.00');
    expect(w.entriesOf('a')).toEqual([
      'COD_COLLECTION 1180.00',
      'GST_WITHHOLDING 180.00',
      'COD_COLLECTION_FEE 10.00',
      'INSTANT_PAY_FEE 25.00',
    ]);
    // The courier pays: the order is already credited, so the cash is
    // capital's, repaying what we fronted. The seller is untouched.
    await w.pay('1180', [['a', '1180']]);
    expect(w.owed('s')).toBe('965.00');
    expect(w.held('s')).toBe('965.00');
    expect(w.accountTotal()).toBe('1180.00');
    expect(w.capital()).toBe('215.00'); // tax 180 + COD fee 10 + Instant Pay 25
  });

  it('an Instant Pay COD with a debt behind it: the debt is repaid first, fees still ours', async () => {
    const w = makeWorld([{ id: 'a', sellerId: 's', cod: '1180' }], FEES);
    await w.owe('s', '300');
    await w.deliverInstantPay('a');
    expect(w.owed('s')).toBe('665.00'); // 965 − 300
    expect(w.held('s')).toBe('665.00');
  });

  it('reversing an Instant Pay COD returns the tax and BOTH fees, once each', async () => {
    const w = makeWorld(
      [
        { id: 'a', sellerId: 's', cod: '1180' },
        { id: 'b', sellerId: 't', cod: '2000' },
      ],
      FEES,
    );
    await w.deliverInstantPay('a');
    await w.pay('1180', [['a', '1180']]);
    // Payout 2 pays b (settled: tax 305.08, COD fee 16.95) and claws back a.
    await w.pay('820', [['b', '2000']], [['a', '1180']]);
    // 965 − 1180 + 180 + 10 + 25 = 0 — not −25 or −10, which a fee left
    // unreturned would leave (owed() would clamp that to 0 and hide it).
    expect(w.balance('s')).toBe('0.00');
    expect(w.held('s')).toBe('0.00');
    expect(w.entriesOf('a').filter((e) => e.startsWith('COD_DEDUCTION_REFUND'))).toEqual([
      'COD_DEDUCTION_REFUND 180.00',
      'COD_DEDUCTION_REFUND 10.00',
      'COD_DEDUCTION_REFUND 25.00',
    ]);
    expect(w.owed('t')).toBe('1677.97'); // 2000 − 305.08 − 16.95
    expect(w.held('t')).toBe('1677.97');
    expect(w.accountTotal()).toBe('2000.00');
  });
});

/**
 * A transfer between our own accounts MOVES a seller's money and never
 * changes what their wallet owes them. The REAL BankLedgerService and
 * BankTransferService run here over an in-memory book: the wallet is
 * whatever they were credited before the move (a transfer never writes
 * one), and after every move the book must still equal it while each
 * account moves by exactly what its statement shows.
 */
function makeBook() {
  const ACCOUNTS: Record<string, Currency> = { hdfc: Currency.INR, tasin: Currency.BDT };
  const rows: BankRow[] = [];
  let wallet = ZERO;
  let seq = 0;
  const sum = (xs: Prisma.Decimal[]): Prisma.Decimal => xs.reduce((t, x) => t.add(x), ZERO);

  const db: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => 1),
    platformBankAccount: {
      findUnique: jest.fn(async (a: { where: { id: string } }) => {
        const currency = ACCOUNTS[a.where.id];
        return currency === undefined
          ? null
          : { id: a.where.id, label: a.where.id, currency, deletedAt: null };
      }),
    },
    bankEntry: {
      create: jest.fn(
        async (a: {
          data: {
            accountId: string;
            currency: string;
            ownerKind: string;
            sellerId: string | null;
            signedAmount: Prisma.Decimal;
            inrBookValue: Prisma.Decimal | null;
          };
        }) => {
          rows.push({
            accountId: a.data.accountId,
            currency: a.data.currency,
            ownerKind: a.data.ownerKind,
            sellerId: a.data.sellerId,
            signedAmount: a.data.signedAmount,
            inrBookValue: a.data.inrBookValue,
          });
          return { id: `be-${(seq += 1)}` };
        },
      ),
      aggregate: jest.fn(
        async (a: { where: { accountId: string; ownerKind: string; sellerId?: string } }) => {
          const hit = rows.filter(
            (r) =>
              r.accountId === a.where.accountId &&
              r.ownerKind === a.where.ownerKind &&
              (a.where.sellerId === undefined || r.sellerId === a.where.sellerId),
          );
          return {
            _sum: {
              signedAmount: sum(hit.map((r) => r.signedAmount)),
              inrBookValue: sum(hit.map((r) => r.inrBookValue ?? ZERO)),
            },
          };
        },
      ),
    },
    bankTransfer: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: `t-${(seq += 1)}` })),
    },
    expenseCategory: { upsert: jest.fn(async () => ({ id: 'cat-bank' })) },
    // 1 INR = 1.25 BDT today — reached only by a row nobody valued.
    fxRate: { findFirst: jest.fn(async () => ({ fromCurrency: Currency.INR, rate: D('1.25') })) },
  };
  db['$transaction'] = async (fn: (t: unknown) => unknown) => fn(db);
  const audit = { log: jest.fn(async () => 'a1') };
  const ledger = new BankLedgerService({ client: db } as never, audit as never);
  const transfers = new BankTransferService({ client: db } as never, ledger, audit as never);

  /** Money that arrived as theirs, and the rupees their wallet was credited for it. */
  const fund = async (
    sellerId: string,
    accountId: string,
    units: string,
    credited: string,
  ): Promise<void> => {
    wallet = wallet.add(D(credited));
    await ledger.post({
      accountId,
      type: BankEntryType.SELLER_TOPUP,
      signedAmount: units,
      amountCurrency: ACCOUNTS[accountId] ?? Currency.INR,
      owner: { kind: BankOwnerKind.SELLER, sellerId },
      occurredAt: new Date(),
      inrBookValue: D(credited),
    });
  };
  const move = (input: {
    fromAccountId: string;
    toAccountId: string;
    amountOut: string;
    amountIn: string;
    quotedRate?: string;
    sellerId: string;
  }) => transfers.transfer({ ...input, movedAt: new Date(), staffId: 'staff-1' });
  const mine = (sellerId: string, accountId?: string): BankRow[] =>
    rows.filter(
      (r) =>
        r.ownerKind === 'SELLER' &&
        r.sellerId === sellerId &&
        (accountId === undefined || r.accountId === accountId),
    );
  /** Rupees at face, anything else at its book value — what the invariant compares. */
  const held = (sellerId: string): string =>
    sum(
      mine(sellerId).map((r) => (r.currency === 'INR' ? r.signedAmount : (r.inrBookValue ?? ZERO))),
    ).toFixed(2);
  const units = (sellerId: string, accountId: string): string =>
    sum(mine(sellerId, accountId).map((r) => r.signedAmount)).toFixed(2);
  const book = (sellerId: string, accountId: string): string =>
    sum(mine(sellerId, accountId).map((r) => r.inrBookValue ?? ZERO)).toFixed(2);
  /** Everything in the account, every owner: what its statement shows. */
  const total = (accountId: string): string =>
    sum(rows.filter((r) => r.accountId === accountId).map((r) => r.signedAmount)).toFixed(2);
  const owed = (): string => (wallet.lessThan(0) ? ZERO : wallet).toFixed(2);
  return { fund, move, held, units, book, total, owed, rows };
}

describe('a transfer moves a seller’s money and never changes what their wallet owes them', () => {
  it('quoted rupees → taka: the quoted taka carry the rupees that left; the gap is our FX', async () => {
    const b = makeBook();
    await b.fund('s', 'hdfc', '1000', '1000');
    const r = await b.move({
      fromAccountId: 'hdfc',
      toAccountId: 'tasin',
      amountOut: '1000',
      amountIn: '1350',
      quotedRate: '1.30',
      sellerId: 's',
    });
    expect(r.creditedToSeller).toBe('1300.00');
    expect(r.fxSpread).toBe('50.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.held('s')).toBe('1000.00');
    expect(b.units('s', 'tasin')).toBe('1300.00');
    expect(b.book('s', 'tasin')).toBe('1000.00');
    expect(b.total('hdfc')).toBe('0.00');
    expect(b.total('tasin')).toBe('1350.00');
  });

  it('unquoted taka → rupees at a rate off their average: credited the book, the gap is ours', async () => {
    // ৳2,000 credited ₹1,500 (average 0.75); the bank gives 0.74.
    const b = makeBook();
    await b.fund('s', 'tasin', '2000', '1500');
    const r = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '2000',
      amountIn: '1480',
      sellerId: 's',
    });
    expect(r.creditedToSeller).toBe('1500.00');
    expect(r.fxSpread).toBe('-20.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.units('s', 'tasin')).toBe('0.00');
    expect(b.book('s', 'tasin')).toBe('0.00');
    expect(b.total('hdfc')).toBe('1480.00');
    expect(b.total('tasin')).toBe('0.00');
  });

  it('quoted taka → rupees is REFUSED and the book is untouched', async () => {
    // Obeyed, a 0.80 quote held them ₹1,600 against a ₹1,500 wallet:
    // (quote − average) × units = 0.05 × 2,000 = ₹100 of cash that is theirs
    // in the book and in no wallet.
    const b = makeBook();
    await b.fund('s', 'tasin', '2000', '1500');
    const before = b.rows.length;
    await expect(
      b.move({
        fromAccountId: 'tasin',
        toAccountId: 'hdfc',
        amountOut: '2000',
        amountIn: '1480',
        quotedRate: '0.80',
        sellerId: 's',
      }),
    ).rejects.toMatchObject({ response: { code: 'TRANSFER_QUOTE_INTO_WALLET_CURRENCY' } });
    expect(b.rows).toHaveLength(before);
    expect(b.held('s')).toBe('1500.00');
    expect(b.held('s')).toBe(b.owed());
  });

  it('two taka lots at different rates, moved to rupees in parts, go at the average', async () => {
    // ৳1,000 credited ₹700 and ৳1,000 credited ₹800: ৳2,000 worth ₹1,500.
    const b = makeBook();
    await b.fund('s', 'tasin', '1000', '700');
    await b.fund('s', 'tasin', '1000', '800');
    const first = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '1000',
      amountIn: '770',
      sellerId: 's',
    });
    expect(first.creditedToSeller).toBe('750.00');
    expect(first.fxSpread).toBe('20.00');
    expect(b.held('s')).toBe(b.owed());
    // What stays behind keeps the same average.
    expect(b.units('s', 'tasin')).toBe('1000.00');
    expect(b.book('s', 'tasin')).toBe('750.00');

    const rest = await b.move({
      fromAccountId: 'tasin',
      toAccountId: 'hdfc',
      amountOut: '1000',
      amountIn: '740',
      sellerId: 's',
    });
    expect(rest.creditedToSeller).toBe('750.00');
    expect(rest.fxSpread).toBe('-10.00');
    expect(b.held('s')).toBe(b.owed());
    expect(b.held('s')).toBe('1500.00');
    expect(b.units('s', 'tasin')).toBe('0.00');
    expect(b.book('s', 'tasin')).toBe('0.00');
    expect(b.total('hdfc')).toBe('1510.00');
    expect(b.total('tasin')).toBe('0.00');
  });
});
