import { Injectable } from '@nestjs/common';
import { DeliveryActionStatus, StoreAddressChangeStatus } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * How many things a seller's reseller stores are waiting on them for
 * (2026-09-16).
 *
 * TWO queues stop at the same person, and they live in different
 * modules: a delivery ask (`order_delivery_action_requests`, owned by
 * `delivery-action`) and an address correction
 * (`store_address_change_requests`, owned by `reseller-order`). The nav
 * badge counted only the first, so a store asking for a wrong address to
 * be fixed sat PENDING with nothing anywhere saying so — and a customer's
 * parcel kept moving to the wrong place while it did.
 *
 * ── WHY THE COUNT LIVES HERE ─────────────────────────────────────────
 * Neither owning module can hold it. `delivery-action`'s own header
 * states it is a LEAF that nothing imports; `reseller-order`'s states it
 * deliberately does not import `delivery-action` precisely to keep that
 * property. So either of them counting the other's rows would cost one
 * of those two stated facts. `reseller-store` is already the shared
 * primitive BOTH of them import (for the action policy that decides
 * which asks stop here at all) and it imports neither — the R3 position,
 * already established rather than invented for this.
 *
 * Reading the two tables directly is therefore the only acyclic option,
 * and it is a narrow one on purpose: a COUNT, read-only, scoped by the
 * seller id the caller took from its token. Nothing decides anything
 * from this number — it is what a person sees on a nav item before they
 * click it. Authority over either queue stays with the module that owns
 * it.
 *
 * ── THE COUNT MUST MATCH WHAT THE SCREEN LISTS ───────────────────────
 * A badge pointing at a screen that does not list what it counted is
 * worse than no badge: staff click it, find nothing, and learn to ignore
 * the number. The two predicates below are the SAME ones the two
 * `listPending` methods use, and `store-requests-count.spec.ts` pins
 * that by running both services against one mock and comparing the
 * `where` each sends — so a filter added to either list fails the suite
 * instead of silently drifting the badge.
 */

/** Delivery asks stopped for this seller — the `listPending` predicate. */
export function pendingActionsWhere(sellerId: string): Prisma.OrderDeliveryActionRequestWhereInput {
  return {
    sellerId,
    resellerStoreId: { not: null },
    needsSellerApproval: true,
    status: DeliveryActionStatus.PENDING,
  };
}

/** Address corrections stopped for this seller — the same predicate. */
export function pendingAddressChangesWhere(
  sellerId: string,
): Prisma.StoreAddressChangeRequestWhereInput {
  return { sellerId, status: StoreAddressChangeStatus.PENDING };
}

export interface StoreRequestCount {
  /** What the badge shows. The two below, added. */
  readonly total: number;
  readonly actions: number;
  readonly addressChanges: number;
}

@Injectable()
export class SellerStoreRequestCountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Both queues in ONE answer.
   *
   * One number from the server rather than two lists summed in the
   * browser: the shell renders on every page, so summing lists would
   * fetch up to 400 rows with their includes on every page view to read
   * two lengths — and two round trips that disagree is exactly how a
   * badge comes to show a number the screen does not.
   */
  async forSeller(sellerId: string): Promise<StoreRequestCount> {
    const [actions, addressChanges] = await Promise.all([
      this.prisma.client.orderDeliveryActionRequest.count({
        where: pendingActionsWhere(sellerId),
      }),
      this.prisma.client.storeAddressChangeRequest.count({
        where: pendingAddressChangesWhere(sellerId),
      }),
    ]);
    return { total: actions + addressChanges, actions, addressChanges };
  }
}
