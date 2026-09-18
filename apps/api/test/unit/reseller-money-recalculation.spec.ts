import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentMode, Prisma } from '@skydrop/db';
import {
  figures,
  figuresMoved,
} from '../../src/modules/reseller-order-money/plan/reseller-money-plan';
import { ResellerOrderMoneyService } from '../../src/modules/reseller-order-money/services/reseller-order-money.service';

const D = (n: string | number): Prisma.Decimal => new Prisma.Decimal(n);

/**
 * RE-PRICING A CHANGED RESELLER ORDER (owner, 2026-09-18).
 *
 * The rules under test are the ones that cost money if they are wrong:
 * which TERMS a recalculation uses, what happens to money ALREADY
 * POSTED, and what is refused rather than guessed.
 */
describe('figuresMoved — did the edit actually move this party’s money', () => {
  const base = {
    grossInr: D(1180),
    transferInr: D(600),
    taxShareInr: D(90),
    codFeeShareInr: D(10),
    instantFeeShareInr: D(0),
    netInr: D(480),
  };

  it('is false when every figure is the same to the paisa', () => {
    expect(figuresMoved(base, { ...base, grossInr: D('1180.00') })).toBe(false);
  });

  it('is true when a BREAKDOWN moves even though the net does not', () => {
    // A change that moves the gross and the tax share by the same amount
    // leaves the net still. Comparing the net alone would leave a stale
    // breakdown on the row every report reads.
    const moved = { ...base, grossInr: D(1200), taxShareInr: D(110) };
    expect(moved.netInr.equals(base.netInr)).toBe(true);
    expect(figuresMoved(base, moved)).toBe(true);
  });

  it('figures() renders to the paisa, so a report and an email agree', () => {
    expect(figures(base).netInr).toBe('480.00');
  });
});

describe('ResellerOrderMoneyService.assertEditKeepsMoneyCorrectable', () => {
  function make(opts: { order: { paymentMode: PaymentMode } | null; plannedCredits: number }) {
    const client = {
      order: {
        findFirst: jest.fn(async () =>
          opts.order === null
            ? null
            : {
                id: 'o1',
                orderNumber: 'SD-1',
                sellerId: 's1',
                storeId: 'st1',
                status: 'CONFIRMED',
                paymentMode: opts.order.paymentMode,
                codAmountInr: D(1180),
                resellerDeliveryFeeStorePercent: D(0),
                resellerReturnFeeStorePercent: D(0),
                resellerCustomerReturnFeeStorePercent: D(0),
              },
        ),
      },
      resellerOrderCredit: { count: jest.fn(async () => opts.plannedCredits) },
    };
    const svc = new ResellerOrderMoneyService(
      { client } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, client };
  }

  it('a channel order is none of its business', async () => {
    const { svc } = make({ order: null, plannedCredits: 0 });
    await expect(
      svc.assertEditKeepsMoneyCorrectable('o1', { paymentMode: PaymentMode.PREPAID }),
    ).resolves.toBeUndefined();
  });

  it('an edit that does not touch the payment mode is never refused', async () => {
    const { svc, client } = make({ order: { paymentMode: PaymentMode.COD }, plannedCredits: 2 });
    await expect(
      svc.assertEditKeepsMoneyCorrectable('o1', { paymentMode: undefined }),
    ).resolves.toBeUndefined();
    expect(client.order.findFirst).not.toHaveBeenCalled();
  });

  it('COD → PREPAID is free BEFORE the credits are planned', async () => {
    const { svc } = make({ order: { paymentMode: PaymentMode.COD }, plannedCredits: 0 });
    await expect(
      svc.assertEditKeepsMoneyCorrectable('o1', { paymentMode: PaymentMode.PREPAID }),
    ).resolves.toBeUndefined();
  });

  it('COD → PREPAID is REFUSED BY NAME once they are, rather than guessed', async () => {
    // The two are not two amounts of the same thing: a COD order has a
    // STORE credit and a prepaid one does not, and a prepaid one takes a
    // debit up front. Turning one into the other after the plan exists
    // means inventing a credit with no anchor and guessing at a debit.
    const { svc } = make({ order: { paymentMode: PaymentMode.COD }, plannedCredits: 2 });
    await expect(
      svc.assertEditKeepsMoneyCorrectable('o1', { paymentMode: PaymentMode.PREPAID }),
    ).rejects.toMatchObject({ response: { code: 'RESELLER_PAYMENT_MODE_LOCKED' } });
  });
});

describe('the rates a recalculation uses', () => {
  /*
    A seller's COD rates are LIVE settings (SET-1). Re-resolving them on a
    recalculation would let a rate somebody changed last week move the
    money of an order placed before it — a change the edit did not ask
    for, and one that would be invisible in the before/after the store is
    shown. So they are STAMPED on the plan and read back from it.

    Pinned by reading the source and the migration rather than by driving
    the path: `ensurePlan` needs a real database to reach, and the failure
    this guards is a silent one — a renamed column makes `ratesFor` fall
    back to today's rates and nothing fails.
  */
  const service = readFileSync(
    join(
      __dirname,
      '../../src/modules/reseller-order-money/services/reseller-order-money.service.ts',
    ),
    'utf8',
  );
  const migration = readFileSync(
    join(
      __dirname,
      '../../../../packages/db/prisma/migrations/20260918000000_seller_and_store_edit_reseller_orders/migration.sql',
    ),
    'utf8',
  );

  it.each([
    ['gstPercentAtPlan', 'gst_percent_at_plan'],
    ['codFeePercentAtPlan', 'cod_fee_percent_at_plan'],
    ['instantPayFeePercentAtPlan', 'instant_pay_fee_percent_at_plan'],
  ])('%s is written by the plan and exists as %s', (field, column) => {
    expect(service).toContain(`${field}: rates.`);
    expect(service).toContain(`stamped.${field}`);
    expect(migration).toContain(`"${column}"`);
  });

  it('a recalculation reads the plan’s rates, and only falls back when there are none', () => {
    // The fallback is for rows planned before the stamp existed. If it
    // ever became the normal path, every recalculation would re-price the
    // order at today's settings.
    expect(service).toMatch(/fromPlan: true/);
    expect(service).toMatch(
      /return \{ rates: await this\.resolveRates\(tx, sellerId\), fromPlan: false \}/,
    );
  });

  it('a CREDITED row is REFUSED, never reversed and written again', () => {
    /*
      Money already paid is not re-worked-out here (owner decision 2,
      2026-09-18): the contents freeze at confirmation and a reseller
      credit runs at or after delivery, so an edit cannot reach one.
      Reversing and re-writing it would need a second `cod_collection` on
      the same order, which `seller_wallet_entries_once_per_order_uq`
      refuses — the guard against paying an order twice.

      Read from the source because what is being pinned is an ABSENCE: a
      future "fix" that re-adds the reversal would pass every behavioural
      test in this file and fail against Postgres.
    */
    expect(service).toContain("code: 'RESELLER_CREDIT_ALREADY_PAID'");
    expect(service).not.toContain('await this.reverseCreditedWithTake(tx, head, [row]');
    // And the refusal is announced: the audit is written OUTSIDE the
    // transaction, or it would be rolled back with it.
    expect(service).toContain("action: 'reseller_order.money_recalculation_refused'");
  });
});
