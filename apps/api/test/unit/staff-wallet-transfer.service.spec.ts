import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@skydrop/db';
import { ALL_PERMISSION_KEYS } from '../../src/common/auth/permissions';
import {
  StaffWalletTransferService,
  type StaffTransferInput,
  possessive,
} from '../../src/modules/admin-wallet-transfer/services/staff-wallet-transfer.service';

/**
 * The guards around a staff wallet transfer. The cash arithmetic itself is
 * proved against an in-memory book in `settlement-bank-invariant.spec.ts`;
 * this pins what is refused, what a replay answers, and what is recorded.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const REASON = 'Agreed with the seller on the phone on 12 September';
const SELLER = '0190a000-0000-7000-8000-000000000001';
const ACCOUNT = '0190a000-0000-7000-8000-0000000000aa';

function build(
  opts: {
    seller?: { companyName: string; status: string } | null;
    account?: { currency: string; label: string } | null;
    prior?: Record<string, unknown> | null;
    priorPair?: { accountId: string } | null;
    capital?: string;
    split?: { toCapital: string; toSeller: string };
  } = {},
) {
  const tx: Record<string, unknown> = {
    $executeRaw: jest.fn(async () => 1),
    seller: {
      findFirst: jest.fn(async () =>
        opts.seller === undefined
          ? { companyName: 'Menev Store', status: 'APPROVED' }
          : opts.seller,
      ),
    },
    platformBankAccount: {
      findFirst: jest.fn(async () =>
        opts.account === undefined ? { currency: 'INR', label: 'HDFC' } : opts.account,
      ),
      findMany: jest.fn(async () => [{ id: ACCOUNT, label: 'HDFC' }]),
    },
    sellerWalletEntry: {
      findUnique: jest.fn(async () => opts.prior ?? null),
    },
    bankEntry: { findFirst: jest.fn(async () => opts.priorPair ?? null) },
  };
  tx['$transaction'] = jest.fn(async (fn: (t: unknown) => unknown) => fn(tx));
  const wallet = {
    applyEntry: jest.fn(async () => ({ id: 'entry-1', runningBalanceAfter: D('400') })),
  };
  const ledger = {
    ownerBalance: jest.fn(async () => D(opts.capital ?? '10000')),
  };
  const cash = {
    walletBalance: jest.fn(async () => D('-100')),
    sellerHoldings: jest.fn(async () => []),
    debtSplit: jest.fn(async () => ({
      toCapital: D(opts.split?.toCapital ?? '100'),
      toSeller: D(opts.split?.toSeller ?? '400'),
    })),
    planTakeToCapital: jest.fn(async () => ({ moves: [], taken: D('0') })),
    giveFromCapital: jest.fn(async () => undefined),
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const svc = new StaffWalletTransferService(
    { client: tx } as never,
    wallet as never,
    ledger as never,
    cash as never,
    audit as never,
  );
  return { svc, tx, wallet, ledger, cash, audit };
}

const credit = (over: Partial<StaffTransferInput> = {}): StaffTransferInput => ({
  sellerId: SELLER,
  direction: 'CREDIT',
  amountInr: '500',
  bankAccountId: ACCOUNT,
  reason: REASON,
  staffId: 'staff-1',
  ...over,
});

describe('StaffWalletTransferService — refusals', () => {
  it.each([
    ['a reason under 20 characters', { reason: 'too short' }, 'WALLET_TRANSFER_REASON_TOO_SHORT'],
    ['a zero amount', { amountInr: '0' }, 'WALLET_TRANSFER_AMOUNT_INVALID'],
    ['a negative amount', { amountInr: '-5' }, 'WALLET_TRANSFER_AMOUNT_INVALID'],
    ['three decimals', { amountInr: '10.005' }, 'WALLET_TRANSFER_AMOUNT_INVALID'],
    ['a credit with no account', { bankAccountId: null }, 'WALLET_TRANSFER_ACCOUNT_REQUIRED'],
    [
      'a debit that names an account',
      { direction: 'DEBIT' as const },
      'WALLET_TRANSFER_ACCOUNT_NOT_FOR_DEBIT',
    ],
  ])('refuses %s before reading anything', async (_label, over, code) => {
    const w = build();
    await expect(w.svc.execute(credit(over))).rejects.toMatchObject({ response: { code } });
    expect(w.tx['$transaction']).not.toHaveBeenCalled();
    expect(w.wallet.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses a retired (or missing) account', async () => {
    const w = build({ account: null });
    await expect(w.svc.execute(credit())).rejects.toMatchObject({
      response: { code: 'BANK_ACCOUNT_NOT_FOUND' },
    });
    expect(w.wallet.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses a non-rupee account for a credit', async () => {
    const w = build({ account: { currency: 'BDT', label: 'Tasin City' } });
    await expect(w.svc.execute(credit())).rejects.toMatchObject({
      response: { code: 'WALLET_TRANSFER_ACCOUNT_NOT_INR' },
    });
  });

  it('refuses a seller who is not approved or suspended', async () => {
    const w = build({ seller: { companyName: 'Menev Store', status: 'PENDING' } });
    await expect(w.svc.execute(credit())).rejects.toMatchObject({
      response: { code: 'WALLET_TRANSFER_SELLER_NOT_ACTIVE' },
    });
  });

  it('refuses a deleted seller as not found', async () => {
    const w = build({ seller: null });
    await expect(w.svc.execute(credit())).rejects.toMatchObject({
      response: { code: 'SELLER_NOT_FOUND' },
    });
  });

  it('refuses a credit our money in the account cannot cover', async () => {
    const w = build({ capital: '50' });
    await expect(w.svc.execute(credit())).rejects.toMatchObject({
      response: { code: 'WALLET_TRANSFER_CAPITAL_SHORT' },
    });
    expect(w.wallet.applyEntry).not.toHaveBeenCalled();
  });
});

describe('StaffWalletTransferService — what it writes', () => {
  it('a credit writes STAFF_CREDIT with the reason as the note, then gives only the part above zero', async () => {
    const w = build();
    const out = await w.svc.execute(
      credit({ idempotencyKey: '0190a000-0000-4000-8000-00000000cafe' }),
    );
    expect(w.wallet.applyEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        direction: 'STAFF_CREDIT',
        note: REASON,
        actorType: 'STAFF',
        actorId: 'staff-1',
        idempotencyKey: '0190a000-0000-4000-8000-00000000cafe',
      }),
    );
    expect(w.cash.giveFromCapital).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: ACCOUNT, reference: 'entry-1' }),
    );
    const given = (w.cash.giveFromCapital.mock.calls[0] as unknown[])[1] as {
      amount: Prisma.Decimal;
    };
    expect(given.amount.toFixed(2)).toBe('400.00');
    expect(out).toMatchObject({ walletEntryId: 'entry-1', replayed: false });
    expect(out.preview?.sentence).toMatch(/₹100\.00 clears what they owed us/);
  });

  it('audits every transfer HIGH, with the internal note kept to the audit row', async () => {
    const w = build();
    await w.svc.execute(credit({ internalNote: 'Owner said yes on WhatsApp' }));
    expect(w.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'staff.wallet_transfer.posted',
        entityType: 'seller_wallet_entry',
        entityId: 'entry-1',
        severity: 'HIGH',
        metadata: expect.objectContaining({ internalNote: 'Owner said yes on WhatsApp' }),
      }),
    );
  });

  it('a debit moves its cash through the wallet (the charge path), never giveFromCapital', async () => {
    const w = build();
    await w.svc.execute(credit({ direction: 'DEBIT', bankAccountId: null }));
    expect(w.wallet.applyEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ direction: 'STAFF_DEBIT' }),
    );
    expect(w.cash.giveFromCapital).not.toHaveBeenCalled();
  });
});

describe('StaffWalletTransferService — IDEM-1', () => {
  const key = '0190a000-0000-4000-8000-00000000beef';
  const prior = {
    id: 'entry-0',
    sellerId: SELLER,
    direction: 'STAFF_CREDIT',
    amount: D('500'),
    runningBalanceAfter: D('400'),
  };

  it('a replay with the same material fields returns the original and writes nothing', async () => {
    const w = build({ prior, priorPair: { accountId: ACCOUNT } });
    const out = await w.svc.execute(credit({ idempotencyKey: key, reason: `${REASON} (retyped)` }));
    expect(out).toEqual({
      walletEntryId: 'entry-0',
      replayed: true,
      walletAfterInr: '400.00',
      preview: null,
    });
    expect(w.tx['$transaction']).not.toHaveBeenCalled();
    expect(w.wallet.applyEntry).not.toHaveBeenCalled();
    expect(w.audit.log).not.toHaveBeenCalled();
  });

  it.each([
    ['a different amount', { amountInr: '501' }],
    ['a different direction', { direction: 'DEBIT' as const, bankAccountId: null }],
    ['a different seller', { sellerId: '0190a000-0000-7000-8000-000000000002' }],
    ['a different account', { bankAccountId: '0190a000-0000-7000-8000-0000000000bb' }],
  ])('the same key with %s is refused', async (_label, over) => {
    const w = build({ prior, priorPair: { accountId: ACCOUNT } });
    await expect(w.svc.execute(credit({ idempotencyKey: key, ...over }))).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(w.wallet.applyEntry).not.toHaveBeenCalled();
  });
});

describe('the permission', () => {
  it('money.wallet.transfer exists and gates every handler of the controller', () => {
    expect(ALL_PERMISSION_KEYS).toContain('money.wallet.transfer');
    const src = readFileSync(
      join(
        __dirname,
        '../../src/modules/admin-wallet-transfer/controllers/admin-wallet-transfer.controller.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/@RequirePermissions\('money\.wallet\.transfer'\)\s*\n@Controller/);
    // No handler widens or narrows it.
    expect(src.match(/@RequirePermissions\(/g)).toHaveLength(1);
  });
});

describe('the preview sentence names the seller properly', () => {
  it("writes Traders' rather than Traders's", () => {
    expect(possessive('QA Test Traders')).toBe("QA Test Traders'");
    expect(possessive('Menev Store')).toBe("Menev Store's");
  });
});
