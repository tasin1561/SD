import { BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import {
  AdvisoryLock,
  ATTRIBUTION_RECONCILE_KEY,
  accountReconcileKey,
  advisoryKey,
} from '../../src/common/db/advisory-lock';
import { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

/**
 * The ledger's own guarantees for three 2026-09-12 fixes:
 *
 *  - every SELLER entry in a non-rupee account carries its rupee BOOK
 *    value, valued here when the caller did not (item 1);
 *  - an OPENING balance is marked by the operator, capital only, once per
 *    account, and reconcile holds the attribution key (items 6 and 8);
 *  - owner money is idempotent on the form's key (item 9).
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

interface PriorEntry {
  id: string;
  accountId: string;
  type: BankEntryType;
  signedAmount: Prisma.Decimal;
  occurredAt: Date;
  reference: string | null;
}

function makeLedger(
  opts: {
    accountCurrency?: Currency;
    /** The seller's rows already in the account: units, and their rupee book. */
    sellerHolding?: { units: string; book: string };
    /** "1 fromCurrency = rate toCurrency". */
    fx?: { fromCurrency: Currency; rate: string } | null;
    existingOpening?: boolean;
    priorEntry?: PriorEntry | null;
    /** Thrown by the FIRST create, as a unique-index race would. */
    createThrows?: unknown;
  } = {},
) {
  const created: Array<Record<string, unknown>> = [];
  const locks: Array<[number, number]> = [];
  let createCalls = 0;
  const currency = opts.accountCurrency ?? Currency.INR;
  const findUnique = jest.fn<Promise<PriorEntry | null>, [unknown]>(
    async () => opts.priorEntry ?? null,
  );
  const db: Record<string, unknown> = {
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ns: number, key: number) => {
      locks.push([ns, key]);
      return 1;
    }),
    platformBankAccount: {
      findUnique: jest.fn(async (a: { where: { id: string } }) => ({
        id: a.where.id,
        currency,
        deletedAt: null,
      })),
      findUniqueOrThrow: jest.fn(async () => ({ currency })),
      findFirst: jest.fn(async () => ({ currency, label: 'Tasin City' })),
    },
    bankEntry: {
      create: jest.fn(async (a: { data: Record<string, unknown> }) => {
        createCalls += 1;
        if (opts.createThrows !== undefined && createCalls === 1) throw opts.createThrows;
        created.push(a.data);
        return { id: `be-${created.length}` };
      }),
      aggregate: jest.fn(async (a: { where: { ownerKind: BankOwnerKind } }) =>
        a.where.ownerKind === BankOwnerKind.SELLER && opts.sellerHolding
          ? {
              _sum: {
                signedAmount: D(opts.sellerHolding.units),
                inrBookValue: D(opts.sellerHolding.book),
              },
            }
          : { _sum: { signedAmount: D('0'), inrBookValue: null } },
      ),
      findFirst: jest.fn(async () =>
        opts.existingOpening ? { occurredAt: new Date('2026-09-01T00:00:00Z') } : null,
      ),
      findUnique,
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    fxRate: {
      findFirst: jest.fn(async () =>
        opts.fx ? { fromCurrency: opts.fx.fromCurrency, rate: D(opts.fx.rate) } : null,
      ),
    },
  };
  db['$transaction'] = async (fn: (t: unknown) => unknown) => fn(db);
  const audit = { log: jest.fn(async () => 'a1') };
  const svc = new BankLedgerService({ client: db } as never, audit as never);
  const updateMany = (db['bankEntry'] as { updateMany: jest.Mock }).updateMany;
  return { svc, created, locks, findUnique, audit, updateMany };
}

const SELLER = { kind: BankOwnerKind.SELLER, sellerId: 's1' } as const;
const CAPITAL = { kind: BankOwnerKind.CAPITAL } as const;
const AT = new Date('2026-09-12T10:00:00Z');

describe('BankLedgerService.post — a seller’s money in another currency carries its rupee book', () => {
  const post = (
    svc: BankLedgerService,
    signedAmount: string,
    owner: typeof SELLER | typeof CAPITAL = SELLER,
    extra: Record<string, unknown> = {},
  ) =>
    svc.post({
      accountId: 'tasin',
      type: BankEntryType.RECONCILIATION_ADJUSTMENT,
      signedAmount,
      amountCurrency: Currency.BDT,
      owner,
      occurredAt: AT,
      ...extra,
    });

  it('money arriving unvalued is valued at today’s rate', async () => {
    // 1 INR = 1.25 BDT, so ৳1,000 is ₹800.
    const { svc, created } = makeLedger({
      accountCurrency: Currency.BDT,
      fx: { fromCurrency: Currency.INR, rate: '1.25' },
    });
    await post(svc, '1000');
    expect(String(created[0]?.['inrBookValue'])).toBe('800');
  });

  it('money leaving unvalued goes at their AVERAGE rate there', async () => {
    // ৳2,000 worth ₹1,500: ৳500 of it is ₹375.
    const { svc, created } = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '2000', book: '1500' },
      fx: { fromCurrency: Currency.INR, rate: '1.25' },
    });
    await post(svc, '-500');
    expect(String(created[0]?.['inrBookValue'])).toBe('-375');
  });

  it('all of the units leaving take all of the book — a spent holding is exactly zero', async () => {
    const { svc, created } = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '3', book: '2' },
    });
    await post(svc, '-3');
    expect(String(created[0]?.['inrBookValue'])).toBe('-2');
  });

  it('keeps a value the caller gave, and stores none for rupees or for capital', async () => {
    const taka = makeLedger({ accountCurrency: Currency.BDT });
    await post(taka.svc, '100', SELLER, { inrBookValue: D('70.004') });
    expect(String(taka.created[0]?.['inrBookValue'])).toBe('70');
    await post(taka.svc, '100', CAPITAL);
    expect(taka.created[1]?.['inrBookValue']).toBeNull();

    const rupees = makeLedger({ accountCurrency: Currency.INR });
    await rupees.svc.post({
      accountId: 'hdfc',
      type: BankEntryType.RECONCILIATION_ADJUSTMENT,
      signedAmount: '100',
      amountCurrency: Currency.INR,
      owner: SELLER,
      occurredAt: AT,
      inrBookValue: D('99'),
    });
    expect(rupees.created[0]?.['inrBookValue']).toBeNull();
  });

  it('values the whole-holding case at the book itself through inrValueOfSellerUnits', async () => {
    const { svc } = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '2000', book: '1500' },
    });
    await expect(
      svc.inrValueOfSellerUnits('s1', 'tasin', Currency.BDT, D('2000')),
    ).resolves.toEqual(D('1500'));
    await expect(
      svc.inrValueOfSellerUnits('s1', 'tasin', Currency.BDT, D('1000')),
    ).resolves.toEqual(D('750'));
  });
});

describe('BankLedgerService.reconcile — the opening balance is MARKED', () => {
  const BASE = {
    accountId: 'tasin',
    statedBalance: '100000',
    reason: 'Initial balance from the bank statement',
    staffId: 'staff-1',
  };

  it('posts the mark on the entry it writes', async () => {
    const { svc, created } = makeLedger({ accountCurrency: Currency.BDT });
    await svc.reconcile({ ...BASE, owner: CAPITAL, isOpeningBalance: true });
    expect(created[0]).toMatchObject({
      type: BankEntryType.RECONCILIATION_ADJUSTMENT,
      isOpeningBalance: true,
    });
  });

  it('an ordinary correction is not an opening balance', async () => {
    const { svc, created } = makeLedger({ accountCurrency: Currency.BDT });
    await svc.reconcile({ ...BASE, owner: CAPITAL });
    expect(created[0]?.['isOpeningBalance']).toBe(false);
  });

  it('refuses a SELLER opening balance — their money arrives with a reason of its own', async () => {
    const { svc, created } = makeLedger();
    await expect(
      svc.reconcile({ ...BASE, owner: SELLER, isOpeningBalance: true }),
    ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_CAPITAL_ONLY' } });
    expect(created).toHaveLength(0);
  });

  it('refuses a second opening balance on the same account', async () => {
    const { svc, created } = makeLedger({ existingOpening: true });
    await expect(
      svc.reconcile({ ...BASE, owner: CAPITAL, isOpeningBalance: true }),
    ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_EXISTS' } });
    expect(created).toHaveLength(0);
  });

  it('holds the ACCOUNT key then the attribution key, so nothing lands mid-correction', async () => {
    // The account key, not a per-owner one: every writer posting a
    // non-pair row into this account takes the same key.
    const { svc, locks } = makeLedger();
    await svc.reconcile({ ...BASE, owner: CAPITAL });
    expect(locks).toEqual([
      [AdvisoryLock.BANK_RECONCILE, advisoryKey(accountReconcileKey('tasin'))],
      [AdvisoryLock.BANK_RECONCILE, advisoryKey(ATTRIBUTION_RECONCILE_KEY)],
    ]);
  });
});

describe('BankLedgerService.reconcile — a seller’s taka holding carries a stated rupee value', () => {
  const BASE = {
    accountId: 'tasin',
    reason: 'Statement shows less held for them than the book',
    staffId: 'staff-1',
  };

  it('refuses a correction of a seller’s taka holding with no rupee value', async () => {
    const { svc, created } = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '1000', book: '800' },
    });
    await expect(
      svc.reconcile({ ...BASE, owner: SELLER, statedBalance: '900' }),
    ).rejects.toMatchObject({ response: { code: 'INR_VALUE_REQUIRED' } });
    expect(created).toHaveLength(0);
  });

  it('posts the stated value with the difference’s sign', async () => {
    const { svc, created, audit } = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '1000', book: '800' },
    });
    await svc.reconcile({ ...BASE, owner: SELLER, statedBalance: '900', inrValue: '80' });
    expect((created[0]?.['signedAmount'] as Prisma.Decimal).toFixed(2)).toBe('-100.00');
    expect((created[0]?.['inrBookValue'] as Prisma.Decimal).toFixed(2)).toBe('-80.00');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ inrValue: '80.00' }) }),
    );
  });

  it('refuses a rupee value on a rupee account, and a non-positive one anywhere', async () => {
    const inr = makeLedger({ sellerHolding: { units: '1000', book: '1000' } });
    await expect(
      inr.svc.reconcile({ ...BASE, owner: SELLER, statedBalance: '900', inrValue: '100' }),
    ).rejects.toMatchObject({ response: { code: 'INR_VALUE_NOT_APPLICABLE' } });
    const bdt = makeLedger({
      accountCurrency: Currency.BDT,
      sellerHolding: { units: '1000', book: '800' },
    });
    await expect(
      bdt.svc.reconcile({ ...BASE, owner: SELLER, statedBalance: '900', inrValue: '0' }),
    ).rejects.toMatchObject({ response: { code: 'INR_VALUE_INVALID' } });
  });
});

describe('BankLedgerService.markOpeningBalance — an existing entry can be MARKED', () => {
  const ENTRY = {
    id: 'be-9',
    accountId: 'tasin',
    type: BankEntryType.RECONCILIATION_ADJUSTMENT,
    ownerKind: BankOwnerKind.CAPITAL,
    isOpeningBalance: false,
    signedAmount: D('100000'),
    currency: Currency.BDT,
    occurredAt: AT,
  };
  const INPUT = { entryId: 'be-9', reason: 'The statement balance on day one', staffId: 's' };

  it('marks an eligible capital entry, guarded, under the account key, audited HIGH', async () => {
    const { svc, locks, audit, updateMany } = makeLedger({
      priorEntry: ENTRY as unknown as PriorEntry,
    });
    await expect(svc.markOpeningBalance(INPUT)).resolves.toEqual({
      entryId: 'be-9',
      accountId: 'tasin',
    });
    expect(locks).toEqual([
      [AdvisoryLock.BANK_RECONCILE, advisoryKey(accountReconcileKey('tasin'))],
    ]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'be-9', isOpeningBalance: false },
      data: { isOpeningBalance: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.bank_account.opening_balance_marked',
        severity: 'HIGH',
      }),
    );
  });

  it('refuses a seller’s entry, and a movement with a cause of its own', async () => {
    for (const bad of [
      { ...ENTRY, ownerKind: BankOwnerKind.SELLER },
      { ...ENTRY, type: BankEntryType.TRANSFER_IN },
    ]) {
      const { svc, updateMany } = makeLedger({ priorEntry: bad as unknown as PriorEntry });
      await expect(svc.markOpeningBalance(INPUT)).rejects.toMatchObject({
        response: { code: 'OPENING_BALANCE_NOT_ELIGIBLE' },
      });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('refuses a second opening balance on the account', async () => {
    const { svc, updateMany } = makeLedger({
      priorEntry: ENTRY as unknown as PriorEntry,
      existingOpening: true,
    });
    await expect(svc.markOpeningBalance(INPUT)).rejects.toMatchObject({
      response: { code: 'OPENING_BALANCE_EXISTS' },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses a short reason', async () => {
    const { svc } = makeLedger({ priorEntry: ENTRY as unknown as PriorEntry });
    await expect(svc.markOpeningBalance({ ...INPUT, reason: 'day one' })).rejects.toMatchObject({
      response: { code: 'BANK_REASON_TOO_SHORT' },
    });
  });
});

describe('BankLedgerService.recordOwnerMoney — a retried request posts once', () => {
  const KEY = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
  const INPUT = {
    accountId: 'tasin',
    direction: 'IN' as const,
    amount: '5000',
    occurredAt: AT,
    reason: 'Founder capital for October stock',
    staffId: 'staff-1',
    idempotencyKey: KEY,
  };
  const PRIOR: PriorEntry = {
    id: 'be-0',
    accountId: 'tasin',
    type: BankEntryType.OWNER_CONTRIBUTION,
    signedAmount: D('5000'),
    occurredAt: AT,
    reference: null,
  };

  it('the same key returns the entry already recorded and posts nothing', async () => {
    const { svc, created, audit } = makeLedger({ priorEntry: PRIOR });
    await expect(svc.recordOwnerMoney(INPUT)).resolves.toEqual({ id: 'be-0' });
    expect(created).toHaveLength(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuses the same key sent with a different amount or direction', async () => {
    const { svc } = makeLedger({ priorEntry: PRIOR });
    await expect(svc.recordOwnerMoney({ ...INPUT, amount: '5001' })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    await expect(svc.recordOwnerMoney({ ...INPUT, direction: 'OUT' })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('refuses the same key sent with a different date or reference', async () => {
    const { svc, created } = makeLedger({ priorEntry: PRIOR });
    await expect(
      svc.recordOwnerMoney({ ...INPUT, occurredAt: new Date('2026-09-13T10:00:00Z') }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    await expect(svc.recordOwnerMoney({ ...INPUT, reference: 'NEFT-1' })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(created).toHaveLength(0);
  });

  it('posts under the account’s reconcile key', async () => {
    const { svc, locks } = makeLedger();
    await svc.recordOwnerMoney(INPUT);
    expect(locks).toEqual([
      [AdvisoryLock.BANK_RECONCILE, advisoryKey(accountReconcileKey('tasin'))],
    ]);
  });

  it('two copies racing: the loser answers with the winner’s entry', async () => {
    const race = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const { svc, findUnique } = makeLedger({ priorEntry: PRIOR, createThrows: race });
    findUnique.mockResolvedValueOnce(null);
    await expect(svc.recordOwnerMoney(INPUT)).resolves.toEqual({ id: 'be-0' });
  });

  it('stores the key on the entry it posts', async () => {
    const { svc, created } = makeLedger();
    await svc.recordOwnerMoney(INPUT);
    expect(created[0]).toMatchObject({ idempotencyKey: KEY });
  });
});
