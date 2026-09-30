import { ActorType, SellerStoreKind } from '@skydrop/db';

import { ownerForActor } from '../../src/modules/order-journey/services/journey-owner';

/**
 * A seller's own cancellation was labelled SKYDROP.
 *
 * The order page's Full history put one word beside every line, and for
 * everything on our side of the courier boundary that word was
 * "SKYDROP" — including the lines the seller wrote themselves. They
 * read "Cancelled · SKYDROP · <their own note>": us, apparently, giving
 * their reason for them.
 *
 * The field was `'SKYDROP' | 'COURIER'` and it was not wrong, it was
 * answering a different question — "our side, not the courier's" — from
 * the one a reader asks of that column, which is WHO DID THIS.
 */
describe('ownerForActor', () => {
  it('attributes a seller act to the seller, not to us', () => {
    // The reported bug, in one line.
    expect(ownerForActor(ActorType.SELLER, null)).toBe('SELLER');
  });

  it('attributes a reseller store act to the store, not to the seller', () => {
    // Three values would have fixed the reported case and reproduced it
    // one level down: production carries 9 seller-visible order events
    // written by a STORE, and all nine would read "Seller". ActorType's
    // own comment settles it — "the store did this" and "the seller did
    // this" are different facts.
    expect(ownerForActor(ActorType.STORE, SellerStoreKind.RESELLER)).toBe('STORE');
  });

  it('reads our automation as us, exactly like our staff', () => {
    // SYSTEM is more than half of every order's history. A seller does
    // not distinguish a Skydrop person from a Skydrop job, and both are
    // ours to answer for; a separate word would label 167 of 332 rows
    // with something nobody asked about and invite the reading that an
    // automatic step is less our responsibility.
    expect(ownerForActor(ActorType.SYSTEM, null)).toBe('SKYDROP');
    expect(ownerForActor(ActorType.STAFF, null)).toBe('SKYDROP');
  });

  it('reads an event with no actor as ours', () => {
    // Written by our own code with nobody recorded on it.
    expect(ownerForActor(null, null)).toBe('SKYDROP');
    expect(ownerForActor(null, SellerStoreKind.RESELLER)).toBe('SKYDROP');
  });

  it('never returns undefined, whatever it is handed', () => {
    // A narrower select or a caller that has not got the column hands
    // over `undefined`, which fell straight out of the switch the first
    // time this ran and made the owner an empty word on screen — a
    // silent failure, since nothing throws on a missing label.
    expect(ownerForActor(undefined, undefined)).toBe('SKYDROP');
    expect(ownerForActor(ActorType.API, undefined)).toBe('SELLER');
  });

  it('decides an API key from the ORDER, because the actor alone cannot', () => {
    // `ActorType.API` on an order event has exactly one writer today —
    // ResellerOrderService, for a STORE's key — so hard-coding 'STORE'
    // would be right today and silently wrong the day a seller's own
    // key writes one. The order knows which it is.
    expect(ownerForActor(ActorType.API, SellerStoreKind.RESELLER)).toBe('STORE');
    expect(ownerForActor(ActorType.API, SellerStoreKind.CHANNEL)).toBe('SELLER');
    expect(ownerForActor(ActorType.API, null)).toBe('SELLER');
  });

  it('routes every ActorType — a sixth one must not fall through', () => {
    // The `never` in the switch makes this fail to COMPILE rather than
    // fail here, which is the point; this asserts the runtime half so a
    // future refactor to a lookup map cannot quietly reintroduce a
    // default.
    for (const actor of Object.values(ActorType)) {
      expect(['SKYDROP', 'SELLER', 'STORE', 'COURIER']).toContain(
        ownerForActor(actor, SellerStoreKind.CHANNEL),
      );
    }
  });
});
