import { ActorType, ResellerStoreActionMode } from '@skydrop/db';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
 * A reseller STORE changing one of its own orders.
 *
 * ── WHAT IT COVERS, AS OF 2026-09-18 (owner) ─────────────────────────
 * It began (2026-09-16) as an address correction, because the commonest
 * fixable failure is a wrong address and the store is the only party who
 * can ring the customer to check it. The owner has widened it to the
 * whole order: the store may change products, quantities, the retail
 * inside its agreed range, the money the customer pays and the
 * customer's details — "only if our main system allows it whatever the
 * case is".
 *
 * That last clause is the whole design. The store is limited ONLY by
 * constraints that are real, and every one of them binds seller staff
 * identically:
 *
 *   - the lifecycle stage: once the order is confirmed its contents are
 *     fixed, because stock is held, a waybill is booked and it may be
 *     packed (`CONTENTS_EDITABLE_STATUSES`);
 *   - the courier: once they hold the address, only they can change it,
 *     and a refusal leaves the order carrying the address the parcel is
 *     actually going to (`recipientChangeRoute`);
 *   - the catalogue: a line with no transfer price under this store's
 *     terms is refused by name rather than priced by us;
 *   - the retail range the seller set;
 *   - the phone, which is the customer's identity (ORD-7);
 *   - the money, which moves only through `ResellerOrderMoneyService`.
 *
 * What a store still cannot do that seller staff can is two fields and a
 * reason for each — `STORE_FORBIDDEN_KEYS` in `order.service.ts`.
 *
 * ── IT REUSES THE SELLER'S EDIT, DELIBERATELY ────────────────────────
 * `OrderService.edit` with a store scope, rather than a parallel writer.
 * That inherits the stage gate, the courier route, address revalidation,
 * the canonical state casing, the money recalculation and the notice to
 * the other side. A second implementation would drift from all of it,
 * and the copy that drifted is the one nobody would be testing.
 *
 * ── THE SELLER'S SWITCH STILL GOVERNS IT ─────────────────────────────
 * `policy.orderChange` — the same column, the same three modes and the
 * same default as the address-correction switch it grew out of:
 *
 *   OFF         — refused, and told who does it instead.
 *   DIRECT      — written onto the order here and now.
 *   ASK_SELLER  — HELD, whole, and the order is untouched until seller
 *                 staff answer.
 */

/**
 * What came of a change. A UNION rather than a nullable order, because
 * "applied" and "waiting" are different things for the portal to say,
 * and a caller that has to infer which from a null field will eventually
 * infer it wrong.
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

    if (policy.orderChange === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller has not enabled changes to orders for this store. Ask them to make the change.',
      });
    }

    // `reason` belongs to the REQUEST, never to the order — `edit` does
    // not know the key and `forbidNonWhitelisted` would reject the whole
    // call. If a future field is added to the DTO it has to come off here
    // too. Everything else IS the proposed change.
    const { reason, ...patch } = input.patch;

    if (policy.orderChange === ResellerStoreActionMode.ASK_SELLER) {
      const said = reason?.trim() ?? '';
      if (said === '') {
        // Seller staff read this before deciding. A change with no
        // account of where it came from is unanswerable — they cannot
        // tell a corrected typo from a customer who has moved house, or
        // an extra unit the customer asked for from a mistake.
        throw new BadRequestException({
          code: 'ADDRESS_CHANGE_REASON_REQUIRED',
          message:
            'The seller approves changes to this store’s orders, so tell them why this one is needed.',
        });
      }
      const request = await this.holds.hold({
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        sellerId: input.sellerId,
        orderId: input.orderId,
        reason: said,
        fields: fieldsFromPatch(patch as UpdateOrderDto),
        patch: patch as Record<string, unknown>,
      });
      return { applied: false, order: null, request };
    }

    await this.apply({
      sellerId: input.sellerId,
      storeId: input.storeId,
      orderId: input.orderId,
      patch: patch as UpdateOrderDto,
      storeUserId: input.storeUserId,
      ctx: input.ctx,
    });

    // Read it back through the store's own projection, so the portal gets
    // the same shape it renders everywhere else.
    const order = await this.storeOrders.detail(input.storeId, input.orderId);
    return { applied: true, order, request: null };
  }

  /**
   * THE ONE APPLIER — a DIRECT change and an APPROVED held one run this
   * same method (`SellerAddressChangeDecisionService` calls it).
   *
   * Two paths that write the order would eventually write it differently,
   * and the one that drifted would be the one an approval used — the
   * path nobody exercises by hand.
   *
   * Attributed to the STORE even when seller staff approved it: the
   * timeline should say who ASKED, not only who allowed. A store user who
   * no longer exists is a STORE actor with no id, never the seller user's
   * id stamped as a store actor, which would name somebody who did not ask.
   */
  async apply(input: {
    sellerId: string;
    storeId: string;
    orderId: string;
    patch: UpdateOrderDto;
    storeUserId: string | null;
    ctx: ClientContext;
  }): Promise<void> {
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
  }

  /**
   * The changes asked for on one order, and what this store is allowed to
   * do about its orders at all.
   *
   * The mode travels WITH the list because the portal needs both to
   * render honestly: a capability set to OFF is not shown at all (an
   * offered button that always refuses teaches people to ignore
   * refusals), and ASK_SELLER has to say so before somebody types a
   * change expecting it to take effect.
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
    return { items, mode: policy.orderChange };
  }
}
