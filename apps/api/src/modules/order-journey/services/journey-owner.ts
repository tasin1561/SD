import { ActorType, SellerStoreKind } from '@skydrop/db';

/**
 * WHOSE act a line on the order's journey was.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────
 * Every `order_events` row was labelled `SKYDROP`, including the ones
 * the seller wrote themselves. A seller who cancelled their own order
 * read
 *
 *     Cancelled · SKYDROP · <their own cancellation note>
 *
 * — us, apparently, giving their reason. The two-valued field was not
 * wrong so much as useless here: it meant "our side, not the
 * courier's", which is true of a seller's cancellation and answers a
 * question nobody was asking. What a person wants from that column is
 * WHO DID THIS, and there were four answers and two words.
 *
 * ── WHY FOUR VALUES AND NOT THREE ────────────────────────────────────
 * Three (us / you / the courier) would fix the reported case and
 * reproduce it one level down: production already carries 9
 * seller-visible order events written by a RESELLER STORE, and every
 * one of them would be labelled "Seller" — an act attributed to the
 * wrong party, which is the defect itself. `ActorType`'s own comment
 * settles it: "the store did this" and "the seller did this" are
 * different facts.
 *
 * ── SYSTEM READS AS SKYDROP, DELIBERATELY ────────────────────────────
 * Our automation is US. A seller does not distinguish "a Skydrop
 * person decided" from "a Skydrop job decided", and both are ours to
 * explain when they ring about it. Giving SYSTEM its own word would
 * put a label on more than half of every order's history (167 of the
 * 332 seller-visible events on production) that answers a question
 * nobody asked, and would invite the reading that an automatic step is
 * somehow less our responsibility. STAFF reads as SKYDROP for the same
 * reason, and so does a null actor: an event with nobody recorded on
 * it was written by our own code.
 *
 * ── API IS THE ONE AMBIGUOUS ACTOR, AND THE ORDER SETTLES IT ─────────
 * `ActorType.API` on an order event has exactly one writer today —
 * `ResellerOrderService`, for a STORE's api key — so it always means
 * the store. Hard-coding that would be right today and silently wrong
 * the day a seller's own key writes one, so it is decided from the
 * ORDER instead: a reseller store's order means the store acted, and
 * anything else means the seller's own integration did. No new query;
 * the journey already loads `storeKind`.
 *
 * F2-exhaustive over `ActorType`: a sixth actor fails to COMPILE until
 * somebody decides whose side it is on. Pure — no Prisma, no DI.
 */
export type MilestoneOwner = 'SKYDROP' | 'SELLER' | 'STORE' | 'COURIER';

export function ownerForActor(
  // `undefined` as well as `null`: a narrower select, or a caller that
  // simply has not got the column, must not fall out of the switch and
  // return `undefined` as the owner — which is what happened the first
  // time this ran against a fixture, and would have printed an empty
  // word rather than failing anywhere visible.
  actorType: ActorType | null | undefined,
  storeKind: SellerStoreKind | null | undefined,
): MilestoneOwner {
  if (actorType === null || actorType === undefined) return 'SKYDROP';
  switch (actorType) {
    case ActorType.STAFF:
    case ActorType.SYSTEM:
      return 'SKYDROP';
    case ActorType.SELLER:
      return 'SELLER';
    case ActorType.STORE:
      return 'STORE';
    case ActorType.API:
      return storeKind === SellerStoreKind.RESELLER ? 'STORE' : 'SELLER';
  }
}
