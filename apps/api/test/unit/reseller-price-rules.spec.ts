import {
  checkPrice,
  normaliseAmount,
  toPaise,
} from '../../src/modules/reseller-catalogue/services/reseller-price-rules';

describe('reseller price rules (RS-3)', () => {
  it('reads amounts as whole paise, exactly', () => {
    expect(toPaise('0')).toBe(0);
    expect(toPaise('199.9')).toBe(19990);
    expect(toPaise('199.99')).toBe(19999);
    expect(toPaise(' 12 ')).toBe(1200);
    expect(toPaise('-1')).toBeNull();
    expect(toPaise('1.999')).toBeNull();
    expect(toPaise('1e3')).toBeNull();
    expect(toPaise('')).toBeNull();
  });

  it('accepts a full, ordered row and a transfer-only row', () => {
    expect(
      checkPrice({
        transferPriceInr: '250',
        minRetailInr: '300',
        maxRetailInr: '500',
        suggestedRetailInr: '399.00',
      }),
    ).toBeNull();
    expect(checkPrice({ transferPriceInr: '0.01' })).toBeNull();
  });

  it('requires a transfer price above zero', () => {
    expect(checkPrice({ transferPriceInr: '0' })?.code).toBe('TRANSFER_PRICE_REQUIRED');
    expect(checkPrice({ transferPriceInr: null })?.code).toBe('TRANSFER_PRICE_REQUIRED');
    expect(checkPrice({ transferPriceInr: '  ' })?.code).toBe('TRANSFER_PRICE_REQUIRED');
  });

  it('refuses a negative or malformed figure anywhere', () => {
    expect(checkPrice({ transferPriceInr: '10', minRetailInr: '-1' })?.code).toBe('INVALID_AMOUNT');
    expect(checkPrice({ transferPriceInr: '10.123' })?.code).toBe('INVALID_AMOUNT');
  });

  it('refuses min above max', () => {
    expect(
      checkPrice({ transferPriceInr: '10', minRetailInr: '500', maxRetailInr: '400' })?.code,
    ).toBe('RETAIL_RANGE_INVERTED');
  });

  it('keeps the suggestion inside whichever bounds are set', () => {
    expect(
      checkPrice({ transferPriceInr: '10', minRetailInr: '300', suggestedRetailInr: '299.99' })
        ?.code,
    ).toBe('SUGGESTED_OUTSIDE_RANGE');
    expect(
      checkPrice({ transferPriceInr: '10', maxRetailInr: '300', suggestedRetailInr: '300.01' })
        ?.code,
    ).toBe('SUGGESTED_OUTSIDE_RANGE');
    // Equal to a bound is inside it.
    expect(
      checkPrice({
        transferPriceInr: '10',
        minRetailInr: '300',
        maxRetailInr: '300',
        suggestedRetailInr: '300',
      }),
    ).toBeNull();
  });

  it('does not require retail to exceed the transfer price (the seller’s call)', () => {
    expect(checkPrice({ transferPriceInr: '500', maxRetailInr: '100' })).toBeNull();
  });

  it('normalises blanks to null for storage', () => {
    expect(normaliseAmount('')).toBeNull();
    expect(normaliseAmount(undefined)).toBeNull();
    expect(normaliseAmount(' 12.5 ')).toBe('12.5');
  });
});
