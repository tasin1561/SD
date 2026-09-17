import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  OrderCancellationReason,
  SellerStoreKind,
  StoreCallCapProposal,
  StoreOrderRequestKind,
  StoreOrderRequestStatus,
} from '@skydrop/db';
import { pendingStoreOrderRequestsWhere } from '../../reseller-store/services/seller-store-request-count.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EarlyReservationDecisionService } from '../../early-reservation-decision/services/early-reservation-decision.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import {
  StoreOrderRequestService,
  storeOrderRequestLabel,
  type StoreOrderRequestRow,
  type StoreOrderRequestView,
} from '../../store-order-request/services/store-order-request.service';
import { StoreRequestNotifier } from '../../store-order-request/services/store-request-notifier.service';
import { TicketService } from '../../ticket/services/ticket.service';

/** What carrying one out came to. */
interface Execution {
  readonly ok: boolean;
  readonly ref: string | null;
  /** The server's own words for why it could not be carried out. */
  readonly failure: string | null;
  /** A sentence the store can repeat to its customer. */
  readonly outcome: string;
}

/**
 * Seller staff deciding a reseller store's held cancel, call-cap answer
 * or issue with Skydrop (2026-09-17, owner: "the approve and reject is
 * done by seller not by skydrop").
 *
 * A LEAF: it imports `order`, `early-reservation-decision` and `ticket`
 * so that approving runs EXACTLY what a DIRECT request runs — the store's
 * cancel through `cancelBySeller`, its answer through `decideAsStore`, its
 * issue through `openStoreIssue`, each attributed to the STORE. Nothing
 * imports this module.
 *
 * ── ORDER OF EVENTS ON APPROVE ───────────────────────────────────────
 *  1. CLAIM: a guarded `updateMany` PENDING → APPROVED on (id, seller).
 *     Two tabs: one decides, the other is told so.
 *  2. RUN, re-checking that it still applies — the order may have been
 *     packed, the review answered, the order gone. A refusal is not
 *     thrown at seller staff (they answered correctly and the world moved
 *     on); it is recorded.
 *  3. RECORD the TRUE outcome: EXECUTED, or FAILED with the refusal
 *     verbatim. Never an APPROVED row that did nothing.
 *  4. EMAIL the store the real result — never before it is known.
 */
@Injectable()
export class SellerStoreOrderRequestDecisionService {
  private readonly logger = new Logger(SellerStoreOrderRequestDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly requests: StoreOrderRequestService,
    private readonly notifier: StoreRequestNotifier,
    private readonly orderWrite: OrderWriteService,
    private readonly callCap: EarlyReservationDecisionService,
    private readonly tickets: TicketService,
  ) {}

  /** What this seller's stores are waiting on, oldest first. */
  async listPending(sellerId: string): Promise<readonly unknown[]> {
    const rows = await this.prisma.client.storeOrderRequest.findMany({
      where: pendingStoreOrderRequestsWhere(sellerId),
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        order: { select: { orderNumber: true, status: true, recipientName: true } },
        store: { select: { id: true, name: true, displayName: true } },
      },
    });
    return rows.map((r) => ({
      ...this.requests.toView(r),
      order: r.order,
      store: r.store,
    }));
  }

  async approve(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string | null,
    ctx: ClientInfoPayload,
  ): Promise<StoreOrderRequestView> {
    const row = await this.claim(seller, requestId, true, note);

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_order_request.approved',
      entityType: 'store_order_request',
      entityId: requestId,
      severity: row.kind === StoreOrderRequestKind.RAISE_ISSUE ? 'LOW' : 'MEDIUM',
      metadata: { kind: row.kind, orderId: row.orderId, storeId: row.storeId },
    });

    let run: Execution;
    try {
      run = await this.execute(row, ctx);
    } catch (err) {
      // `execute` catches its own refusals; this is the unexpected one.
      // Still recorded, never left APPROVED.
      run = {
        ok: false,
        ref: null,
        failure: refusal(err),
        outcome: `It could not be carried out: ${refusal(err)}`,
      };
    }

    await this.prisma.client.storeOrderRequest.updateMany({
      where: { id: requestId, status: StoreOrderRequestStatus.APPROVED },
      data: run.ok
        ? {
            status: StoreOrderRequestStatus.EXECUTED,
            executedAt: new Date(),
            executionRef: run.ref,
          }
        : { status: StoreOrderRequestStatus.FAILED, failureReason: run.failure },
    });
    if (!run.ok) {
      this.logger.warn(
        { requestId, kind: row.kind, err: run.failure },
        'An approved store request could not be carried out',
      );
    }

    await this.tellTheStore(row, true, run.ok, run.outcome);
    const done = await this.prisma.client.storeOrderRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return this.requests.toView(done);
  }

  async reject(
    seller: AuthenticatedSeller,
    requestId: string,
    note: string,
  ): Promise<StoreOrderRequestView> {
    const row = await this.claim(seller, requestId, false, note);

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'seller.store_order_request.rejected',
      entityType: 'store_order_request',
      entityId: requestId,
      severity: 'LOW',
      metadata: { kind: row.kind, orderId: row.orderId, storeId: row.storeId },
    });

    await this.tellTheStore(row, false, false, 'Nothing was done.');
    return this.requests.toView(row);
  }

  /** Carry it out exactly as a DIRECT request would, re-checking first. */
  private async execute(row: StoreOrderRequestRow, ctx: ClientInfoPayload): Promise<Execution> {
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: row.orderId,
        storeId: row.storeId,
        storeKind: SellerStoreKind.RESELLER,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (order === null) {
      return failed('[ORDER_NOT_FOUND] The order no longer exists.');
    }

    switch (row.kind) {
      case StoreOrderRequestKind.CANCEL: {
        try {
          await this.orderWrite.cancelBySeller({
            sellerId: row.sellerId,
            orderId: row.orderId,
            // The STORE asked; seller staff only allowed it. The timeline
            // says who wanted the order called off.
            actor: { type: ActorType.STORE, id: row.requestedByStoreUserId },
            cancellationReason: row.cancellationReason ?? OrderCancellationReason.SELLER_REQUESTED,
            note: row.note ?? 'Cancelled at the reseller store’s request',
            ctx,
          });
          return { ok: true, ref: null, failure: null, outcome: 'The order has been cancelled.' };
        } catch (err) {
          return failed(refusal(err));
        }
      }
      case StoreOrderRequestKind.CALL_CAP_DECISION: {
        const review = await this.prisma.client.earlyReservationReview.findFirst({
          where: { orderId: row.orderId },
          select: { id: true, status: true },
        });
        if (review === null || review.status !== EarlyReservationReviewStatus.OPEN) {
          return failed(
            '[REVIEW_ALREADY_RESOLVED] The call-attempt question on this order had already been answered or closed.',
          );
        }
        if (row.requestedByStoreUserId === null) {
          return failed('[STORE_USER_MISSING] The person who asked is no longer on record.');
        }
        try {
          const result = await this.callCap.decideAsStore(
            row.storeId,
            row.sellerId,
            review.id,
            row.callCapProposal === StoreCallCapProposal.RELEASE
              ? 'RELEASE'
              : 'REQUEST_MORE_ATTEMPTS',
            row.requestedByStoreUserId,
            row.note,
            { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: null },
          );
          const outcome =
            row.callCapProposal === StoreCallCapProposal.RELEASE
              ? 'The held stock has been given back and the order rejected.'
              : result.orderMoved
                ? 'The order is back in the call queue and we will keep trying the customer.'
                : 'The answer is recorded, but the order had already moved on, so calling did not restart.';
          return { ok: true, ref: review.id, failure: null, outcome };
        } catch (err) {
          return failed(refusal(err));
        }
      }
      case StoreOrderRequestKind.RAISE_ISSUE: {
        if (row.requestedByStoreUserId === null) {
          return failed('[STORE_USER_MISSING] The person who asked is no longer on record.');
        }
        try {
          const ticket = await this.tickets.openStoreIssue({
            storeId: row.storeId,
            storeUserId: row.requestedByStoreUserId,
            orderId: row.orderId,
            subject: row.issueSubject ?? 'An issue with this order',
            description: row.note,
          });
          return {
            ok: true,
            ref: ticket.id,
            failure: null,
            outcome: `Your issue has been raised with Skydrop as ticket ${ticket.ticketNumber}.`,
          };
        } catch (err) {
          return failed(refusal(err));
        }
      }
      default: {
        const exhaustive: never = row.kind;
        throw new Error(`Unhandled StoreOrderRequestKind: ${String(exhaustive)}`);
      }
    }
  }

  /** Email the store what was decided and what came of it. Never throws. */
  private async tellTheStore(
    row: StoreOrderRequestRow,
    approved: boolean,
    carriedOut: boolean,
    outcome: string,
  ): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: row.orderId },
      select: { orderNumber: true, seller: { select: { companyName: true } } },
    });
    if (order === null) return;
    await this.notifier.decided({
      storeId: row.storeId,
      requestId: row.id,
      approved,
      carriedOut,
      outcome,
      orderId: row.orderId,
      orderNumber: order.orderNumber,
      sellerName: order.seller.companyName,
      label: storeOrderRequestLabel(row),
      decisionNote: row.decisionNote,
    });
  }

  /**
   * Take the decision, or find out somebody else already did. The answer
   * lands in the SELLER columns — never a staff one.
   */
  private async claim(
    seller: AuthenticatedSeller,
    requestId: string,
    approved: boolean,
    note: string | null,
  ): Promise<StoreOrderRequestRow> {
    const trimmed = note?.trim() ?? '';
    const claimed = await this.prisma.client.storeOrderRequest.updateMany({
      where: { id: requestId, ...pendingStoreOrderRequestsWhere(seller.id) },
      data: {
        status: approved ? StoreOrderRequestStatus.APPROVED : StoreOrderRequestStatus.REJECTED,
        decidedBySellerUserId: seller.userId,
        sellerDecidedAt: new Date(),
        decisionNote: trimmed === '' ? null : trimmed,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'STORE_REQUEST_ALREADY_DECIDED',
        message: 'This request is no longer waiting for you',
      });
    }
    return this.prisma.client.storeOrderRequest.findUniqueOrThrow({ where: { id: requestId } });
  }
}

function failed(reason: string): Execution {
  return {
    ok: false,
    ref: null,
    failure: reason,
    outcome: `It could not be carried out: ${reason}`,
  };
}

/** The server's own words for a refusal, `[CODE] message` where it has a code. */
export function refusal(err: unknown): string {
  const body = (err as { response?: unknown })?.response;
  if (typeof body === 'object' && body !== null) {
    const { code, message } = body as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && typeof message === 'string') return `[${code}] ${message}`;
    if (typeof message === 'string') return message;
  }
  return err instanceof Error ? err.message : 'It could not be carried out.';
}
