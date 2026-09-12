import { Prisma } from '@skydrop/db';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

/** WAL-7's advisory lock, as the fake sees it. */
const lockTaken = jest.fn(async () => 1);
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

/**
 * The COD withdrawal arithmetic.
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
 * would see a number they cannot tie to their own order, and the tax
 * (our revenue since 2026-09-07, WAL-4) and the two fees could no longer
 * be told apart from each other or from any other charge.
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
  collectionFeePercent?: string;
  alreadyCredited?: boolean;
  /** The earlier credit was reversed by the courier — the order may be credited again. */
  reversed?: boolean;
}) {
  const entries: Entry[] = [];
  const withholdings: Array<Record<string, unknown>> = [];

  const tx = {
    // The wallet advisory lock (WAL-7). Recorded rather than stubbed
    // away: a guard that reads the ledger before writing must serialise
    // against a concurrent one, and a fake with no $executeRaw would let
    // an unlocked version pass this suite.
    $executeRaw: lockTaken,
    // Credited iff more credits than reversals: a reversed COD may be
    // credited again when the courier pays it on a later payout.
    sellerWalletEntry: {
      count: jest.fn(async ({ where }: { where: { direction: string } }) =>
        where.direction === 'COD_COLLECTION'
          ? opts.alreadyCredited || opts.reversed
            ? 1
            : 0
          : opts.reversed
            ? 1
            : 0,
      ),
    },
    gstWithholding: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        withholdings.push(create);
        return create;
      }),
    },
  } as unknown as Prisma.TransactionClient;

  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      key,
      valueType: 'DECIMAL',
      value: key.includes('instant_pay_fee')
        ? (opts.instantFeePercent ?? '2.50')
        : key.includes('cod_collection_fee')
          ? (opts.collectionFeePercent ?? '0.00')
          : // GST now resolves through the SAME per-seller path as the
            // fees, rather than a global systemSetting lookup.
            key.includes('cod_gst_percent')
            ? (opts.gstPercent ?? '18.00')
            : 'SETTLEMENT',
      source: 'SYSTEM_DEFAULT' as const,
    })),
  } as unknown as SettingsResolverService;

  const wallet = {
    applyEntry: jest.fn(async (_tx: unknown, input: Entry) => {
      entries.push({ direction: input.direction, amount: input.amount });
      return { id: `e${entries.length}`, runningBalanceAfter: new Prisma.Decimal(0) };
    }),
  } as unknown as WalletService;

  return { svc: new CodCreditService(settings, wallet), tx, entries, withholdings };
}

const amountOf = (entries: Entry[], direction: string): string =>
  entries.find((e) => e.direction === direction)?.amount.toFixed(2) ?? 'absent';

describe('CodCreditService — the GST rate is per seller', () => {
  it("withholds at the seller's own slab, not a platform-wide 18%", async () => {
    // GST is slabbed by what is being sold — apparel 5% or 12%,
    // electronics 18% — so one rate across every seller is wrong for
    // most of them. A seller trading in the 5% slab on ₹1,000 owes
    // 1000 × 5 / 105 = ₹47.62, not ₹152.54.
    const { svc, tx } = makeSut({ gstPercent: '5.00' });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    expect(r.gstWithheldInr).toBe('47.62');
  });

  it('still EXTRACTS at the overridden rate rather than adding it on top', async () => {
    // The divisor is (100 + rate) whatever the rate is. Getting this
    // wrong at 12% over-withholds on every order by the same shape as
    // at 18%, just less visibly.
    const { svc, tx } = makeSut({ gstPercent: '12.00' });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    expect(r.gstWithheldInr).toBe('107.14');
  });
});

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
    // Its OWN direction, not ORDER_CHARGES: "what did we deduct as tax"
    // and "what did sellers pay us in charges" are different questions,
    // and a note cannot be grouped by (WAL-4).
    expect(amountOf(entries, 'GST_WITHHOLDING')).toBe('152.54');
    expect(amountOf(entries, 'ORDER_CHARGES')).toBe('absent');
    // No instant fee: waiting for the courier to settle is what you do
    // instead of paying for it. And the collection fee is seeded at 0,
    // so today nothing is charged for handling the cash either.
    expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe('absent');
    expect(amountOf(entries, 'COD_COLLECTION_FEE')).toBe('absent');
  });

  it('records the deduction on its own row, with the rate snapshotted', async () => {
    const { svc, tx, withholdings } = makeSut({});
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    // "What was deducted from THIS order" is what a seller asks when
    // they query a credit.
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

  it('credits again after the courier reversed the earlier credit', async () => {
    // The courier reversed the COD by mistake and paid it on a later
    // payout. Gating on "any credit exists" would leave the seller unpaid
    // for good while their cash sat in capital.
    const { svc, tx, entries } = makeSut({ reversed: true });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    expect(r.credited).toBe(true);
    expect(amountOf(entries, 'COD_COLLECTION')).toBe('1000.00');
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
    // COD credit + GST + fee, each on its own direction. Folding the
    // fee into ORDER_CHARGES would make "what did Instant Pay earn us"
    // unanswerable from the ledger; folding the GST in there — which is
    // what happened until the direction existed — made "what did
    // sellers pay us" overstate revenue by the tax.
    expect(entries.map((e) => e.direction).sort()).toEqual([
      'COD_COLLECTION',
      'GST_WITHHOLDING',
      'INSTANT_PAY_FEE',
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

  it('a collection fee applies on SETTLEMENT too, once it is non-zero', async () => {
    // Seeded at 0, so this is dormant today. The shape matters now
    // rather than later: getting it right while nothing is charged is
    // cheaper than getting it right while money is moving through it.
    const { svc, tx, entries } = makeSut({ collectionFeePercent: '1.00' });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'SETTLEMENT',
    });
    // 1% of the post-GST 847.46.
    expect(r.collectionFeeInr).toBe('8.47');
    expect(r.netCreditedInr).toBe('838.99');
    expect(amountOf(entries, 'COD_COLLECTION_FEE')).toBe('8.47');
  });

  it('a zero GST rate deducts nothing and writes no withholding row', async () => {
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

/**
 * The owner's decision (2026-09-12): the COD fee and the Instant Pay fee
 * are INDEPENDENT charges. The COD fee applies to every COD credit; the
 * Instant Pay fee only to an Instant Pay credit, ON TOP of the COD fee.
 * Both on the post-GST amount, each its own entry, a 0% rate writing none.
 *
 * ₹1,180 at 18%: tax ₹180, post-GST ₹1,000 — so 1% is ₹10 and 2.5% ₹25.
 */
describe('CodCreditService — the COD fee and the Instant Pay fee are independent', () => {
  const cases: Array<{
    name: string;
    collection: string;
    instant: string;
    mode: 'SETTLEMENT' | 'INSTANT_PAY';
    codFee: string;
    instantFee: string;
    net: string;
  }> = [
    {
      name: 'both off',
      collection: '0',
      instant: '0',
      mode: 'SETTLEMENT',
      codFee: 'absent',
      instantFee: 'absent',
      net: '1000.00',
    },
    {
      name: 'both off',
      collection: '0',
      instant: '0',
      mode: 'INSTANT_PAY',
      codFee: 'absent',
      instantFee: 'absent',
      net: '1000.00',
    },
    {
      name: 'COD fee only',
      collection: '1.00',
      instant: '0',
      mode: 'SETTLEMENT',
      codFee: '10.00',
      instantFee: 'absent',
      net: '990.00',
    },
    {
      name: 'COD fee only',
      collection: '1.00',
      instant: '0',
      mode: 'INSTANT_PAY',
      codFee: '10.00',
      instantFee: 'absent',
      net: '990.00',
    },
    // A settled COD never pays the Instant Pay fee, whatever its rate.
    {
      name: 'Instant Pay only',
      collection: '0',
      instant: '2.50',
      mode: 'SETTLEMENT',
      codFee: 'absent',
      instantFee: 'absent',
      net: '1000.00',
    },
    {
      name: 'Instant Pay only',
      collection: '0',
      instant: '2.50',
      mode: 'INSTANT_PAY',
      codFee: 'absent',
      instantFee: '25.00',
      net: '975.00',
    },
    {
      name: 'both on',
      collection: '1.00',
      instant: '2.50',
      mode: 'SETTLEMENT',
      codFee: '10.00',
      instantFee: 'absent',
      net: '990.00',
    },
    // The worked example: BOTH fees, ₹965 credited — not ₹975 (all-in).
    {
      name: 'both on',
      collection: '1.00',
      instant: '2.50',
      mode: 'INSTANT_PAY',
      codFee: '10.00',
      instantFee: '25.00',
      net: '965.00',
    },
  ];

  it.each(cases)(
    '$name, $mode: COD fee $codFee, Instant Pay fee $instantFee, credited $net',
    async ({ collection, instant, mode, codFee, instantFee, net }) => {
      const { svc, tx, entries } = makeSut({
        collectionFeePercent: collection,
        instantFeePercent: instant,
      });
      const r = await svc.creditForOrder(tx, {
        orderId: ORDER,
        sellerId: SELLER,
        grossInr: new Prisma.Decimal('1180'),
        mode,
      });
      expect(r.gstWithheldInr).toBe('180.00');
      expect(amountOf(entries, 'COD_COLLECTION')).toBe('1180.00');
      expect(amountOf(entries, 'GST_WITHHOLDING')).toBe('180.00');
      expect(amountOf(entries, 'COD_COLLECTION_FEE')).toBe(codFee);
      expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe(instantFee);
      expect(r.collectionFeeInr).toBe(codFee === 'absent' ? '0.00' : codFee);
      expect(r.instantFeeInr).toBe(instantFee === 'absent' ? '0.00' : instantFee);
      expect(r.netCreditedInr).toBe(net);
      // What the wallet actually moved by agrees with what was reported.
      const moved = entries.reduce(
        (t, e) => (e.direction === 'COD_COLLECTION' ? t.add(e.amount) : t.sub(e.amount)),
        new Prisma.Decimal(0),
      );
      expect(moved.toFixed(2)).toBe(net);
    },
  );

  it('each fee is rounded to the paisa on its own, from the post-GST amount', async () => {
    // ₹1,000 at 18% leaves ₹847.46: 1% = 8.4746 → 8.47, 2.5% = 21.1865 →
    // 21.19. Neither is taken as a share of the other or of the gross.
    const { svc, tx, entries } = makeSut({
      collectionFeePercent: '1.00',
      instantFeePercent: '2.50',
    });
    const r = await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1000'),
      mode: 'INSTANT_PAY',
    });
    expect(amountOf(entries, 'COD_COLLECTION_FEE')).toBe('8.47');
    expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe('21.19');
    expect(r.netCreditedInr).toBe('817.80');
  });

  it('a COD fee above the Instant Pay rate is charged as set — no rate replaces the other', async () => {
    // The old all-in rule charged max(instant, COD) on an Instant Pay
    // order. They are separate charges now, so each is exactly its own.
    const { svc, tx, entries } = makeSut({
      collectionFeePercent: '3.00',
      instantFeePercent: '2.50',
    });
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1180'),
      mode: 'INSTANT_PAY',
    });
    expect(amountOf(entries, 'COD_COLLECTION_FEE')).toBe('30.00');
    expect(amountOf(entries, 'INSTANT_PAY_FEE')).toBe('25.00');
  });

  it('a settled COD does not even look up the Instant Pay rate', async () => {
    const { svc, tx } = makeSut({ collectionFeePercent: '1.00', instantFeePercent: '2.50' });
    await svc.creditForOrder(tx, {
      orderId: ORDER,
      sellerId: SELLER,
      grossInr: new Prisma.Decimal('1180'),
      mode: 'SETTLEMENT',
    });
    const settings = (svc as unknown as { settings: { resolve: jest.Mock } }).settings;
    const keys = settings.resolve.mock.calls.map((c: unknown[]) => c[1]);
    expect(keys).not.toContain('wallet.instant_pay_fee_percent');
  });
});
