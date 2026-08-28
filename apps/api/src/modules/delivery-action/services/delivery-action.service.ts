import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  DeliveryActionKind,
  DeliveryActionStatus,
  OrderStatus,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';

export interface DeliveryActionRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly shipmentId: string;
  readonly action: DeliveryActionKind;
  readonly reason: string;
  readonly status: DeliveryActionStatus;
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionRef: string | null;
  readonly executionError: string | null;
  readonly createdAt: string;
}

/**
 * Statuses where asking us to do something about the delivery makes
 * sense.
 *
 * DELIVERY_FAILED is the ordinary case. OUT_FOR_DELIVERY is allowed too:
 * a seller who has just heard from their customer that nobody is home
 * should be able to say so before the driver knocks, rather than being
 * made to wait for the failure they can already see coming.
 *
 * Anything past the parcel moving is refused — a delivered order has
 * nothing to re-attempt, and an RTO already in flight cannot be asked
 * for twice.
 */
const REQUESTABLE_FROM: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERY_FAILED,
]);

@Injectable()
export class DeliveryActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly callQueue: CallQueueService,
  ) {}

  /**
   * A seller asks. Nothing reaches a courier here.
   *
   * The request is a record of what they want, not the doing of it —
   * CUR-10 keeps every courier write behind an operator or an explicitly
   * enabled runner, because a re-attempt dispatches a van and an RTO
   * turns a moving parcel into a return.
   */
  async request(input: {
    sellerId: string;
    sellerUserId: string | null;
    orderId: string;
    action: DeliveryActionKind;
    reason: string;
  }): Promise<DeliveryActionRequestView> {
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw new BadRequestException({
        code: 'DELIVERY_ACTION_REASON_TOO_SHORT',
        message: 'Say what happened — at least a sentence. An operator reads this.',
      });
    }

    const order = await this.prisma.client.order.findFirst({
      where: { id: input.orderId, sellerId: input.sellerId, deletedAt: null },
      select: {
        id: true,
        status: true,
        orderShipments: {
          where: { shipment: { deletedAt: null, supersededAt: null } },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
          select: { shipment: { select: { id: true, awbNumber: true } } },
        },
      },
    });
    if (!order) {
      // Scoped to the seller, so someone else's order is indistinguishable
      // from one that does not exist.
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No such order',
      });
    }
    if (!REQUESTABLE_FROM.has(order.status)) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_NOT_APPLICABLE',
        message:
          `This order is ${order.status.toLowerCase().replaceAll('_', ' ')}. ` +
          'Delivery actions apply while the parcel is still out for delivery or has just failed.',
      });
    }

    const shipment = order.orderShipments[0]?.shipment;
    if (!shipment) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_NO_SHIPMENT',
        message: 'This order has no live parcel to act on',
      });
    }

    // One open request at a time. Two pending asks on the same parcel
    // are two operators about to do contradictory things to it.
    const open = await this.prisma.client.orderDeliveryActionRequest.findFirst({
      where: {
        orderId: order.id,
        status: { in: [DeliveryActionStatus.PENDING, DeliveryActionStatus.APPROVED] },
      },
      select: { id: true, action: true },
    });
    if (open) {
      throw new ConflictException({
        code: 'DELIVERY_ACTION_ALREADY_OPEN',
        message: `A ${open.action.toLowerCase()} request on this order is still open`,
        cause: { requestId: open.id },
      });
    }

    // The NDR this answers, so a request cannot later read as a response
    // to a failure that had not happened when it was raised.
    const attempt = await this.prisma.client.deliveryAttempt.findFirst({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const row = await this.prisma.client.orderDeliveryActionRequest.create({
      data: {
        orderId: order.id,
        shipmentId: shipment.id,
        sellerId: input.sellerId,
        requestedById: input.sellerUserId,
        action: input.action,
        reason,
        deliveryAttemptId: attempt?.id ?? null,
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: input.sellerId,
      action: 'seller.delivery_action.requested',
      entityType: 'order_delivery_action_request',
      entityId: row.id,
      // A seller asking is not itself risky; the operator's decision is
      // where the van gets dispatched, and that is audited separately.
      severity: 'LOW',
      metadata: { orderId: order.id, action: input.action, reason },
    });

    return this.toView(row);
  }

  /** Everything a seller has asked for on one order. */
  async listForOrder(
    sellerId: string,
    orderId: string,
  ): Promise<{ items: DeliveryActionRequestView[]; canRequest: boolean }> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, sellerId, deletedAt: null },
      select: { status: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No such order' });
    }
    const rows = await this.prisma.client.orderDeliveryActionRequest.findMany({
      where: { orderId, sellerId },
      orderBy: { createdAt: 'desc' },
    });
    const hasOpen = rows.some(
      (r) =>
        r.status === DeliveryActionStatus.PENDING || r.status === DeliveryActionStatus.APPROVED,
    );
    return {
      items: rows.map((r) => this.toView(r)),
      canRequest: REQUESTABLE_FROM.has(order.status) && !hasOpen,
    };
  }

  private toView(r: {
    id: string;
    orderId: string;
    shipmentId: string;
    action: DeliveryActionKind;
    reason: string;
    status: DeliveryActionStatus;
    decisionNote: string | null;
    decidedAt: Date | null;
    executedAt: Date | null;
    executionRef: string | null;
    executionError: string | null;
    createdAt: Date;
  }): DeliveryActionRequestView {
    return {
      id: r.id,
      orderId: r.orderId,
      shipmentId: r.shipmentId,
      action: r.action,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      executedAt: r.executedAt?.toISOString() ?? null,
      executionRef: r.executionRef,
      executionError: r.executionError,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /**
   * RECALL, carried out.
   *
   * Kept here rather than in the courier layer because it never reaches
   * a courier: the seller is asking OUR agents to phone the customer, so
   * it is a call-queue enqueue and nothing more. It is separated from
   * the courier actions for exactly that reason — CUR-10's operator gate
   * exists to stop a van being dispatched, and no van is involved.
   */
  async executeRecall(
    tx: Prisma.TransactionClient,
    requestId: string,
    orderId: string,
  ): Promise<void> {
    // Available immediately: the seller has asked for this call, so it
    // joins the queue at its FIFO position rather than being deferred
    // the way a busy-signal retry is.
    await this.callQueue.enqueueAgain(orderId, new Date());
    await tx.orderDeliveryActionRequest.update({
      where: { id: requestId },
      data: { status: DeliveryActionStatus.EXECUTED, executedAt: new Date() },
    });
  }
}
