import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryActionKind,
  DeliveryActionStatus,
  ResellerStoreActionMode,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import {
  ResellerStoreActionPolicyService,
  type ActionCapability,
} from '../../reseller-store/services/reseller-store-action-policy.service';
import { DeliveryActionService, type DeliveryActionRequestView } from './delivery-action.service';
import { StoreActionNotifier } from './store-action-notifier.service';

/**
 * A reseller STORE asking for something about one of its own orders
 * (2026-09-16, owner).
 *
 * The store asks; the store's POLICY — which the seller set — decides
 * whether that goes straight through or waits for the seller. This
 * service is only that routing: the doing of it is
 * `DeliveryActionService`, unchanged, so a store's recall and a seller's
 * recall are the same code and cannot drift into two behaviours.
 *
 * ── THE ORDER MUST BE THE STORE'S ────────────────────────────────────
 * Scoped in the WHERE clause on the store id from the TOKEN, never a
 * parameter. Another store's order — or the seller's own channel order —
 * is a 404 that says nothing about whether it exists.
 */

/** Which policy column governs which action. */
const CAPABILITY_OF: Readonly<Record<DeliveryActionKind, ActionCapability>> = {
  [DeliveryActionKind.RECALL]: 'recall',
  [DeliveryActionKind.REATTEMPT]: 'reattempt',
  [DeliveryActionKind.RTO]: 'sendBack',
};

/** What a store is told when the seller has switched a capability off. */
const OFF_MESSAGE: Readonly<Record<DeliveryActionKind, string>> = {
  [DeliveryActionKind.RECALL]: 'The seller has not enabled customer calls for this store.',
  [DeliveryActionKind.REATTEMPT]: 'The seller has not enabled re-attempts for this store.',
  [DeliveryActionKind.RTO]: 'The seller has not enabled returns for this store.',
};

export interface StoreActionOutcome {
  readonly request: DeliveryActionRequestView;
  /** True when it is now waiting on the seller rather than done. */
  readonly awaitingSeller: boolean;
}

@Injectable()
export class StoreDeliveryActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: DeliveryActionService,
    private readonly policies: ResellerStoreActionPolicyService,
    private readonly notifier: StoreActionNotifier,
  ) {}

  async request(input: {
    storeId: string;
    storeUserId: string | null;
    orderId: string;
    action: DeliveryActionKind;
    reason: string;
    ctx: ClientInfoPayload;
  }): Promise<StoreActionOutcome> {
    const order = await this.ownOrder(input.storeId, input.orderId);
    const policy = await this.policies.forStore(input.storeId);
    const mode = policy[CAPABILITY_OF[input.action]];

    if (mode === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message: OFF_MESSAGE[input.action],
      });
    }

    const request = await this.actions.request({
      sellerId: order.sellerId,
      // The store's team member, never a seller user: nobody at the
      // seller touched this.
      sellerUserId: null,
      orderId: input.orderId,
      action: input.action,
      reason: input.reason,
      ctx: input.ctx,
      store: {
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        needsSellerApproval: mode === ResellerStoreActionMode.ASK_SELLER,
      },
    });

    const awaitingSeller = request.status === DeliveryActionStatus.PENDING;
    if (awaitingSeller) {
      // Nothing happens until the seller answers, so somebody there has
      // to know it is sitting with them. Awaited and never throwing: the
      // request is the durable fact (NOTIF-1/NOTIF-19).
      await this.notifier.waitingOnSeller({
        sellerId: order.sellerId,
        requestId: request.id,
        storeName: order.storeName,
        orderNumber: order.orderNumber,
        action: input.action,
        reason: input.reason.trim(),
      });
    }

    return { request, awaitingSeller };
  }

  /** Everything this store has asked for on one of its orders. */
  async listForOrder(
    storeId: string,
    orderId: string,
  ): Promise<{
    items: DeliveryActionRequestView[];
    allowed: Record<ActionCapability, ResellerStoreActionMode>;
  }> {
    await this.ownOrder(storeId, orderId);
    const [rows, policy] = await Promise.all([
      this.prisma.client.orderDeliveryActionRequest.findMany({
        where: { orderId, resellerStoreId: storeId },
        orderBy: { createdAt: 'desc' },
      }),
      this.policies.forStore(storeId),
    ]);
    return {
      items: rows.map((r) => this.actions.toView(r)),
      allowed: {
        recall: policy.recall,
        orderChange: policy.orderChange,
        cancel: policy.cancel,
        callCapDecision: policy.callCapDecision,
        chaseSkydrop: policy.chaseSkydrop,
        reattempt: policy.reattempt,
        sendBack: policy.sendBack,
      },
    };
  }

  /** This store's own order, or a 404 that says nothing more. */
  private async ownOrder(
    storeId: string,
    orderId: string,
  ): Promise<{ sellerId: string; orderNumber: string; storeName: string }> {
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: orderId,
        storeId,
        storeKind: SellerStoreKind.RESELLER,
        deletedAt: null,
      },
      // The store's name AS PLACED (ORD-6): what the notice calls them is
      // what they were called when the order was taken.
      select: { sellerId: true, orderNumber: true, storeNameSnapshot: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No such order' });
    }
    return {
      sellerId: order.sellerId,
      orderNumber: order.orderNumber,
      storeName: order.storeNameSnapshot ?? 'a reseller store',
    };
  }

  /** Guard used by the seller's queue: the request is a store's, and open. */
  async loadOpenForSeller(
    sellerId: string,
    requestId: string,
  ): Promise<{ id: string; orderId: string; shipmentId: string; action: DeliveryActionKind }> {
    const row = await this.prisma.client.orderDeliveryActionRequest.findFirst({
      where: {
        id: requestId,
        sellerId,
        resellerStoreId: { not: null },
        needsSellerApproval: true,
        status: DeliveryActionStatus.PENDING,
      },
      select: { id: true, orderId: true, shipmentId: true, action: true },
    });
    if (row === null) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_ALREADY_DECIDED',
        message: 'This request is no longer waiting for you',
      });
    }
    return row;
  }
}
