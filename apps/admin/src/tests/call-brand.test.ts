import { describe, expect, it } from 'vitest';
import { callBrandLine } from '../lib/call-brand';

const SELLER = {
  id: 's1',
  companyName: 'Acme Exports Ltd',
  contactPersonName: 'Rahim',
  phone: '+8801700000000',
};

describe('callBrandLine (RS-10) — whom the agent is calling for', () => {
  it('a channel order reads exactly as before: the seller company', () => {
    expect(
      callBrandLine(SELLER, {
        kind: 'SELLER',
        name: 'Acme Exports Ltd',
        storeContactPhone: null,
        storeContactEmail: null,
      }),
    ).toEqual({ orderedFrom: 'Acme Exports Ltd', isReseller: false });
  });

  it('no brand from the server (older API / read failed) falls back to the seller', () => {
    expect(callBrandLine(SELLER, null)).toEqual({
      orderedFrom: 'Acme Exports Ltd',
      isReseller: false,
    });
  });

  it('a reseller-store order names THE STORE, never the seller', () => {
    const r = callBrandLine(SELLER, {
      kind: 'RESELLER_STORE',
      name: 'Kurta Corner',
      storeContactPhone: '+919800000000',
      storeContactEmail: null,
    });
    expect(r).toEqual({ orderedFrom: 'Kurta Corner', isReseller: true });
    expect(r.orderedFrom).not.toContain('Acme');
  });
});
