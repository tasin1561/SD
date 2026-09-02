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
  SystemIssueKind,
  SystemIssueSeverity,
  TicketType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierShipmentActionService } from '../../courier-ops/services/courier-shipment-action.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { CourierEscalationService } from '../../courier-escalation/services/courier-escalation.service';
import { TicketService } from '../../ticket/services/ticket.service';

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
    private readonly courier: CourierShipmentActionService,
    private readonly issues: SystemIssueService,
    private readonly tickets: TicketService,
    private readonly escalations: CourierEscalationService,
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
    ctx: ClientInfoPayload;
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

    // ── ALL THREE ACT AT ONCE. None of them waits for an approval ─────
    // A re-attempt and a customer call are TICKETS: ops works them from
    // the ticket queue and the outbox console, which is the approval
    // step — a second one in front of it only delayed the work. RTO
    // reaches Delhivery directly (CUR-10's seller amendment). So the row
    // is recorded as decided the moment it is asked, and never sits
    // PENDING where nobody is going to look at it.
    const sellerDecides = true;

    const row = await this.prisma.client.orderDeliveryActionRequest.create({
      data: {
        orderId: order.id,
        shipmentId: shipment.id,
        sellerId: input.sellerId,
        requestedById: input.sellerUserId,
        action: input.action,
        reason,
        deliveryAttemptId: attempt?.id ?? null,
        ...(sellerDecides
          ? {
              status: DeliveryActionStatus.APPROVED,
              decidedAt: new Date(),
              decisionNote: 'Auto-approved — returning their own parcel is the seller to decide',
            }
          : {}),
      },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: input.sellerId,
      action: 'seller.delivery_action.requested',
      entityType: 'order_delivery_action_request',
      entityId: row.id,
      // HIGH for RTO: this one reaches Delhivery on the strength of the
      // seller's click alone and turns a moving parcel into a return.
      // The other two still stop at an operator, where the risk sits.
      severity: sellerDecides ? 'HIGH' : 'LOW',
      metadata: { orderId: order.id, action: input.action, reason },
    });

    // ── The side-effect is LAST, and the row above is already durable ─
    // Same visible-vs-silent ordering throughout: a crash between leaves
    // an APPROVED request that visibly has not executed and is
    // re-runnable, rather than a parcel turned around or a ticket raised
    // with no record of who asked for it.
    const who = {
      sellerId: input.sellerId,
      sellerUserId: input.sellerUserId,
      orderId: order.id,
      ctx: input.ctx,
    };
    if (input.action === DeliveryActionKind.RTO) {
      return this.executeRto(row.id, shipment.id, who);
    }
    return this.executeAsTicket(row.id, input.action, reason, shipment, who);
  }

  /**
   * A re-attempt or a customer call, as a TICKET.
   *
   * Neither is an API call. RECALL never leaves the building — our own
   * agents phone the customer and write back what they heard. REATTEMPT
   * does leave, but by hand: it opens a courier escalation and puts the
   * seller's own words in the outbox, where an operator sends them to
   * Delhivery and records the answer. There is no automated re-attempt
   * here on purpose — the courier's NDR API is not the channel we use
   * for this, and pretending otherwise would tell a seller a van was
   * arranged when nobody had arranged one.
   *
   * The ticket is the durable fact. If the escalation or the queueing
   * fails, the ticket still stands and ops can still work it, so neither
   * is allowed to throw.
   */
  private async executeAsTicket(
    requestId: string,
    action: DeliveryActionKind,
    reason: string,
    shipment: { id: string; awbNumber: string | null },
    who: { sellerId: string; sellerUserId: string | null; orderId: string },
  ): Promise<DeliveryActionRequestView> {
    const isRecall = action === DeliveryActionKind.RECALL;
    const ticket = await this.tickets.open(
      {
        // The NDR escalation type is the seam the courier-escalation
        // work already hangs off; a re-attempt is the same conversation
        // by a different trigger. A recall never reaches a courier, so
        // it is a plain seller issue.
        ticketType: isRecall ? TicketType.SELLER_RAISED_ISSUE : TicketType.COURIER_NDR_ESCALATION,
        sellerId: who.sellerId,
        subject: isRecall ? 'Request to call the customer' : 'Request another delivery attempt',
        description: reason,
        orderId: who.orderId,
        shipmentId: shipment.id,
      },
      { type: ActorType.SELLER, sellerUserId: who.sellerUserId },
    );

    if (isRecall) {
      // Straight into our own queue, available now: the seller has asked
      // for this call, so it joins at its FIFO position rather than
      // being deferred the way a busy-signal retry is.
      await this.callQueue.enqueueAgain(who.orderId, new Date());
    } else {
      await this.openCourierConversation(ticket.id, shipment, reason, who.sellerId);
    }

    const done = await this.prisma.client.orderDeliveryActionRequest.update({
      where: { id: requestId },
      data: {
        status: DeliveryActionStatus.EXECUTED,
        executedAt: new Date(),
        executionRef: ticket.id,
      },
    });
    return this.toView(done);
  }

  /**
   * Open the Delhivery thread and put the seller's words in the outbox.
   *
   * Best-effort by design: the ticket above is what ops actually works
   * from, and losing the whole request because a thread could not be
   * opened would be the wrong trade. A failure is reported rather than
   * logged, because the seller has been told we are asking the courier.
   */
  private async openCourierConversation(
    ticketId: string,
    shipment: { id: string; awbNumber: string | null },
    reason: string,
    sellerId: string,
  ): Promise<void> {
    try {
      const escalation = await this.escalations.openForTicket({
        ticketId,
        awbNumber: shipment.awbNumber,
      });
      // The seller's own words, verbatim. An operator may add to the
      // thread before sending, but the first thing Delhivery is asked is
      // what the seller actually said happened.
      await this.escalations.postReply({
        escalationId: escalation.id,
        body: reason,
        sellerId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.MEDIUM,
        title: 'A re-attempt ticket could not be put to the courier',
        detail:
          `Ticket ${ticketId} was raised but the courier conversation could not be opened: ` +
          `${message}\n\n` +
          'The ticket is in the ops queue and can still be worked by hand — what is missing is ' +
          'the outbox draft, so nobody will be prompted to send it. Open the escalation on the ' +
          'ticket manually, or reply on it once and the draft is created.',
        source: 'DeliveryActionService',
        dedupeKey: `reattempt-escalation-failed:${ticketId}`,
        metadata: { ticketId, sellerId, error: message },
      });
    }
  }

  /**
   * Cancel with the courier and write the outcome back.
   *
   * Never throws on a courier refusal: the seller's ask is recorded
   * either way, and a thrown 500 would lose the row that says a return
   * was wanted. A refusal becomes FAILED — deliberately distinct from
   * REJECTED, which is a human saying no — and lands on the issues board
   * because a seller now believes their parcel is coming back and it is
   * not.
   */
  private async executeRto(
    requestId: string,
    shipmentId: string,
    who: {
      sellerId: string;
      sellerUserId: string | null;
      orderId: string;
      ctx: ClientInfoPayload;
    },
  ): Promise<DeliveryActionRequestView> {
    try {
      const outcome = await this.courier.cancelWithCourier(
        courierActor.seller(who.sellerId, who.sellerUserId),
        shipmentId,
        'Seller asked for the parcel to be returned',
        who.ctx,
      );
      if (!outcome.success) throw new Error(outcome.message ?? 'Courier refused the cancellation');

      const done = await this.prisma.client.orderDeliveryActionRequest.update({
        where: { id: requestId },
        data: {
          status: DeliveryActionStatus.EXECUTED,
          executedAt: new Date(),
          executionRef: outcome.awbNumber,
        },
      });
      return this.toView(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await this.prisma.client.orderDeliveryActionRequest.update({
        where: { id: requestId },
        data: {
          status: DeliveryActionStatus.FAILED,
          decisionNote: `Courier refused: ${message}`.slice(0, 500),
        },
      });
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: 'A seller asked to return a parcel and the courier refused',
        detail:
          `The cancellation for order ${who.orderId} was refused: ${message}\n\n` +
          'The seller has been told it did not go through, but they are expecting this parcel ' +
          'back. Someone needs to either cancel it by hand in the courier portal or tell them ' +
          'why it cannot be returned — the parcel is still out for delivery until then.',
        source: 'DeliveryActionService',
        dedupeKey: `seller-rto-refused:${requestId}`,
        metadata: { requestId, orderId: who.orderId, sellerId: who.sellerId, error: message },
      });
      return this.toView(failed);
    }
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
