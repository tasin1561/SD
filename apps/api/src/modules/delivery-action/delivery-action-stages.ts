import { OrderStatus } from '@skydrop/db';

/**
 * Statuses where asking us to do something about the delivery makes
 * sense — the ONE list, read by `DeliveryActionService` (which refuses
 * outside it) and by the reseller store's order view (which only offers
 * the delivery tasks inside it, cosmetically — FE-2).
 *
 * DELIVERY_FAILED is the ordinary case. OUT_FOR_DELIVERY is allowed too:
 * a seller who has just heard from their customer that nobody is home
 * should be able to say so before the driver knocks, rather than being
 * made to wait for the failure they can already see coming.
 *
 * Anything past the parcel moving is refused — a delivered order has
 * nothing to re-attempt, and an RTO already in flight cannot be asked
 * for twice.
 *
 * Dependency-free on purpose, so a reader in another module imports a
 * constant rather than the service's whole graph.
 */
export const DELIVERY_ACTION_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
]);
