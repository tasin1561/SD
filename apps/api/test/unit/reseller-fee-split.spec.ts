import { Prisma, WalletEntryDirection } from '@skydrop/db';
import {
  FeeSplitError,
  splitFee,
  splitFeeLines,
  toStorePercent,
  validatePercents,
} from '../../src/modules/reseller-store-terms/terms/fee-split';
import {
  RESELLER_FEE_TYPES,
  feeTypeForWalletDirection,
  storePercentField,
  walletDirectionForFee,
} from '../../src/modules/reseller-store-terms/terms/reseller-fee-types';

/**
 * RS-4 — THE fee-split arithmetic. The rule: the store's share is rounded
 * to the paisa HALF UP, the seller pays the REMAINDER, and the two always
 * add up to the fee exactly.
 */
describe('splitFee (RS-4)', () => {
  function split(amount: string, pct: string): [string, string] {
    const s = splitFee(amount, pct);
    return [s.storeInr.toFixed(2), s.sellerInr.toFixed(2)];
  }

  it('the owner’s worked example: 80% of ₹200 is ₹160.00 / ₹40.00', () => {
    expect(split('200', '80')).toEqual(['160.00', '40.00']);
  });

  it('0% and 100% are exact', () => {
    expect(split('200', '0')).toEqual(['0.00', '200.00']);
    expect(split('200', '100')).toEqual(['200.00', '0.00']);
    expect(split('0.01', '100')).toEqual(['0.01', '0.00']);
    expect(split('0.01', '0')).toEqual(['0.00', '0.01']);
  });

  it('a zero fee splits to zero and zero', () => {
    expect(split('0', '37.5')).toEqual(['0.00', '0.00']);
  });

  it('odd paisa: the half rounds UP onto the store, the seller takes the rest', () => {
    expect(split('0.01', '50')).toEqual(['0.01', '0.00']); // 0.005 → 0.01
    expect(split('0.03', '50')).toEqual(['0.02', '0.01']); // 0.015 → 0.02
    expect(split('0.05', '50')).toEqual(['0.03', '0.02']); // 0.025 → 0.03
    expect(split('1.11', '50')).toEqual(['0.56', '0.55']); // 0.555 → 0.56
  });

  it('a third is 33.33%, and the seller carries the rounding remainder', () => {
    expect(split('100', '33.33')).toEqual(['33.33', '66.67']);
    expect(split('200', '33.33')).toEqual(['66.66', '133.34']);
    expect(split('10', '33.33')).toEqual(['3.33', '6.67']);
    expect(split('0.10', '33.33')).toEqual(['0.03', '0.07']);
  });

  it('the two shares ALWAYS add up to the fee, and neither is ever negative', () => {
    // A sweep over awkward amounts and percents.
    const amounts = ['0', '0.01', '0.03', '0.99', '1', '7.77', '29.99', '152.54', '199.99', '1000'];
    const percents = ['0', '0.01', '1', '12.5', '33.33', '50', '66.67', '99.99', '100'];
    for (const a of amounts) {
      for (const p of percents) {
        const s = splitFee(a, p);
        expect(s.storeInr.add(s.sellerInr).equals(new Prisma.Decimal(a))).toBe(true);
        expect(s.storeInr.isNegative()).toBe(false);
        expect(s.sellerInr.isNegative()).toBe(false);
        expect(s.storeInr.decimalPlaces()).toBeLessThanOrEqual(2);
        expect(s.sellerInr.decimalPlaces()).toBeLessThanOrEqual(2);
      }
    }
  });

  it('accepts numbers and Decimals the same as strings', () => {
    expect(splitFee(200, 80).storeInr.toFixed(2)).toBe('160.00');
    expect(splitFee(new Prisma.Decimal('200'), new Prisma.Decimal('80')).storeInr.toFixed(2)).toBe(
      '160.00',
    );
    // 0.1 as a float would carry a binary tail; the split goes via its string.
    expect(splitFee(0.1, 50).storeInr.toFixed(2)).toBe('0.05');
  });

  it('refuses what is not a fee or not a share, by name', () => {
    const code = (fn: () => unknown): string => {
      try {
        fn();
      } catch (err) {
        return err instanceof FeeSplitError ? err.code : 'OTHER';
      }
      return 'NONE';
    };
    expect(code(() => splitFee('-1', '50'))).toBe('FEE_SPLIT_AMOUNT_NEGATIVE');
    expect(code(() => splitFee('1.005', '50'))).toBe('FEE_SPLIT_AMOUNT_NOT_PAISA');
    expect(code(() => splitFee('abc', '50'))).toBe('FEE_SPLIT_AMOUNT_INVALID');
    expect(code(() => splitFee(Number.NaN, '50'))).toBe('FEE_SPLIT_AMOUNT_INVALID');
    expect(code(() => splitFee('1', '100.01'))).toBe('FEE_SPLIT_PERCENT_OUT_OF_RANGE');
    expect(code(() => splitFee('1', '-0.01'))).toBe('FEE_SPLIT_PERCENT_OUT_OF_RANGE');
    expect(code(() => splitFee('1', '33.333'))).toBe('FEE_SPLIT_PERCENT_TOO_PRECISE');
    expect(code(() => toStorePercent('1e2'))).toBe('FEE_SPLIT_PERCENT_INVALID');
  });
});

describe('splitFeeLines (RS-4)', () => {
  const percents = {
    deliveryFeeStorePercent: '80',
    returnFeeStorePercent: '100',
    customerReturnFeeStorePercent: '0',
    codFeeStorePercent: '33.33',
    codTaxStorePercent: '50',
    instantPayFeeStorePercent: '0',
  };

  it('splits each line under its own fee type’s share and totals the per-line shares', () => {
    const r = splitFeeLines(
      [
        { feeType: 'DELIVERY_FEE', amountInr: '200' },
        { feeType: 'RETURN_FEE', amountInr: '30' },
        { feeType: 'COD_FEE', amountInr: '10' },
        { feeType: 'COD_TAX', amountInr: '152.55' },
      ],
      percents,
    );
    expect(r.lines.map((l) => [l.feeType, l.storeInr.toFixed(2), l.sellerInr.toFixed(2)])).toEqual([
      ['DELIVERY_FEE', '160.00', '40.00'],
      ['RETURN_FEE', '30.00', '0.00'],
      ['COD_FEE', '3.33', '6.67'],
      ['COD_TAX', '76.28', '76.27'],
    ]);
    expect(r.totalInr.toFixed(2)).toBe('392.55');
    expect(r.storeTotalInr.toFixed(2)).toBe('269.61');
    expect(r.sellerTotalInr.toFixed(2)).toBe('122.94');
    // Skydrop's total is unchanged by any split.
    expect(r.storeTotalInr.add(r.sellerTotalInr).equals(r.totalInr)).toBe(true);
  });

  it('an empty set of lines is zero all round', () => {
    const r = splitFeeLines([], percents);
    expect([r.totalInr, r.storeTotalInr, r.sellerTotalInr].map((d) => d.toFixed(2))).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
  });

  it('validatePercents checks every fee type', () => {
    expect(() => validatePercents({ ...percents, instantPayFeeStorePercent: '101' })).toThrow(
      FeeSplitError,
    );
    const ok = validatePercents(percents);
    expect(ok.codFeeStorePercent.toFixed(2)).toBe('33.33');
  });
});

describe('reseller fee types (RS-4, F2)', () => {
  it('six fee types, each with its own column and wallet direction', () => {
    expect(RESELLER_FEE_TYPES).toHaveLength(6);
    expect(new Set(RESELLER_FEE_TYPES.map(storePercentField)).size).toBe(6);
    expect(new Set(RESELLER_FEE_TYPES.map(walletDirectionForFee)).size).toBe(6);
  });

  it('maps to the directions the seller is charged under today', () => {
    expect(walletDirectionForFee('DELIVERY_FEE')).toBe(WalletEntryDirection.ORDER_CHARGES);
    expect(walletDirectionForFee('RETURN_FEE')).toBe(WalletEntryDirection.RTO_FEE);
    expect(walletDirectionForFee('CUSTOMER_RETURN_FEE')).toBe(
      WalletEntryDirection.CUSTOMER_RETURN_FEE,
    );
    expect(walletDirectionForFee('COD_FEE')).toBe(WalletEntryDirection.COD_COLLECTION_FEE);
    expect(walletDirectionForFee('COD_TAX')).toBe(WalletEntryDirection.GST_WITHHOLDING);
    expect(walletDirectionForFee('INSTANT_PAY_FEE')).toBe(WalletEntryDirection.INSTANT_PAY_FEE);
  });

  it('inbound freight is the seller’s alone — not a splittable fee', () => {
    expect(feeTypeForWalletDirection(WalletEntryDirection.INBOUND_FREIGHT)).toBeNull();
    expect(feeTypeForWalletDirection(WalletEntryDirection.RTO_FEE)).toBe('RETURN_FEE');
  });
});
