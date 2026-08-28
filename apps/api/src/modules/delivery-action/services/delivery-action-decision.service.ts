import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, DeliveryActionKind, DeliveryActionStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierShipmentActionService } from '../../courier-ops/services/courier-shipment-action.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { DeliveryActionService } from './delivery-action.service';

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

  async list(status?: DeliveryActionStatus): Promise<unknown[]> {
    return this.prisma.client.orderDeliveryActionRequest.findMany({
      where: status === undefined ? {} : { status },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: {
        order: { select: { orderNumber: true, status: true, recipientName: true } },
        seller: { select: { companyName: true } },
        shipment: { select: { shipmentNumber: true, awbNumber: true } },
      },
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
      where: { id: requestId, status: DeliveryActionStatus.PENDING },
      data: {
        status: DeliveryActionStatus.REJECTED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note.trim(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_ALREADY_DECIDED',
        message: 'Somebody has already decided this request',
      });
    }
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
      where: { id: requestId, status: DeliveryActionStatus.PENDING },
      data: {
        status: DeliveryActionStatus.APPROVED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note?.trim() ?? null,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_ALREADY_DECIDED',
        message: 'Somebody has already decided this request',
      });
    }

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
      await this.prisma.client.$transaction(async (tx) => {
        await this.actions.executeRecall(tx, req.id, req.orderId);
      });
      return { status: DeliveryActionStatus.EXECUTED, executionRef: null };
    }

    try {
      const outcome =
        req.action === DeliveryActionKind.REATTEMPT
          ? await this.courier.takeNdrAction(staffId, req.shipmentId, 'RE-ATTEMPT', ctx)
          : await this.courier.cancelWithCourier(
              staffId,
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
