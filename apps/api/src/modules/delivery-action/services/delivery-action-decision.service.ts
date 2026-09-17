import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierShipmentActionService } from '../../courier-ops/services/courier-shipment-action.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { DeliveryActionService } from './delivery-action.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

/**
 * An operator deciding what to do about a seller's request.
 *
 * This is the CUR-10 gate. A seller asks; a human here says yes, and
 * only then does anything reach a courier — a re-attempt dispatches a
 * van, an RTO turns a moving parcel into a return, and neither should
 * ever be fired by a seller-facing handler.
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
  private readonly logger = new Logger(DeliveryActionDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly courier: CourierShipmentActionService,
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
   * Approve, then carry it out.
   *
   * RECALL never leaves the building — it enqueues the order for our own
   * agents. REATTEMPT and RTO reach Delhivery, and both are recorded
   * with whatever the courier gave back: a UPL id, not an outcome, since
   * Delhivery decides asynchronously and the answer arrives later on a
   * scan (CUR-11 — their scans remain the authority on where the parcel
   * is, not this call's return value).
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
      select: { id: true, action: true, shipmentId: true, orderId: true, sellerId: true },
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
      // A van gets dispatched, or a moving parcel becomes a return.
      // That is not a MEDIUM decision.
      severity: 'HIGH',
      metadata: { action: req.action, orderId: req.orderId, note: note?.trim() ?? null },
    });

    if (req.action === DeliveryActionKind.RECALL) {
      // The ONE recall implementation: the ticket, the call queue, the
      // outcome recorded — exactly what a direct recall does.
      const done = await this.actions.runApproved(req.id, ctx);
      return { status: done.status, executionRef: done.executionRef };
    }

    // Re-checked before a courier is called (2026-09-17): an approval made
    // after the parcel was delivered must not turn it round.
    const stale = await this.actions.stillApplies(req.orderId, req.shipmentId);
    if (stale !== null) {
      const done = await this.actions.recordFailure(req.id, stale);
      return { status: done.status, executionRef: null };
    }

    try {
      const outcome =
        req.action === DeliveryActionKind.REATTEMPT
          ? await this.courier.takeNdrAction(staffId, req.shipmentId, 'RE-ATTEMPT', ctx)
          : await this.courier.cancelWithCourier(
              courierActor.operator(staffId),
              req.shipmentId,
              'Seller asked for the parcel to be returned',
              ctx,
            );

      const ref = 'uplId' in outcome && typeof outcome.uplId === 'string' ? outcome.uplId : null;

      await this.prisma.client.orderDeliveryActionRequest.update({
        where: { id: requestId },
        data: {
          status: outcome.success ? DeliveryActionStatus.EXECUTED : DeliveryActionStatus.FAILED,
          executedAt: new Date(),
          executionRef: ref,
          executionError: outcome.success ? null : (outcome.message ?? 'The courier refused'),
        },
      });
      return {
        status: outcome.success ? DeliveryActionStatus.EXECUTED : DeliveryActionStatus.FAILED,
        executionRef: ref,
      };
    } catch (err) {
      // FAILED, not REJECTED. A human said yes and the far side could
      // not carry it out — a different situation from a refusal, and it
      // needs a different response from whoever picks it up.
      const message = err instanceof Error ? err.message : 'The courier call failed';
      this.logger.error({ requestId, action: req.action, err }, 'Delivery action failed');
      await this.prisma.client.orderDeliveryActionRequest.update({
        where: { id: requestId },
        data: {
          status: DeliveryActionStatus.FAILED,
          executedAt: new Date(),
          executionError: message,
        },
      });
      return { status: DeliveryActionStatus.FAILED, executionRef: null };
    }
  }
}
