import { Prisma } from '@skydrop/db';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

/**
 * The COD payout arithmetic.
 *
 * This is the file to read before changing any of it, because the two
 * mistakes available here are both silent and both expensive.
 *
 * The first is treating the customer's price as tax-EXCLUSIVE and taking
 * 18% of it. On ₹1,000 that withholds ₹180 instead of ₹152.54 — ₹27.46
 * too much on every single order, about 2.75% of GMV, and a number that
 * would never reconcile against a filed return. Indian retail prices
 * include GST; the tax is already inside what the customer handed over.
 *
 * The second is netting the deductions into one credit. The seller
 * would see a number they cannot tie to their own order, and the
 * withheld tax — which we owe the government, not ourselves — would
 * vanish into the same pot as revenue.
 */

const SELLER = '019fad84-7acd-754e-8ee4-43cf858fed82';
const ORDER = '019fad84-7acd-754e-8ee4-43cf858fed83';

interface Entry {
  direction: string;
  amount: Prisma.Decimal;
}

function makeSut(opts: {
  gstPercent?: string;
  instantFeePercent?: string;
  alreadyCredited?: boolean;
}) {
  const entries: Entry[] = [];
  const withholdings: Array<Record<string, unknown>> = [];

  const tx = {
    sellerWalletEntry: {
      findFirst: jest.fn(async () => (opts.alreadyCredited ? { id: 'existing' } : null)),
    },
    gstWithholding: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        withholdings.push(data);
        return data;
      }),
    },
  } as unknown as Prisma.TransactionClient;

  const prisma = {
    client: {
      systemSetting: {
        findUnique: jest.fn(async () => ({
          valueDecimal: new Prisma.Decimal(opts.gstPercent ?? '18.00'),
        })),
      },
    },
  } as unknown as PrismaService;

  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      key,
      valueType: 'DECIMAL',
      value: key.includes('instant_pay_fee') ? (opts.instantFeePercent ?? '2.50') : 'SETTLEMENT',
      source: 'SYSTEM_DEFAULT' as const,
    })),
  } as unknown as SettingsResolverService;

  const wallet = {
    applyEntry: jest.fn(async (_tx: unknown, input: Entry) => {
      entries.push({ direction: input.direction, amount: input.amount });
      return { id: `e${entries.length}`, runningBalanceAfter: new Prisma.Decimal(0) };
    }),
  } as unknown as WalletService;

  return { svc: new CodCreditService(prisma, settings, wallet), tx, entries, withholdings };
}

const amountOf = (entries: Entry[], direction: string): string =>
  entries.find((e) => e.direction === direction)?.amount.toFixed(2) ?? 'absent';

describe('CodCreditService — SETTLEMENT mode', () => {
  it('extracts GST from the tax-inclusive price, it does not add it on top', async () => {
    const { svc, tx, entries } = makeSut({});
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });

    // 1000 × 18 / 118 — NOT 1000 × 0.18, which would be 180.
    expect(r.gstWithheldInr).toBe('152.54');
    expect(r.netCreditedInr).toBe('847.46');
    expect(amountOf(entries, 'COD_COLLECTION')).toBe('1000.00');
    expect(amountOf(entries, 'ORDER_CHARGES')).toBe('152.54');
    // No fee: waiting for the courier to settle is the free option.
    expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe('absent');
  });

  it('records the withholding as a liability of its own, with the rate snapshotted', async () => {
    const { svc, tx, withholdings } = makeSut({});
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    // We file this, so between collecting and filing it is money owed to
    // the department. Netted silently into the credit it would read as
    // revenue and be spent before the return was due.
    expect(withholdings).toHaveLength(1);
    expect(withholdings[0]).toMatchObject({ orderId: ORDER, sellerId: SELLER });
    // Snapshotted: a later rate change must not restate last quarter.
    expect(String(withholdings[0]!['gstPercent'])).toBe('18');
    expect(String(withholdings[0]!['gstAmountInr'])).toBe('152.54');
  });

  it('credits the gross and shows the deductions separately, never a single net figure', async () => {
    const { svc, tx, entries } = makeSut({});
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    // The seller has to be able to tie the credit to their own order.
    // One netted number cannot be reconciled against anything.
    expect(entries).toHaveLength(2);
  });

  it('is a no-op when the order was already credited', async () => {
    const { svc, tx, entries } = makeSut({ alreadyCredited: true });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    expect(r.credited).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it('writes nothing for a zero COD amount', async () => {
    const { svc, tx, entries } = makeSut({});
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('0'),
      mode: 'SETTLEMENT',
    });
    expect(r.credited).toBe(false);
    expect(entries).toHaveLength(0);
  });
});

describe('CodCreditService — INSTANT_PAY mode', () => {
  it('charges the fee on the POST-GST amount', async () => {
    const { svc, tx, entries } = makeSut({});
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'INSTANT_PAY',
    });

    // 2.5% of 847.46, not of 1000. The seller is paying for early access
    // to THEIR money, and the tax was never theirs to be advanced.
    expect(r.gstWithheldInr).toBe('152.54');
    expect(r.instantFeeInr).toBe('21.19');
    expect(r.netCreditedInr).toBe('826.27');
    expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe('21.19');
  });

  it('the fee is a debit of its own, so the revenue is countable', async () => {
    const { svc, tx, entries } = makeSut({});
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'INSTANT_PAY',
    });
    // COD credit + GST + fee. Folding the fee into ORDER_CHARGES would
    // make "what did Instant Pay earn us" unanswerable from the ledger.
    expect(entries.map((e) => e.direction).sort()).toEqual([
      'COD_COLLECTION',
      'INSTANT_PAY_FEE',
      'ORDER_CHARGES',
    ]);
  });

  it('a seller-negotiated fee rate is honoured', async () => {
    const { svc, tx } = makeSut({ instantFeePercent: '1.00' });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'INSTANT_PAY',
    });
    expect(r.instantFeeInr).toBe('8.47');
  });

  it('a zero GST rate withholds nothing and writes no liability', async () => {
    // Not the configuration today, but the rate is a setting and this is
    // what turning it off has to mean.
    const { svc, tx, entries, withholdings } = makeSut({ gstPercent: '0' });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    expect(r.gstWithheldInr).toBe('0.00');
    expect(withholdings).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });
});
