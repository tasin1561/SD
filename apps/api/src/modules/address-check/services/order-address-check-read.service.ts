import { Injectable } from '@nestjs/common';
import { SellerStoreKind, type StoreOrderScope } from '@skydrop/db';
import { storeOrderOwnerFilter } from '../../../common/auth/store-order-scope';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AddressCheckService, type AddressCheckView } from './address-check.service';

/** ASSOC-1 — which of a store's people is asking. */
export interface StoreReader {
  readonly sellerId: string;
  readonly storeId: string;
  readonly storeUserId: string;
  readonly orderScope: StoreOrderScope;
}

/**
 * The stored address check as a CLIENT, a MEMBER STORE or an ASSOCIATE
 * may read it.
 *
 * ── WHY THIS EXISTS BESIDE `AddressCheckService.storedViewForOrder` ──
 * That method takes an order id and nothing else, which is right for
 * staff and wrong for a tenant: `address_checks.order_id` is unique, so
 * an unscoped read would hand any seller the verdict on any order in
 * the platform by guessing a uuid. The projection stays there — one
 * reader of the vendor's payload — and the OWNERSHIP question is
 * answered here, once, for both consoles.
 *
 * ── THE SCOPE IS A WHERE CLAUSE, NEVER A COMPARISON AFTERWARDS ───────
 * The order is looked up with the caller's seller (and store, and for
 * an associate the person who placed it) in the `where`, so somebody
 * reaching for an order that is not theirs finds nothing. Nothing is
 * fetched and then compared, which is the shape that forgets a branch.
 *
 * ── "NOT YOURS" AND "NO CHECK" ARE THE SAME ANSWER, DELIBERATELY ─────
 * Both return null and both become a 404 at the controller. Most
 * historical orders have no check at all, so that 404 is the ordinary
 * case and carries no information; making the refusal louder would turn
 * this route into a way of finding out which uuids are real orders.
 */
@Injectable()
export class OrderAddressCheckReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checks: AddressCheckService,
  ) {}

  /** A client console reading its own order. */
  async forSeller(orderId: string, sellerId: string): Promise<AddressCheckView | null> {
    return this.scoped(orderId, { sellerId });
  }

  /** A member store, or an associate narrowed to the orders they placed. */
  async forStore(orderId: string, reader: StoreReader): Promise<AddressCheckView | null> {
    return this.scoped(orderId, {
      sellerId: reader.sellerId,
      storeId: reader.storeId,
      storeKind: SellerStoreKind.RESELLER,
      ...storeOrderOwnerFilter({ scope: reader.orderScope, storeUserId: reader.storeUserId }),
    });
  }

  private async scoped(
    orderId: string,
    owner: {
      readonly sellerId: string;
      readonly storeId?: string;
      readonly storeKind?: SellerStoreKind;
      readonly placedByStoreUserId?: string;
    },
  ): Promise<AddressCheckView | null> {
    const own = await this.prisma.client.order.findFirst({
      // `deletedAt` for the same reason the store's own order reads
      // carry it: an order the console will not show is an order whose
      // verdict it must not answer for either.
      where: { id: orderId, deletedAt: null, ...owner },
      select: { id: true },
    });
    if (own === null) return null;
    return this.checks.storedViewForOrder(orderId);
  }
}
