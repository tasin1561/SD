import { ForbiddenException, Injectable } from '@nestjs/common';
import { ActorType, ResellerStoreActionMode } from '@skydrop/db';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateOrderDto } from '../../order/dto/update-order.dto';
import { OrderService } from '../../order/services/order.service';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import { StoreOrdersService, type StoreOrderView } from './store-orders.service';

/**
 * 2026-09-16 — a reseller STORE correcting where its own parcel is going.
 *
 * The commonest fixable failure is a wrong address, and the store is the
 * only party who can ring the customer to correct it. So this exists; it
 * does NOT weaken `RESELLER_ORDER_NOT_EDITABLE`, which still refuses the
 * SELLER exactly as before.
 *
 * ── IT REUSES THE SELLER'S EDIT, DELIBERATELY ────────────────────────
 * `OrderService.edit` with a store scope, rather than a parallel writer.
 * That inherits the DRAFT/PENDING-only gate, address revalidation, the
 * canonical state casing and the EDIT_DURING_CALL rule — an agent is
 * reading this order to the customer, and the address may still be fixed
 * mid-call while the contents may not. A second implementation would
 * drift from all of that, and the copy that drifted is the one nobody
 * would be testing.
 *
 * ── WHY ASK_SELLER IS A REFUSAL, NOT A QUEUE ─────────────────────────
 * A held request needs somewhere to live, and the delivery-action queue
 * cannot hold this one: its rows require a shipment, and an order this
 * early has none. Rather than invent a second request table late in a
 * build, ASK_SELLER refuses by name and says who does it instead. The
 * honest shape — the store asks, the seller approves an address change —
 * is a follow-up, and is recorded as one.
 */
@Injectable()
export class StoreOrderEditService {
  constructor(
    private readonly orders: OrderService,
    private readonly storeOrders: StoreOrdersService,
    private readonly policies: ResellerStoreActionPolicyService,
  ) {}

  async editRecipient(input: {
    storeId: string;
    storeUserId: string;
    sellerId: string;
    orderId: string;
    patch: UpdateOrderDto;
    ctx: ClientContext;
  }): Promise<StoreOrderView> {
    const policy = await this.policies.forStore(input.storeId);
    if (policy.addressFix !== ResellerStoreActionMode.DIRECT) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          policy.addressFix === ResellerStoreActionMode.OFF
            ? 'The seller has not enabled address corrections for this store. Ask them to make the change.'
            : 'The seller makes address corrections for this store. Ask them to make the change.',
      });
    }

    await this.orders.edit(
      // The order is the SELLER's; the store id on the scope is what
      // makes this THEIR order rather than any of that seller's.
      input.sellerId,
      input.orderId,
      input.patch,
      { type: ActorType.STORE, id: input.storeUserId },
      input.ctx,
      { storeId: input.storeId },
    );

    // Read it back through the store's own projection, so the portal gets
    // the same shape it renders everywhere else.
    return this.storeOrders.detail(input.storeId, input.orderId);
  }
}
