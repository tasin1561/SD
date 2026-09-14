import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The address offered by "use these delivery details".
 *
 * It comes from the SELLER-SCOPED order query, never the platform-wide
 * one. The lookup deliberately reports counts across every seller —
 * refusal risk belongs to the customer — while keeping the order DETAIL
 * private to its owner. An address taken from the platform query would
 * turn a phone box into an address-harvesting tool: type numbers, read
 * back where other sellers' customers live.
 *
 * Structural, because the defect is "read from the wrong one of two
 * adjacent queries", and both return orders that look identical to a
 * behavioural test with one seller in the fixture.
 */
describe('customer lookup — last known recipient', () => {
  const src = readFileSync(
    join(__dirname, '../../src/modules/order/services/customer-reputation.service.ts'),
    'utf8',
  );

  it('selects the recipient block only in the seller-scoped query', () => {
    // RS-5: the "own" query is scoped by `ownWhere` — the seller's OWN
    // (channel) orders, or one reseller store's — never all of a seller's.
    const OWN = 'where: { ...ownWhere, recipientPhoneE164: phoneE164';
    const sellerQuery = src.slice(src.indexOf(OWN));
    const platformQuery = src.slice(
      src.indexOf('where: { recipientPhoneE164: phoneE164, deletedAt: null }'),
      src.indexOf(OWN),
    );
    expect(src.indexOf(OWN)).toBeGreaterThan(-1);
    expect(sellerQuery).toMatch(/recipientAddressLine1: true/);
    // The platform-wide query must NOT carry it.
    expect(platformQuery).not.toMatch(/recipientAddressLine1/);
  });

  it('RS-5: a seller’s lookup never reaches a reseller store’s customer', () => {
    // The seller scope is their OWN (channel) orders; a store scope is that
    // store's reseller orders. A reseller store's customer is the store's.
    expect(src).toMatch(/\{ sellerId, storeKind: SellerStoreKind\.CHANNEL \}/);
    expect(src).toMatch(/storeId: scope\.storeId, storeKind: SellerStoreKind\.RESELLER/);
  });

  it('reads from ownOrders — the seller-scoped result', () => {
    expect(src).toMatch(/lastKnownRecipient:[\s\S]{0,80}ownOrders\[0\]/);
  });

  it('is null when this seller has never sent to the number', () => {
    // A customer who has ordered across Skydrop but never from this
    // seller has no address we may hand over.
    expect(src).toMatch(/ownOrders\[0\] === undefined\s*\?\s*null/);
  });
});
