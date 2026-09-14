import { SellerStoreKind } from '@skydrop/db';
import {
  CUSTOMER_BRAND_ORDER_SELECT,
  customerFacingBrand,
  isResellerOrder,
} from '../../src/common/brand/customer-facing-brand';

/**
 * RS-10 — the one rule every customer-facing surface reads.
 */
describe('customerFacingBrand (RS-10)', () => {
  const CHANNEL = {
    storeNameSnapshot: 'Main store',
    store: { kind: SellerStoreKind.CHANNEL, displayName: null, name: 'Main store', logoKey: null },
    seller: { companyName: 'Acme Exports Ltd' },
  };
  const RESELLER = {
    storeNameSnapshot: 'Kurta Corner',
    store: {
      kind: SellerStoreKind.RESELLER,
      displayName: 'Kurta Corner (new name)',
      name: 'kurta-corner',
      logoKey: 'stores/st-1/logo.png',
    },
    seller: { companyName: 'Acme Exports Ltd' },
  };

  it('a CHANNEL order presents as the seller company, exactly as before', () => {
    expect(customerFacingBrand(CHANNEL)).toEqual({ kind: 'SELLER', name: 'Acme Exports Ltd' });
    expect(isResellerOrder(CHANNEL)).toBe(false);
  });

  it('an order with no store loaded presents as the seller (never guesses reseller)', () => {
    expect(customerFacingBrand({ seller: { companyName: 'Acme' } })).toEqual({
      kind: 'SELLER',
      name: 'Acme',
    });
    expect(customerFacingBrand({})).toEqual({ kind: 'SELLER', name: null });
  });

  it('a RESELLER order presents as the store: the name AT ORDER TIME, the live logo key', () => {
    expect(customerFacingBrand(RESELLER)).toEqual({
      kind: 'RESELLER_STORE',
      name: 'Kurta Corner',
      logoKey: 'stores/st-1/logo.png',
    });
    expect(isResellerOrder(RESELLER)).toBe(true);
  });

  it('a RESELLER order falls back through the STORE names, never to the seller', () => {
    const blankSnapshot = { ...RESELLER, storeNameSnapshot: '  ' };
    expect(customerFacingBrand(blankSnapshot).name).toBe('Kurta Corner (new name)');
    const onlyName = {
      ...RESELLER,
      storeNameSnapshot: null,
      store: { ...RESELLER.store, displayName: null },
    };
    expect(customerFacingBrand(onlyName).name).toBe('kurta-corner');
    const nothing = {
      ...RESELLER,
      storeNameSnapshot: null,
      store: { ...RESELLER.store, displayName: null, name: '' },
    };
    const brand = customerFacingBrand(nothing);
    expect(brand.name).not.toBe('Acme Exports Ltd');
    expect(JSON.stringify(brand)).not.toContain('Acme');
  });

  it('a blank logo key is no logo', () => {
    const r = customerFacingBrand({ ...RESELLER, store: { ...RESELLER.store, logoKey: ' ' } });
    expect(r.kind === 'RESELLER_STORE' ? r.logoKey : 'x').toBeNull();
  });

  it('the shared select reads the snapshot, the store kind/names/logo and the seller company', () => {
    expect(CUSTOMER_BRAND_ORDER_SELECT).toEqual({
      storeNameSnapshot: true,
      store: { select: { kind: true, displayName: true, name: true, logoKey: true } },
      seller: { select: { companyName: true } },
    });
  });
});
