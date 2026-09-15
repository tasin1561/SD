import { OrderStatus, PaymentMode, Prisma, ResellerCreditTrigger } from '@skydrop/db';
import {
  anchorOf,
  cashTakenOnReversal,
  codFees,
  creditMayRun,
  dueAt,
  planCredits,
  prepaidDebit,
  REARM_ON_PAYOUT_REASONS,
  RETURN_STATUSES,
  type CodRates,
  type PlanCreditsInput,
} from '../../src/modules/reseller-order-money/plan/reseller-money-plan';
import { VOIDABLE_TERMINAL_STATES } from '../../src/modules/order/order-carriage';
import { CodCreditService } from '../../src/modules/seller-wallet-accrual/services/cod-credit.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { StorePercents } from '../../src/modules/reseller-store-terms/terms/reseller-fee-types';

/**
 * RS-6 phase 3c — the ONE pure planner of a reseller order's money.
 *
 * What this file pins, because each is silent when wrong:
 *  1. The three COD fees are the CHANNEL's figures to the paisa — run
 *     against the real `CodCreditService`, not a restated formula.
 *  2. Every fee's two shares add up to the fee, and the store's net plus
 *     the seller's net is exactly what a channel order credits — so
 *     Skydrop's take per order is unchanged by any split.
 *  3. When a credit may be written (money follows the order's fate).
 */

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

const RATES: CodRates = {
  gstPercent: D('18.00'),
  codFeePercent: D('1.00'),
  instantPayFeePercent: D('2.50'),
};

const percents = (
  p: Partial<Record<keyof StorePercents<unknown>, string>>,
): StorePercents<Prisma.Decimal> => ({
  deliveryFeeStorePercent: D(p.deliveryFeeStorePercent ?? '0'),
  returnFeeStorePercent: D(p.returnFeeStorePercent ?? '0'),
  customerReturnFeeStorePercent: D(p.customerReturnFeeStorePercent ?? '0'),
  codFeeStorePercent: D(p.codFeeStorePercent ?? '0'),
  codTaxStorePercent: D(p.codTaxStorePercent ?? '0'),
  instantPayFeeStorePercent: D(p.instantPayFeeStorePercent ?? '0'),
});

const timing = (trigger: ResellerCreditTrigger, days = 0) => ({ trigger, days });

function input(over: Partial<PlanCreditsInput> = {}): PlanCreditsInput {
  return {
    paymentMode: PaymentMode.COD,
    codInr: D('1299.00'),
    transferTotalInr: D('800.00'),
    storePercents: percents({
      codTaxStorePercent: '50',
      codFeeStorePercent: '33.33',
      instantPayFeeStorePercent: '100',
    }),
    storeCredit: timing(ResellerCreditTrigger.INSTANT),
    sellerCredit: timing(ResellerCreditTrigger.ON_PAYOUT, 2),
    rates: RATES,
    ...over,
  };
}

/** The real channel credit, run over a minimal fake — the figures it writes. */
async function channelCredit(gross: string, rates: CodRates, mode: 'SETTLEMENT' | 'INSTANT_PAY') {
  const entries: Array<{ direction: string; amount: Prisma.Decimal }> = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    sellerWalletEntry: { count: jest.fn(async () => 0) },
    gstWithholding: { upsert: jest.fn(async () => ({})) },
  } as unknown as Prisma.TransactionClient;
  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      key,
      valueType: 'DECIMAL',
      value: key.includes('instant_pay_fee')
        ? rates.instantPayFeePercent.toFixed(2)
        : key.includes('cod_collection_fee')
          ? rates.codFeePercent.toFixed(2)
          : key.includes('cod_gst_percent')
            ? rates.gstPercent.toFixed(2)
            : 'SETTLEMENT',
      source: 'SYSTEM_DEFAULT' as const,
    })),
  } as unknown as SettingsResolverService;
  const wallet = {
    applyEntry: jest.fn(async (_tx: unknown, e: { direction: string; amount: Prisma.Decimal }) => {
      entries.push({ direction: e.direction, amount: e.amount });
      return { id: `e${entries.length}`, runningBalanceAfter: D(0) };
    }),
  } as unknown as WalletService;
  await new CodCreditService(settings, wallet).creditForOrder(tx, {
    orderId: '019fad84-7acd-754e-8ee4-43cf858fed83',
    sellerId: '019fad84-7acd-754e-8ee4-43cf858fed82',
    grossInr: D(gross),
    mode,
  });
  const of = (dir: string): string =>
    entries.find((e) => e.direction === dir)?.amount.toFixed(2) ?? '0.00';
  return {
    tax: of('GST_WITHHOLDING'),
    codFee: of('COD_COLLECTION_FEE'),
    instantFee: of('INSTANT_PAY_FEE'),
    credited: of('COD_COLLECTION'),
  };
}

describe('reseller money plan — the COD fees are the channel figures, to the paisa', () => {
  const cases: Array<[string, CodRates]> = [
    ['1299.00', RATES],
    ['1180.00', RATES],
    ['1.01', RATES],
    ['0.99', { gstPercent: D('5.00'), codFeePercent: D('3.33'), instantPayFeePercent: D('7.77') }],
    [
      '99999.99',
      { gstPercent: D('12.00'), codFeePercent: D('0.00'), instantPayFeePercent: D('2.50') },
    ],
    [
      '457.37',
      { gstPercent: D('28.00'), codFeePercent: D('60.00'), instantPayFeePercent: D('60.00') },
    ],
    [
      '333.33',
      { gstPercent: D('0.00'), codFeePercent: D('100.00'), instantPayFeePercent: D('2.50') },
    ],
  ];
  it.each(cases)(
    'COD ₹%s — settlement and Instant Pay both agree with CodCreditService',
    async (gross, rates) => {
      for (const mode of ['SETTLEMENT', 'INSTANT_PAY'] as const) {
        const channel = await channelCredit(gross, rates, mode);
        const plan = codFees(D(gross), rates, mode === 'INSTANT_PAY');
        expect({
          tax: plan.taxInr.toFixed(2),
          codFee: plan.codFeeInr.toFixed(2),
          instantFee: plan.instantFeeInr.toFixed(2),
        }).toEqual({ tax: channel.tax, codFee: channel.codFee, instantFee: channel.instantFee });
      }
    },
  );

  it('a zero or missing COD carries no fees', () => {
    expect(codFees(D(0), RATES, true).taxInr.toFixed(2)).toBe('0.00');
    const plan = planCredits(input({ codInr: null }));
    expect(plan.fees?.grossInr.toFixed(2)).toBe('0.00');
    expect(plan.store?.netInr.toFixed(2)).toBe('-800.00');
  });
});

describe('reseller money plan — the worked example (docs/reseller-stores.md)', () => {
  it('COD ₹1,299, transfer ₹800, store pays 50% tax / 33.33% COD fee / 100% Instant Pay, store INSTANT', () => {
    const plan = planCredits(input());
    // tax = 1299 × 18 / 118 = 198.1525… → 198.15; post-GST 1,100.85
    // COD fee 1% = 11.0085 → 11.01; Instant Pay 2.5% = 27.52125 → 27.52
    expect(plan.fees?.taxInr.toFixed(2)).toBe('198.15');
    expect(plan.fees?.codFeeInr.toFixed(2)).toBe('11.01');
    expect(plan.fees?.instantFeeInr.toFixed(2)).toBe('27.52');
    expect(plan.instantApplies).toBe(true);
    // tax 198.15 × 50% = 99.075 → store 99.08 (half up), seller 99.07
    // COD fee 11.01 × 33.33% = 3.669… → store 3.67, seller 7.34
    // Instant Pay 100% → store 27.52, seller 0.00
    expect(plan.store).toMatchObject({
      party: 'STORE',
      trigger: ResellerCreditTrigger.INSTANT,
      days: 0,
    });
    expect(plan.store?.grossInr.toFixed(2)).toBe('1299.00');
    expect(plan.store?.transferInr.toFixed(2)).toBe('800.00');
    expect(plan.store?.taxShareInr.toFixed(2)).toBe('99.08');
    expect(plan.store?.codFeeShareInr.toFixed(2)).toBe('3.67');
    expect(plan.store?.instantFeeShareInr.toFixed(2)).toBe('27.52');
    expect(plan.store?.netInr.toFixed(2)).toBe('368.73');
    expect(plan.seller).toMatchObject({
      party: 'SELLER',
      trigger: ResellerCreditTrigger.ON_PAYOUT,
      days: 2,
    });
    expect(plan.seller.grossInr.toFixed(2)).toBe('800.00');
    expect(plan.seller.transferInr.toFixed(2)).toBe('0.00');
    expect(plan.seller.taxShareInr.toFixed(2)).toBe('99.07');
    expect(plan.seller.codFeeShareInr.toFixed(2)).toBe('7.34');
    expect(plan.seller.instantFeeShareInr.toFixed(2)).toBe('0.00');
    expect(plan.seller.netInr.toFixed(2)).toBe('693.59');
    // 368.73 + 693.59 = 1,062.32 = 1299 − 198.15 − 11.01 − 27.52: the channel credit.
    expect(plan.store?.netInr.add(plan.seller.netInr).toFixed(2)).toBe('1062.32');
  });

  it('the channel credit on the same COD is the same total', async () => {
    const channel = await channelCredit('1299.00', RATES, 'INSTANT_PAY');
    expect(channel.credited).toBe('1299.00');
    const channelNet = D('1299.00').sub(channel.tax).sub(channel.codFee).sub(channel.instantFee);
    const plan = planCredits(input());
    expect(plan.store?.netInr.add(plan.seller.netInr).toFixed(2)).toBe(channelNet.toFixed(2));
  });
});

describe('reseller money plan — shares always add up (Skydrop take unchanged)', () => {
  const cods = ['0.01', '1.00', '1.01', '99.99', '457.37', '1000.00', '1299.00', '12345.67'];
  const pcts = ['0', '0.01', '12.5', '33.33', '50', '66.67', '99.99', '100'];
  it('for every COD × percent, each fee splits exactly and the nets sum to the channel credit', () => {
    for (const cod of cods) {
      for (const p of pcts) {
        for (const storeTrigger of [
          ResellerCreditTrigger.INSTANT,
          ResellerCreditTrigger.ON_PAYOUT,
        ]) {
          const plan = planCredits(
            input({
              codInr: D(cod),
              transferTotalInr: D('250.55'),
              storePercents: percents({
                codTaxStorePercent: p,
                codFeeStorePercent: p,
                instantPayFeeStorePercent: p,
              }),
              storeCredit: timing(storeTrigger, 1),
              sellerCredit: timing(ResellerCreditTrigger.AFTER_DELIVERY, 3),
            }),
          );
          const f = plan.fees;
          const store = plan.store;
          if (f === null || store === null)
            throw new Error('COD plan must carry fees and a store row');
          expect(store.taxShareInr.add(plan.seller.taxShareInr).toFixed(2)).toBe(
            f.taxInr.toFixed(2),
          );
          expect(store.codFeeShareInr.add(plan.seller.codFeeShareInr).toFixed(2)).toBe(
            f.codFeeInr.toFixed(2),
          );
          expect(store.instantFeeShareInr.add(plan.seller.instantFeeShareInr).toFixed(2)).toBe(
            f.instantFeeInr.toFixed(2),
          );
          expect(store.netInr.add(plan.seller.netInr).toFixed(2)).toBe(
            D(cod).sub(f.taxInr).sub(f.codFeeInr).sub(f.instantFeeInr).toFixed(2),
          );
          for (const s of [store, plan.seller]) {
            expect(s.taxShareInr.isNegative()).toBe(false);
            expect(s.codFeeShareInr.isNegative()).toBe(false);
            expect(s.instantFeeShareInr.isNegative()).toBe(false);
            expect(s.netInr.decimalPlaces()).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it('0% leaves every fee with the seller; 100% puts every fee on the store', () => {
    const zero = planCredits(input({ storePercents: percents({}) }));
    expect(zero.store?.taxShareInr.toFixed(2)).toBe('0.00');
    expect(zero.store?.codFeeShareInr.toFixed(2)).toBe('0.00');
    expect(zero.store?.instantFeeShareInr.toFixed(2)).toBe('0.00');
    expect(zero.seller.taxShareInr.toFixed(2)).toBe('198.15');
    const all = planCredits(
      input({
        storePercents: percents({
          codTaxStorePercent: '100',
          codFeeStorePercent: '100',
          instantPayFeeStorePercent: '100',
        }),
      }),
    );
    expect(all.seller.netInr.toFixed(2)).toBe('800.00');
    expect(all.store?.netInr.toFixed(2)).toBe(
      D('1299').sub('800').sub('198.15').sub('11.01').sub('27.52').toFixed(2),
    );
  });

  it('a store selling below the transfer price nets NEGATIVE — the plan does not hide it', () => {
    const plan = planCredits(input({ codInr: D('500.00'), transferTotalInr: D('800.00') }));
    expect(plan.store?.netInr.isNegative()).toBe(true);
    expect(plan.seller.netInr.greaterThan(0)).toBe(true);
  });
});

describe('reseller money plan — the Instant Pay fee applies when EITHER party is INSTANT', () => {
  it.each([
    [ResellerCreditTrigger.INSTANT, ResellerCreditTrigger.ON_PAYOUT, true],
    [ResellerCreditTrigger.ON_PAYOUT, ResellerCreditTrigger.INSTANT, true],
    [ResellerCreditTrigger.INSTANT, ResellerCreditTrigger.INSTANT, true],
    [ResellerCreditTrigger.ON_PAYOUT, ResellerCreditTrigger.AFTER_DELIVERY, false],
    [ResellerCreditTrigger.AFTER_CONFIRMATION, ResellerCreditTrigger.ON_PAYOUT, false],
    [ResellerCreditTrigger.AFTER_DELIVERY, ResellerCreditTrigger.AFTER_CONFIRMATION, false],
  ])('store %s, seller %s → applies=%s', (s, se, applies) => {
    const plan = planCredits(input({ storeCredit: timing(s, 1), sellerCredit: timing(se, 1) }));
    expect(plan.instantApplies).toBe(applies);
    expect(plan.fees?.instantFeeInr.toFixed(2)).toBe(applies ? '27.52' : '0.00');
  });
});

describe('reseller money plan — prepaid', () => {
  it('has no store credit and no COD fees; the seller is credited the transfer price', () => {
    const plan = planCredits(input({ paymentMode: PaymentMode.PREPAID, codInr: null }));
    expect(plan.fees).toBeNull();
    expect(plan.store).toBeNull();
    expect(plan.instantApplies).toBe(false);
    expect(plan.seller.grossInr.toFixed(2)).toBe('800.00');
    expect(plan.seller.netInr.toFixed(2)).toBe('800.00');
    expect(plan.seller.trigger).toBe(ResellerCreditTrigger.ON_PAYOUT);
  });

  it('the store pays the transfer price plus its delivery share, split exactly', () => {
    // ₹236 delivery fee (200 + 18% GST), store pays 33.33% → 78.6588 → 78.66
    const d = prepaidDebit(D('800.00'), D('236.00'), D('33.33'));
    expect(d.transferInr.toFixed(2)).toBe('800.00');
    expect(d.deliveryShareInr.toFixed(2)).toBe('78.66');
    expect(d.totalInr.toFixed(2)).toBe('878.66');
    expect(prepaidDebit(D('800.00'), D('236.00'), D('0')).totalInr.toFixed(2)).toBe('800.00');
    expect(prepaidDebit(D('800.00'), D('236.00'), D('100')).totalInr.toFixed(2)).toBe('1036.00');
  });
});

describe('reseller money plan — when a trigger counts from', () => {
  it.each([
    [ResellerCreditTrigger.AFTER_CONFIRMATION, PaymentMode.COD, 'CONFIRMATION'],
    [ResellerCreditTrigger.AFTER_CONFIRMATION, PaymentMode.PREPAID, 'CONFIRMATION'],
    [ResellerCreditTrigger.INSTANT, PaymentMode.COD, 'DELIVERY'],
    [ResellerCreditTrigger.AFTER_DELIVERY, PaymentMode.COD, 'DELIVERY'],
    [ResellerCreditTrigger.ON_PAYOUT, PaymentMode.COD, 'PAYOUT'],
    [ResellerCreditTrigger.ON_PAYOUT, PaymentMode.PREPAID, 'DELIVERY'],
  ])('%s on %s counts from %s', (trigger, mode, anchor) => {
    expect(anchorOf(trigger, mode)).toBe(anchor);
  });

  it('dueAt adds whole days', () => {
    const at = new Date('2026-09-15T10:00:00.000Z');
    expect(dueAt(at, 0).toISOString()).toBe('2026-09-15T10:00:00.000Z');
    expect(dueAt(at, 7).toISOString()).toBe('2026-09-22T10:00:00.000Z');
  });

  it('only timing reasons re-arm on a later payout — never a fate', () => {
    expect([...REARM_ON_PAYOUT_REASONS].sort()).toEqual([
      'COURIER_HAS_NOT_PAID',
      'COURIER_REVERSED',
      'NOT_DELIVERED',
    ]);
    expect(REARM_ON_PAYOUT_REASONS.has('RETURNED_UNDELIVERED')).toBe(false);
    expect(REARM_ON_PAYOUT_REASONS.has('ORDER_LOST_IN_TRANSIT')).toBe(false);
  });
});

describe('reseller money plan — a due credit is written only while the order still earns it', () => {
  const run = (
    anchor: 'CONFIRMATION' | 'DELIVERY' | 'PAYOUT',
    status: OrderStatus,
    everDelivered: boolean,
    paid: string,
  ) => creditMayRun({ anchor, status, everDelivered, courierPaidInr: D(paid) });

  it('a called-off order never earns a credit, whatever the anchor', () => {
    expect(VOIDABLE_TERMINAL_STATES.size).toBeGreaterThan(0);
    for (const s of VOIDABLE_TERMINAL_STATES) {
      for (const a of ['CONFIRMATION', 'DELIVERY', 'PAYOUT'] as const) {
        expect(run(a, s, true, '100')).toEqual({ run: false, reason: `ORDER_${s}` });
      }
    }
  });

  it('a lost parcel never earns a credit', () => {
    expect(run('DELIVERY', OrderStatus.LOST_IN_TRANSIT, false, '0')).toEqual({
      run: false,
      reason: 'ORDER_LOST_IN_TRANSIT',
    });
  });

  it('a parcel back without ever being delivered earns nothing; a customer return after delivery still does', () => {
    for (const s of RETURN_STATUSES) {
      expect(run('CONFIRMATION', s, false, '0')).toEqual({
        run: false,
        reason: 'RETURNED_UNDELIVERED',
      });
      expect(run('DELIVERY', s, true, '0')).toEqual({ run: true });
    }
  });

  it('CONFIRMATION runs on a live order; DELIVERY needs delivery or a payout; PAYOUT needs a positive payout', () => {
    expect(run('CONFIRMATION', OrderStatus.CONFIRMED, false, '0')).toEqual({ run: true });
    expect(run('DELIVERY', OrderStatus.IN_TRANSIT, false, '0')).toEqual({
      run: false,
      reason: 'NOT_DELIVERED',
    });
    expect(run('DELIVERY', OrderStatus.IN_TRANSIT, false, '10')).toEqual({ run: true });
    expect(run('DELIVERY', OrderStatus.DELIVERED, true, '0')).toEqual({ run: true });
    expect(run('PAYOUT', OrderStatus.DELIVERED, true, '0')).toEqual({
      run: false,
      reason: 'COURIER_HAS_NOT_PAID',
    });
    expect(run('PAYOUT', OrderStatus.DELIVERED, true, '1299')).toEqual({ run: true });
  });
});

describe('reseller money plan — the cash a reversal takes back', () => {
  it.each([
    ['1000', '300', '300.00'],
    ['200', '300', '200.00'],
    ['0', '300', '0.00'],
    ['-50', '300', '0.00'],
    ['300', '300', '300.00'],
  ])('group %s, reversed gross %s → %s', (before, gross, taken) => {
    expect(cashTakenOnReversal(D(before), D(gross)).toFixed(2)).toBe(taken);
  });
});
