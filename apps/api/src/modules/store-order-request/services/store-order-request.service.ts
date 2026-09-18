import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  SellerStoreKind,
  StoreAddressChangeStatus,
  StoreCallCapProposal,
  StoreOrderRequestKind,
  StoreOrderRequestStatus,
} from '@skydrop/db';
import type { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StoreRequestNotifier } from './store-request-notifier.service';

/**
 * A reseller store's HELD request for the three capabilities that act
 * before a parcel exists — call the order off, answer the call-cap
 * review, raise an issue with Skydrop (2026-09-17, owner: "if the store
 * can do then will this will be done directly or it requests to the
 * seller and then the seller approve or reject it").
 *
 * This is the primitive: it records the ask and tells seller staff. The
 * ROUTING (OFF / ASK_SELLER / DIRECT) stays at each action site, and the
 * DOING on approval lives in the leaf `store-order-request-decision`
 * module, which calls the same services a DIRECT request calls. It
 * imports nothing order-, ticket- or review-shaped, so each of those
 * modules can import it without a cycle (the R3 rule).
 *
 * ── ONE OPEN REQUEST PER ORDER PER KIND ──────────────────────────────
 * Checked under `AdvisoryLock.STORE_ORDER_REQUEST` inside the insert's
 * transaction — a read-then-write without it lets two clicks both pass.
 * Two open asks to cancel one order are one question asked twice.
 */

export interface StoreOrderRequestView {
  readonly id: string;
  readonly orderId: string;
  readonly kind: StoreOrderRequestKind;
  readonly status: StoreOrderRequestStatus;
  /** What was asked, in words. */
  readonly label: string;
  readonly note: string | null;
  readonly cancellationReason: OrderCancellationReason | null;
  readonly callCapProposal: StoreCallCapProposal | null;
  readonly issueSubject: string | null;
  readonly decisionNote: string | null;
  readonly sellerDecidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionRef: string | null;
  readonly failureReason: string | null;
  readonly expiredAt: string | null;
  readonly createdAt: string;
}

export type StoreOrderRequestRow = Prisma.StoreOrderRequestGetPayload<Record<string, never>>;

/** What was asked, in the words both sides read. */
export function storeOrderRequestLabel(row: {
  kind: StoreOrderRequestKind;
  callCapProposal: StoreCallCapProposal | null;
  issueSubject: string | null;
}): string {
  switch (row.kind) {
    case StoreOrderRequestKind.CANCEL:
      return 'call the order off';
    case StoreOrderRequestKind.CALL_CAP_DECISION:
      return row.callCapProposal === StoreCallCapProposal.RELEASE
        ? 'stop calling the customer, give the stock back and reject the order'
        : 'keep trying to reach the customer';
    case StoreOrderRequestKind.RAISE_ISSUE:
      return `raise an issue with Skydrop — “${row.issueSubject ?? ''}”`;
    default: {
      const exhaustive: never = row.kind;
      throw new Error(`Unhandled StoreOrderRequestKind: ${String(exhaustive)}`);
    }
  }
}

/** Statuses in which a request is still open (answered or not, not finished). */
export const OPEN_STORE_ORDER_REQUEST_STATUSES: readonly StoreOrderRequestStatus[] = [
  StoreOrderRequestStatus.PENDING,
  StoreOrderRequestStatus.APPROVED,
];

export interface HoldInput {
  readonly storeId: string;
  readonly storeUserId: string | null;
  readonly orderId: string;
  readonly kind: StoreOrderRequestKind;
  readonly note: string | null;
  readonly cancellationReason?: OrderCancellationReason;
  readonly callCapProposal?: StoreCallCapProposal;
  readonly issueSubject?: string;
}

@Injectable()
export class StoreOrderRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifier: StoreRequestNotifier,
  ) {}

  async hold(input: HoldInput): Promise<StoreOrderRequestView> {
    const note = input.note?.trim() ?? '';
    if (input.kind !== StoreOrderRequestKind.RAISE_ISSUE && note === '') {
      // Seller staff read this before deciding; an unexplained ask to
      // cancel or give up on an order is unanswerable.
      throw new BadRequestException({
        code: 'STORE_REQUEST_REASON_REQUIRED',
        message: 'Seller staff approve this for your store, so tell them why.',
      });
    }
    if (input.kind === StoreOrderRequestKind.CALL_CAP_DECISION && !input.callCapProposal) {
      throw new BadRequestException({
        code: 'STORE_REQUEST_INCOMPLETE',
        message: 'Say whether to keep trying or to give up.',
      });
    }
    if (input.kind === StoreOrderRequestKind.RAISE_ISSUE && !input.issueSubject?.trim()) {
      throw new BadRequestException({
        code: 'STORE_REQUEST_INCOMPLETE',
        message: 'Say what the issue is.',
      });
    }

    const order = await this.ownOrder(input.storeId, input.orderId);

    const row = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(
        tx,
        AdvisoryLock.STORE_ORDER_REQUEST,
        `${input.orderId}|${input.kind}`,
      );
      const open = await tx.storeOrderRequest.findFirst({
        where: {
          orderId: input.orderId,
          kind: input.kind,
          status: { in: [...OPEN_STORE_ORDER_REQUEST_STATUSES] },
        },
        select: { id: true },
      });
      if (open !== null) {
        throw new ConflictException({
          code: 'STORE_REQUEST_ALREADY_OPEN',
          message:
            'You have already sent this to seller staff for this order. They have to answer that one first.',
        });
      }
      return tx.storeOrderRequest.create({
        data: {
          orderId: input.orderId,
          sellerId: order.sellerId,
          storeId: input.storeId,
          requestedByStoreUserId: input.storeUserId,
          kind: input.kind,
          note: note === '' ? null : note,
          cancellationReason: input.cancellationReason ?? null,
          callCapProposal: input.callCapProposal ?? null,
          issueSubject: input.issueSubject?.trim() ?? null,
        },
      });
    });

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: input.storeUserId,
      sellerId: order.sellerId,
      action: 'store.order_request.requested',
      entityType: 'store_order_request',
      entityId: row.id,
      severity: 'LOW',
      metadata: { orderId: input.orderId, storeId: input.storeId, kind: input.kind },
    });

    await this.notifier.waitingOnSeller({
      sellerId: order.sellerId,
      requestId: row.id,
      storeName: order.storeName,
      orderId: input.orderId,
      orderNumber: order.orderNumber,
      label: storeOrderRequestLabel(row),
      said: row.note ?? null,
    });

    return this.toView(row);
  }

  /**
   * Seller staff corrected the recipient on a reseller store's order
   * themselves (2026-09-17, owner decision b), so an address correction
   * the store had waiting on them is closed as SUPERSEDED — two
   * corrections to one address cannot both stand, and applying the
   * store's later would silently undo the seller's.
   *
   * Called INSIDE the edit's transaction, so the edit and the closing are
   * one fact. A guarded `updateMany` on PENDING: a correction seller staff
   * are approving at the same moment wins or loses cleanly. Returns how
   * many it closed, for the email to the store.
   */
  async supersedeAddressChanges(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerUserId: string | null,
  ): Promise<number> {
    const closed = await tx.storeAddressChangeRequest.updateMany({
      where: { orderId, status: StoreAddressChangeStatus.PENDING },
      data: {
        status: StoreAddressChangeStatus.SUPERSEDED,
        decidedBySellerUserId: sellerUserId,
        sellerDecidedAt: new Date(),
        // Whoever it was, said in one sentence the store can read: the
        // seller-user column is null on a store's own edit, so the note
        // cannot be derived from it.
        decisionNote:
          sellerUserId === null
            ? 'Closed because the order was changed directly.'
            : 'Seller staff changed the order themselves.',
      },
    });
    return closed.count;
  }

  /** Everything this store has sent seller staff about one of its orders. */
  async listForStoreOrder(
    storeId: string,
    orderId: string,
  ): Promise<readonly StoreOrderRequestView[]> {
    await this.ownOrder(storeId, orderId);
    const rows = await this.prisma.client.storeOrderRequest.findMany({
      where: { orderId, storeId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toView(r));
  }

  toView(r: StoreOrderRequestRow): StoreOrderRequestView {
    return {
      id: r.id,
      orderId: r.orderId,
      kind: r.kind,
      status: r.status,
      label: storeOrderRequestLabel(r),
      note: r.note,
      cancellationReason: r.cancellationReason,
      callCapProposal: r.callCapProposal,
      issueSubject: r.issueSubject,
      decisionNote: r.decisionNote,
      sellerDecidedAt: r.sellerDecidedAt?.toISOString() ?? null,
      executedAt: r.executedAt?.toISOString() ?? null,
      executionRef: r.executionRef,
      failureReason: r.failureReason,
      expiredAt: r.expiredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** This store's own reseller order, or a 404 that says nothing more. */
  private async ownOrder(
    storeId: string,
    orderId: string,
  ): Promise<{ sellerId: string; orderNumber: string; storeName: string }> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, storeId, storeKind: SellerStoreKind.RESELLER, deletedAt: null },
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
}
