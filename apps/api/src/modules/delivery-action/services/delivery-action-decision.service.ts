import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, DeliveryActionStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { DeliveryActionService } from './delivery-action.service';

/**
 * An operator deciding what to do about a seller's request.
 *
 * Approving runs the same carrying-out every other approval runs
 * (`DeliveryActionService.runApproved`): a re-attempt or a recall is a
 * ticket, a send-back is the courier cancel.
 *
 * ── ORDERING: the decision is durable BEFORE the courier is called ────
 * The claim, the decision and its reason commit first; execution
 * happens after and writes its own outcome back. A crash between leaves
 * an APPROVED request that has visibly not executed — which is the
 * recoverable state, and re-running it is safe because the courier call
 * is the last step rather than something already half-done. The
 * inverse — calling the courier and then recording why — loses the van
 * we just dispatched if the write fails.
 */
@Injectable()
export class DeliveryActionDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly actions: DeliveryActionService,
  ) {}

  /**
   * Every request, oldest first — including a reseller store's ask that
   * is waiting on SELLER STAFF (2026-09-17). Those are listed so Skydrop
   * admin can see what is sitting where, and carry `waitingOnSeller: true`
   * so the screen shows them read-only: deciding one is seller staff's,
   * and the claim below refuses it whatever the screen shows.
   */
  async list(status?: DeliveryActionStatus): Promise<unknown[]> {
    const rows = await this.prisma.client.orderDeliveryActionRequest.findMany({
      where: status === undefined ? {} : { status },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: {
        order: { select: { orderNumber: true, status: true, recipientName: true } },
        seller: { select: { companyName: true } },
        shipment: { select: { shipmentNumber: true, awbNumber: true } },
        resellerStore: { select: { name: true, displayName: true } },
      },
    });
    return rows.map((r) => ({
      ...r,
      waitingOnSeller: r.needsSellerApproval && r.status === DeliveryActionStatus.PENDING,
    }));
  }

  /**
   * Why a claim found nothing: already decided, or a request that is
   * seller staff's to decide. Read AFTER the guarded claim failed, only to
   * choose the words — the predicate is the guard.
   */
  private async refuseClaim(requestId: string): Promise<never> {
    const row = await this.prisma.client.orderDeliveryActionRequest.findUnique({
      where: { id: requestId },
      select: { needsSellerApproval: true, status: true },
    });
    if (row?.needsSellerApproval === true && row.status === DeliveryActionStatus.PENDING) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_HELD_FOR_SELLER',
        message:
          'A reseller store asked this and the seller chose to approve it themselves. Seller staff decide it, not Skydrop admin.',
      });
    }
    throw new ConflictException({
      code: 'DELIVERY_ACTION_ALREADY_DECIDED',
      message: 'Somebody has already decided this request',
    });
  }

  async reject(
    staffId: string,
    requestId: string,
    note: string,
  ): Promise<{ status: DeliveryActionStatus }> {
    const claimed = await this.prisma.client.orderDeliveryActionRequest.updateMany({
      // Claimed on PENDING, not read-then-written: two operators opening
      // the same queue both see it open, and only one may decide it.
      // NEVER a request held for seller staff (2026-09-17): that decision
      // is the seller's, and deciding it here ran a different path.
      where: { id: requestId, status: DeliveryActionStatus.PENDING, needsSellerApproval: false },
      data: {
        status: DeliveryActionStatus.REJECTED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note.trim(),
      },
    });
    if (claimed.count === 0) await this.refuseClaim(requestId);
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.delivery_action.rejected',
      entityType: 'order_delivery_action_request',
      entityId: requestId,
      severity: 'LOW',
      metadata: { note: note.trim() },
    });
    return { status: DeliveryActionStatus.REJECTED };
  }

  /**
   * Approve, then carry it out — through `DeliveryActionService.runApproved`,
   * the ONE carrying-out every approval uses (2026-09-17).
   *
   * This used to call the courier's NDR API for a re-attempt, while every
   * other path (a direct ask, seller staff's approval) opens a ticket and a
   * manual outbox draft — so one request meant two behaviours depending on
   * who approved it. New requests never reach here PENDING (a seller's own
   * ask is created approved, a store's held one is seller staff's), but a
   * seller's re-attempt or recall asked between 28 Aug and 1 Sep 2026 was
   * created PENDING and no migration closed it, so production may still
   * hold some. Approving one now runs exactly what a direct ask runs:
   * the stale re-check, the ticket or the courier cancel, and a throw
   * recorded FAILED rather than left APPROVED.
   */
  async approve(
    staffId: string,
    requestId: string,
    note: string | null,
    ctx: ClientInfoPayload,
  ): Promise<{ status: DeliveryActionStatus; executionRef: string | null }> {
    const claimed = await this.prisma.client.orderDeliveryActionRequest.updateMany({
      // NEVER a request held for seller staff (2026-09-17): that decision
      // is the seller's, and deciding it here ran a different path.
      where: { id: requestId, status: DeliveryActionStatus.PENDING, needsSellerApproval: false },
      data: {
        status: DeliveryActionStatus.APPROVED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note?.trim() ?? null,
      },
    });
    if (claimed.count === 0) await this.refuseClaim(requestId);

    const req = await this.prisma.client.orderDeliveryActionRequest.findUnique({
      where: { id: requestId },
      select: { id: true, action: true, orderId: true },
    });
    if (!req) {
      throw new NotFoundException({
        code: 'DELIVERY_ACTION_NOT_FOUND',
        message: 'No such request',
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.delivery_action.approved',
      entityType: 'order_delivery_action_request',
      entityId: requestId,
      // A moving parcel may become a return. That is not a MEDIUM decision.
      severity: 'HIGH',
      metadata: { action: req.action, orderId: req.orderId, note: note?.trim() ?? null },
    });

    const done = await this.actions.runApproved(req.id, ctx);
    return { status: done.status, executionRef: done.executionRef };
  }
}
