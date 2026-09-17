import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ActorType, ResellerStoreActionMode } from '@skydrop/db';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateOrderDto } from '../../order/dto/update-order.dto';
import type { StoreEditRecipientDto } from '../dto/address-change.dto';
import { OrderService } from '../../order/services/order.service';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import { StoreOrdersService, type StoreOrderView } from './store-orders.service';
import {
  StoreAddressChangeService,
  fieldsFromPatch,
  type AddressChangeRequestView,
} from './store-address-change.service';

/**
 * 2026-09-16 — a reseller STORE correcting where its own parcel is going.
 *
 * The commonest fixable failure is a wrong address, and the store is the
 * only party who can ring the customer to correct it. So this exists.
 * Since 2026-09-17 seller staff may correct the same recipient fields on
 * the store's order too (owner decision b) — as the SELLER's act, with the
 * store emailed — and anything else on it stays `RESELLER_ORDER_NOT_EDITABLE`.
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
 * ── ASK_SELLER IS NOW A QUEUE, NOT A REFUSAL (2026-09-16, owner) ─────
 * It used to refuse by name, because a held correction needed somewhere
 * to live and the delivery-action queue could not hold it — its rows
 * require a shipment, and an order this early has none. This file
 * recorded that as a follow-up; `store_address_change_requests` is it.
 * All three modes now mean what the seller chose:
 *
 *   OFF         — refused, and told who does it instead.
 *   DIRECT      — written onto the order here and now.
 *   ASK_SELLER  — held, and the order keeps the OLD address until
 *                 seller staff answer.
 */

/**
 * What came of a correction. A UNION rather than a nullable order,
 * because "applied" and "waiting" are different things for the portal to
 * say, and a caller that has to infer which from a null field will
 * eventually infer it wrong.
 */
export type StoreRecipientEditOutcome =
  | { readonly applied: true; readonly order: StoreOrderView; readonly request: null }
  | { readonly applied: false; readonly order: null; readonly request: AddressChangeRequestView };

@Injectable()
export class StoreOrderEditService {
  constructor(
    private readonly orders: OrderService,
    private readonly storeOrders: StoreOrdersService,
    private readonly policies: ResellerStoreActionPolicyService,
    private readonly holds: StoreAddressChangeService,
  ) {}

  async editRecipient(input: {
    storeId: string;
    storeUserId: string;
    sellerId: string;
    orderId: string;
    patch: StoreEditRecipientDto;
    ctx: ClientContext;
  }): Promise<StoreRecipientEditOutcome> {
    const policy = await this.policies.forStore(input.storeId);

    if (policy.addressFix === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller has not enabled address corrections for this store. Ask them to make the change.',
      });
    }

    // `reason` belongs to the REQUEST, never to the order. It has to come
    // off before the patch reaches `edit`, which refuses every key outside
    // STORE_EDITABLE_KEYS by name (`STORE_EDIT_RECIPIENT_ONLY`) — correct
    // behaviour, and exactly why this cannot be passed through.
    const { reason, ...patch } = input.patch;

    if (policy.addressFix === ResellerStoreActionMode.ASK_SELLER) {
      const said = reason?.trim() ?? '';
      if (said === '') {
        // Seller staff read this before deciding. A correction with no
        // account of where it came from is unanswerable — they cannot
        // tell a corrected typo from a customer who has moved house.
        throw new BadRequestException({
          code: 'ADDRESS_CHANGE_REASON_REQUIRED',
          message:
            'The seller approves address corrections for this store, so tell them why the details are wrong.',
        });
      }
      const request = await this.holds.hold({
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        sellerId: input.sellerId,
        orderId: input.orderId,
        reason: said,
        fields: fieldsFromPatch(patch as UpdateOrderDto),
      });
      return { applied: false, order: null, request };
    }

    await this.orders.edit(
      // The order is the SELLER's; the store id on the scope is what
      // makes this THEIR order rather than any of that seller's.
      input.sellerId,
      input.orderId,
      patch as UpdateOrderDto,
      { type: ActorType.STORE, id: input.storeUserId },
      input.ctx,
      { storeId: input.storeId },
    );

    // Read it back through the store's own projection, so the portal gets
    // the same shape it renders everywhere else.
    const order = await this.storeOrders.detail(input.storeId, input.orderId);
    return { applied: true, order, request: null };
  }

  /**
   * The corrections asked for on one order, and what this store is
   * allowed to do about addresses at all.
   *
   * The mode travels WITH the list because the portal needs both to
   * render honestly: a capability set to OFF is not shown at all (an
   * offered button that always refuses teaches people to ignore
   * refusals), and ASK_SELLER has to say so before somebody types a
   * correction expecting it to take effect.
   */
  async listAddressChanges(
    storeId: string,
    orderId: string,
  ): Promise<{
    items: readonly AddressChangeRequestView[];
    mode: ResellerStoreActionMode;
  }> {
    const [items, policy] = await Promise.all([
      this.holds.listForOrder(storeId, orderId),
      this.policies.forStore(storeId),
    ]);
    return { items, mode: policy.addressFix };
  }
}
