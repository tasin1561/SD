import { ConflictException, Injectable } from '@nestjs/common';
import { ActorType, DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DeliveryActionService, type DeliveryActionRequestView } from './delivery-action.service';
import { StoreActionNotifier } from './store-action-notifier.service';

/**
 * The SELLER deciding what one of their reseller stores asked for
 * (2026-09-16, owner).
 *
 * The store's policy said "ask the seller", so the request stopped at
 * PENDING and is sitting here. This is the twin of the staff decision
 * service, with two differences that matter:
 *
 *  - the decider is a SELLER, recorded in `decidedBySellerUserId` and
 *    `sellerDecidedAt` — never in the staff columns, or "who allowed
 *    this" would read as Skydrop when it was the seller; and
 *  - approving RUNS it, through the same paths a direct ask uses, so a
 *    store's recall is one behaviour however it was authorised.
 *
 * ── CLAIMED, NEVER READ-THEN-WRITTEN ─────────────────────────────────
 * A guarded `updateMany` on (PENDING, needs the seller, this seller's)
 * is the claim. Two tabs open on the queue both see it waiting; only one
 * may decide it, and the loser is told so rather than quietly running a
 * courier call twice.
 */
@Injectable()
export class SellerStoreActionDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly actions: DeliveryActionService,
    private readonly notifier: StoreActionNotifier,
  ) {}

  /** What this seller's stores are waiting on, oldest first. */
  async listPending(sellerId: string): Promise<readonly unknown[]> {
    return this.prisma.client.orderDeliveryActionRequest.findMany({
      where: {
        sellerId,
        resellerStoreId: { not: null },
        needsSellerApproval: true,
        status: DeliveryActionStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        order: { select: { orderNumber: true, status: true, recipientName: true } },
        shipment: { select: { shipmentNumber: true, awbNumber: true } },
        resellerStore: { select: { id: true, name: true, displayName: true } },
      },
    });
  }

  async approve(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string | null,
    ctx: ClientInfoPayload,
  ): Promise<DeliveryActionRequestView> {
    const row = await this.claim(seller, requestId, true, note);

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_delivery_action.approved',
      entityType: 'order_delivery_action_request',
      entityId: requestId,
      // A van goes out, or a moving parcel becomes a return, on the
      // seller's say-so about somebody else's customer.
      severity: row.action === DeliveryActionKind.RECALL ? 'MEDIUM' : 'HIGH',
      metadata: { action: row.action, orderId: row.orderId, storeId: row.resellerStoreId },
    });

    // Told BEFORE it runs. The decision is the durable fact and the
    // store's answer to their customer; whether the courier then accepts
    // it is a separate outcome they follow on the order.
    await this.tellTheStore(row, true);
    return this.actions.runApproved(requestId, ctx);
  }

  async reject(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string,
  ): Promise<DeliveryActionRequestView> {
    const row = await this.claim(seller, requestId, false, note);

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_delivery_action.rejected',
      entityType: 'order_delivery_action_request',
      entityId: requestId,
      severity: 'LOW',
      metadata: { action: row.action, orderId: row.orderId, storeId: row.resellerStoreId },
    });

    await this.tellTheStore(row, false);

    const done = await this.prisma.client.orderDeliveryActionRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return this.actions.toView(done);
  }

  /**
   * Email the store what was decided.
   *
   * They have no inbox, and somebody there has a customer waiting on
   * this answer — a decision they only discover by refreshing a screen
   * is the same as not being told. Never throws (NOTIF-1).
   */
  private async tellTheStore(
    row: {
      id: string;
      action: DeliveryActionKind;
      orderId: string;
      reason: string;
      decisionNote: string | null;
      resellerStoreId: string | null;
    },
    approved: boolean,
  ): Promise<void> {
    if (row.resellerStoreId === null) return;
    const order = await this.prisma.client.order.findUnique({
      where: { id: row.orderId },
      select: { orderNumber: true, seller: { select: { companyName: true } } },
    });
    if (order === null) return;
    await this.notifier.decided({
      storeId: row.resellerStoreId,
      requestId: row.id,
      approved,
      orderId: row.orderId,
      orderNumber: order.orderNumber,
      sellerName: order.seller.companyName,
      action: row.action,
      reason: row.reason,
      decisionNote: row.decisionNote,
    });
  }

  /**
   * Take the decision, or find out somebody else already did.
   *
   * The seller's answer lands in the SELLER columns. `decidedAt` and
   * `decidedById` stay free for a staff decision, so a request that later
   * passes an operator carries both answers in order rather than one
   * overwriting the other.
   */
  private async claim(
    seller: AuthenticatedSeller,
    requestId: string,
    approved: boolean,
    note: string | null,
  ): Promise<{
    id: string;
    action: DeliveryActionKind;
    orderId: string;
    reason: string;
    decisionNote: string | null;
    resellerStoreId: string | null;
  }> {
    const claimed = await this.prisma.client.orderDeliveryActionRequest.updateMany({
      where: {
        id: requestId,
        sellerId: seller.id,
        resellerStoreId: { not: null },
        needsSellerApproval: true,
        status: DeliveryActionStatus.PENDING,
      },
      data: {
        status: approved ? DeliveryActionStatus.APPROVED : DeliveryActionStatus.REJECTED,
        decidedBySellerUserId: seller.userId,
        sellerDecidedAt: new Date(),
        decisionNote: note?.trim() === '' ? null : (note?.trim() ?? null),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_ALREADY_DECIDED',
        message: 'This request is no longer waiting for you',
      });
    }
    const row = await this.prisma.client.orderDeliveryActionRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        action: true,
        orderId: true,
        reason: true,
        decisionNote: true,
        resellerStoreId: true,
      },
    });
    return row;
  }
}
