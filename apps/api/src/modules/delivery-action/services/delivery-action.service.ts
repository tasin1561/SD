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
  SystemIssueKind,
  SystemIssueSeverity,
  TicketType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { DELIVERY_ACTION_STATUSES } from '../delivery-action-stages';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierShipmentActionService } from '../../courier-ops/services/courier-shipment-action.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { CourierEscalationService } from '../../courier-escalation/services/courier-escalation.service';
import { TicketService } from '../../ticket/services/ticket.service';
import { CallQueueReason } from '@skydrop/db';

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

/** Where a delivery action applies — the shared list (see its file). */
const REQUESTABLE_FROM = DELIVERY_ACTION_STATUSES;

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
    /**
     * Set when a RESELLER STORE is asking, not the seller (2026-09-16).
     *
     * The store's own id and user, so the record — and the courier audit
     * behind a send-back — says the store asked. `needsSellerApproval`
     * comes from the store's policy and is SNAPSHOTTED on the row: read
     * live, a policy changed while a request was open would retroactively
     * decide a question already put.
     */
    store?: {
      readonly storeId: string;
      readonly storeUserId: string | null;
      readonly needsSellerApproval: boolean;
    };
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
    // A STORE whose seller wants to see it first stops HERE, PENDING.
    // Everyone else acts at once, as before.
    const waitsForSeller = input.store?.needsSellerApproval === true;
    const sellerDecides = !waitsForSeller;

    // ── ONE OPEN REQUEST PER ORDER, under a lock (2026-09-17) ─────────
    // Two open asks on one parcel are two people about to do contradictory
    // things to it. The check used to be a read before the insert with
    // nothing between them, so a double click passed twice and a DIRECT
    // send-back asked the courier to cancel twice. Under READ COMMITTED a
    // read is not a guard: the re-check and the insert now run in ONE
    // transaction holding `DELIVERY_ACTION_REQUEST` on the order, so the
    // second caller waits, then sees the first row and is refused. Only
    // the row that won is ever carried out below.
    const row = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.DELIVERY_ACTION_REQUEST, order.id);
      const open = await tx.orderDeliveryActionRequest.findFirst({
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
      return tx.orderDeliveryActionRequest.create({
        data: {
          orderId: order.id,
          shipmentId: shipment.id,
          sellerId: input.sellerId,
          requestedById: input.sellerUserId,
          action: input.action,
          reason,
          deliveryAttemptId: attempt?.id ?? null,
          ...(input.store === undefined
            ? {}
            : {
                resellerStoreId: input.store.storeId,
                needsSellerApproval: input.store.needsSellerApproval,
              }),
          ...(sellerDecides
            ? {
                status: DeliveryActionStatus.APPROVED,
                decidedAt: new Date(),
                decisionNote:
                  input.store === undefined
                    ? 'Auto-approved — returning their own parcel is the seller to decide'
                    : 'The seller lets this store act on its own orders without asking',
              }
            : {}),
        },
      });
    });

    await this.audit.log({
      // The STORE asked, when it did. "The store decided to send this
      // back" and "the seller did" are different facts, and only one of
      // them is the seller's to answer for.
      actorType: input.store === undefined ? ActorType.SELLER : ActorType.STORE,
      // null, never undefined: a store API key acted with no person
      // behind it, and the audit row records that as "no actor id"
      // rather than as an absent field.
      actorId: input.store?.storeUserId ?? null,
      sellerId: input.sellerId,
      action:
        input.store === undefined
          ? 'seller.delivery_action.requested'
          : 'store.delivery_action.requested',
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
    // Waiting on the seller: the row is the whole of it for now. The
    // seller's yes runs the same paths below, from their own service.
    if (waitsForSeller) return this.toView(row);

    const who = {
      sellerId: input.sellerId,
      sellerUserId: input.sellerUserId,
      orderId: order.id,
      ctx: input.ctx,
      ...(input.store === undefined
        ? {}
        : { store: { storeId: input.store.storeId, storeUserId: input.store.storeUserId } }),
    };
    // Through the SAME carrying-out `runApproved` uses: a throw on the way
    // (a ticket that would not open, a queue that would not take the call)
    // is recorded FAILED with its reason, so the row stops being open and
    // the order is not stuck refusing every later ask as ALREADY_OPEN.
    const done = await this.carryOut(row, async () => shipment, who);
    if (done.status === DeliveryActionStatus.FAILED && done.threw) {
      // Surfaced, not swallowed: the caller asked for this a moment ago and
      // must not read a request that did nothing as done. The row already
      // says FAILED with the same words, so a refresh agrees.
      throw new ConflictException({
        code: 'DELIVERY_ACTION_FAILED',
        message: done.view.executionError ?? 'The request could not be carried out.',
        cause: { requestId: row.id },
      });
    }
    return done.view;
  }

  /**
   * Carry out an APPROVED request — the ONE implementation, shared by a
   * direct ask (`request`) and an approved one (`runApproved`).
   *
   * A send-back goes to the courier (`executeRto`, which records a courier
   * refusal itself); a recall or a re-attempt becomes a ticket
   * (`executeAsTicket`). Anything THROWN on the way is recorded FAILED with
   * the error through `recordFailure` — never left APPROVED, because an
   * APPROVED row counts as open and would refuse every later request on
   * the order. `threw` tells the caller the failure was an exception rather
   * than a refusal the far side gave.
   */
  private async carryOut(
    row: { id: string; action: DeliveryActionKind; reason: string },
    loadShipment: () => Promise<{ id: string; awbNumber: string | null }>,
    who: {
      sellerId: string;
      sellerUserId: string | null;
      orderId: string;
      ctx: ClientInfoPayload;
      store?: { storeId: string; storeUserId: string | null };
    },
  ): Promise<{ view: DeliveryActionRequestView; status: DeliveryActionStatus; threw: boolean }> {
    try {
      const shipment = await loadShipment();
      const view =
        row.action === DeliveryActionKind.RTO
          ? await this.executeRto(row.id, shipment.id, who)
          : await this.executeAsTicket(row.id, row.action, row.reason, shipment, who);
      return { view, status: view.status, threw: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const view = await this.recordFailure(row.id, `It could not be carried out: ${message}`);
      return { view, status: view.status, threw: true };
    }
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
    who: {
      sellerId: string;
      sellerUserId: string | null;
      orderId: string;
      store?: { storeId: string; storeUserId: string | null };
    },
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
        // Written as the SELLER'S OWN REQUEST, in their voice.
        //
        // These read back to the person who raised them, on their own
        // ticket list, so a subject phrased from our side of the desk
        // ("Seller asked us to call the customer") tells them something
        // they already know, in a voice that is not theirs. The rest of
        // a ticket is verbatim — what they wrote, what we found, what
        // the courier said — and the subject is the one line that was
        // not.
        //
        // It reads correctly for staff too: the admin list carries a
        // "Raised by" column, so the subject there is plainly the
        // seller's words being quoted.
        subject: isRecall ? 'Call the customer for me' : 'Try delivering it again',
        description: reason,
        orderId: who.orderId,
        shipmentId: shipment.id,
        // RS-7's columns: a store's ticket is the STORE's, so it appears
        // on their list and reads as their words, not the seller's.
        ...(who.store === undefined
          ? {}
          : { storeId: who.store.storeId, openedByStoreUserId: who.store.storeUserId }),
      },
      who.store === undefined
        ? { type: ActorType.SELLER, sellerUserId: who.sellerUserId }
        : { type: ActorType.STORE, storeUserId: who.store.storeUserId },
    );

    if (isRecall) {
      // Straight into our own queue, available now: the seller has asked
      // for this call, so it joins at its FIFO position rather than
      // being deferred the way a busy-signal retry is.
      await this.callQueue.enqueueAgain(
        who.orderId,
        new Date(),
        undefined,
        // The agent is told who wants the customer rung. A store's
        // customer has never heard of the seller.
        who.store === undefined ? CallQueueReason.SELLER_ASKED : CallQueueReason.STORE_ASKED,
      );
    } else {
      await this.openCourierConversation(ticket.id, shipment, reason, who.sellerId);
    }

    // Guarded on APPROVED: only an approved, still-open request becomes
    // EXECUTED. A row something else already closed keeps its outcome.
    return this.finish(requestId, {
      status: DeliveryActionStatus.EXECUTED,
      executedAt: new Date(),
      executionRef: ticket.id,
    });
  }

  /**
   * Move an APPROVED request to its final state, guarded on APPROVED, and
   * return the row as it now stands. A plain `update` would overwrite a
   * row somebody else had already closed.
   */
  private async finish(
    requestId: string,
    data: {
      status: DeliveryActionStatus;
      executedAt: Date;
      executionRef?: string | null;
      executionError?: string | null;
      decisionNote?: string;
    },
  ): Promise<DeliveryActionRequestView> {
    await this.prisma.client.orderDeliveryActionRequest.updateMany({
      where: { id: requestId, status: DeliveryActionStatus.APPROVED },
      data,
    });
    return this.toView(
      await this.prisma.client.orderDeliveryActionRequest.findUniqueOrThrow({
        where: { id: requestId },
      }),
    );
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
      store?: { storeId: string; storeUserId: string | null };
    },
  ): Promise<DeliveryActionRequestView> {
    try {
      const outcome = await this.courier.cancelWithCourier(
        // Whoever actually asked. The credential-decrypt audit behind
        // this call is how "who told Delhivery to turn this parcel
        // round" is answered months later.
        who.store === undefined
          ? courierActor.seller(who.sellerId, who.sellerUserId)
          : courierActor.store(who.store.storeId, who.store.storeUserId),
        shipmentId,
        who.store === undefined
          ? 'Seller asked for the parcel to be returned'
          : 'The store that sold it asked for the parcel to be returned',
        who.ctx,
      );
      if (!outcome.success) throw new Error(outcome.message ?? 'Courier refused the cancellation');

      return await this.finish(requestId, {
        status: DeliveryActionStatus.EXECUTED,
        executedAt: new Date(),
        executionRef: outcome.awbNumber,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await this.finish(requestId, {
        status: DeliveryActionStatus.FAILED,
        executedAt: new Date(),
        // `executionError`, and the decision note only when nobody
        // decided: a store's request carries seller staff's own note in
        // `decisionNote`, and overwriting it lost their words.
        executionError: `Courier refused: ${message}`.slice(0, 2000),
        ...(who.store === undefined
          ? { decisionNote: `Courier refused: ${message}`.slice(0, 500) }
          : {}),
      });
      // Name who actually asked: a reseller store's send-back is not the
      // seller's, and whoever picks this up rings a different party.
      const asker = who.store === undefined ? 'seller' : 'reseller store';
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: `A ${asker} asked to return a parcel and the courier refused`,
        detail:
          `The cancellation for order ${who.orderId} was refused: ${message}\n\n` +
          `The ${asker} has been told it did not go through, but they are expecting this parcel ` +
          'back. Someone needs to either cancel it by hand in the courier portal or tell them ' +
          'why it cannot be returned — the parcel is still out for delivery until then.',
        source: 'DeliveryActionService',
        dedupeKey: `seller-rto-refused:${requestId}`,
        metadata: { requestId, orderId: who.orderId, sellerId: who.sellerId, error: message },
      });
      return failed;
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

  /**
   * Carry out a request somebody has already approved.
   *
   * Seller staff approving a store's ask, and Skydrop admin approving a
   * recall, both run THIS — and it runs the SAME paths a direct ask runs
   * (`executeAsTicket` for a recall or a re-attempt, `executeRto` for a
   * send-back), so an approved recall opens the ticket a direct recall
   * opens. The store context comes off the ROW, not the caller: by now the
   * person approving is not the one who asked.
   *
   * ── RE-CHECKED BEFORE IT RUNS (2026-09-17) ──────────────────────────
   * Time passes between asking and answering. If the order is no longer
   * out for delivery or failed, or its live parcel is no longer the one
   * asked about, NOTHING is carried out: the row is recorded FAILED with
   * a reason a person can repeat to a customer. A send-back approved days
   * later must not turn round a parcel that has since been delivered.
   *
   * ── NEVER LEFT APPROVED ─────────────────────────────────────────────
   * Any throw on the way (a ticket that would not open, a queue that
   * would not take the call) is recorded as FAILED with the error, never
   * left as an APPROVED row that visibly did nothing forever.
   */
  async runApproved(requestId: string, ctx: ClientInfoPayload): Promise<DeliveryActionRequestView> {
    const row = await this.prisma.client.orderDeliveryActionRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        action: true,
        reason: true,
        orderId: true,
        sellerId: true,
        shipmentId: true,
        status: true,
        resellerStoreId: true,
        requestedById: true,
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'DELIVERY_ACTION_NOT_FOUND',
        message: 'No such request',
      });
    }
    if (row.status !== DeliveryActionStatus.APPROVED) {
      // Only an approved, not-yet-run request may be carried out.
      return this.toView(
        await this.prisma.client.orderDeliveryActionRequest.findUniqueOrThrow({
          where: { id: row.id },
        }),
      );
    }

    const stale = await this.stillApplies(row.orderId, row.shipmentId);
    if (stale !== null) return this.recordFailure(row.id, stale);

    const store =
      row.resellerStoreId === null
        ? undefined
        : { storeId: row.resellerStoreId, storeUserId: row.requestedById };
    const who = {
      sellerId: row.sellerId,
      sellerUserId: store === undefined ? row.requestedById : null,
      orderId: row.orderId,
      ctx,
      ...(store === undefined ? {} : { store }),
    };
    const done = await this.carryOut(
      row,
      () =>
        this.prisma.client.shipment.findUniqueOrThrow({
          where: { id: row.shipmentId },
          select: { id: true, awbNumber: true },
        }),
      who,
    );
    return done.view;
  }

  /**
   * Why an approved request no longer applies, or null when it still does.
   * The order must still be out for delivery or have just failed, and the
   * parcel asked about must still be its live one.
   */
  async stillApplies(orderId: string, shipmentId: string): Promise<string | null> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        status: true,
        orderShipments: {
          where: { shipment: { deletedAt: null, supersededAt: null } },
          orderBy: { shipmentSequence: 'desc' },
          take: 1,
          select: { shipmentId: true },
        },
      },
    });
    if (order === null) return '[ORDER_NOT_FOUND] The order no longer exists.';
    if (!REQUESTABLE_FROM.has(order.status)) {
      return (
        `[DELIVERY_ACTION_NOT_APPLICABLE] By the time this was approved the order was ` +
        `${order.status.toLowerCase().replaceAll('_', ' ')}, so nothing was done.`
      );
    }
    if (order.orderShipments[0]?.shipmentId !== shipmentId) {
      return '[DELIVERY_ACTION_NO_SHIPMENT] The parcel this was about is no longer the live one, so nothing was done.';
    }
    return null;
  }

  /** Close an approved request that could not be carried out. Guarded on APPROVED. */
  async recordFailure(requestId: string, reason: string): Promise<DeliveryActionRequestView> {
    await this.prisma.client.orderDeliveryActionRequest.updateMany({
      where: { id: requestId, status: DeliveryActionStatus.APPROVED },
      data: {
        status: DeliveryActionStatus.FAILED,
        executedAt: new Date(),
        executionError: reason.slice(0, 2000),
      },
    });
    return this.toView(
      await this.prisma.client.orderDeliveryActionRequest.findUniqueOrThrow({
        where: { id: requestId },
      }),
    );
  }

  /**
   * Public since 2026-09-16: the store-facing service lists a store's own
   * requests and must render them the SAME way, rather than keeping a
   * second projection that slowly disagrees about what a request looks
   * like.
   */
  toView(r: {
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
}
