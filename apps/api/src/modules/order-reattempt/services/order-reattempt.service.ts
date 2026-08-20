import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, Prisma, ReattemptRequestStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';

/** The only status a re-attempt may be requested from. */
const REQUESTABLE_FROM: OrderStatus[] = [OrderStatus.REJECTED_BY_CUSTOMER];

export interface ReattemptRequestView {
  id: string;
  orderId: string;
  orderNumber: string | null;
  sellerId: string;
  reason: string;
  status: ReattemptRequestStatus;
  decisionNote: string | null;
  decidedAt: Date | null;
  orderStatusAtRequest: string;
  createdAt: Date;
}

/**
 * A seller asking for one more call on an order the customer refused.
 *
 * `REJECTED_BY_CUSTOMER` is terminal because the customer said no. This
 * is the ONE path out of it, and it is deliberately a request rather
 * than a right: a seller who could requeue a refusal unaided is a seller
 * who can have somebody rung repeatedly after they declined, which in a
 * COD market costs the customer rather than just the parcel.
 *
 * Contrast R5b's `AWAITING_SELLER_DECISION`, where the seller decides
 * alone — nobody there ever answered the phone, so there is no refusal
 * to override.
 */
@Injectable()
export class OrderReattemptService {
  private readonly logger = new Logger(OrderReattemptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orders: OrderReadService,
    private readonly orderWrites: OrderWriteService,
  ) {}

  async request(input: {
    sellerId: string;
    orderId: string;
    reason: string;
    sellerUserId: string | null;
  }): Promise<ReattemptRequestView> {
    const order = await this.orders.getById(input.orderId);
    if (!order || order.sellerId !== input.sellerId) {
      // Same 404 for "not yours" as for "does not exist" — telling a
      // seller an order id is real but somebody else's is a disclosure.
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }
    if (!REQUESTABLE_FROM.includes(order.status)) {
      throw new ConflictException({
        code: 'NOT_REQUESTABLE',
        message: `An order in ${order.status} does not need a re-attempt request`,
      });
    }

    try {
      const row = await this.prisma.client.orderReattemptRequest.create({
        data: {
          orderId: order.orderId,
          sellerId: input.sellerId,
          requestedById: input.sellerUserId,
          reason: input.reason,
          orderStatusAtRequest: order.status,
        },
      });
      await this.audit.log({
        actorType: ActorType.SELLER,
        actorId: input.sellerUserId,
        sellerId: input.sellerId,
        action: 'order.reattempt_requested',
        entityType: 'order',
        entityId: order.orderId,
        severity: 'LOW',
        metadata: { requestId: row.id, orderNumber: order.orderNumber, reason: input.reason },
      });
      return this.toView(row, order.orderNumber);
    } catch (e) {
      // The partial unique is the guard, not a prior lookup: a
      // read-then-write under READ COMMITTED lets two clicks both see
      // "no open request" and both insert.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'REQUEST_ALREADY_OPEN',
          message: 'A re-attempt request for this order is already waiting for a decision',
        });
      }
      throw e;
    }
  }

  /**
   * Approve, and put the order back in the call queue.
   *
   * Ordering: CLAIM the request first — that is the concurrency guard,
   * and without it two admins clicking approve both read PENDING and
   * both transition. If the transition then fails, the claim is ROLLED
   * BACK to PENDING (the M5 saga's compensating-release shape), because
   * a request reading APPROVED over an order still sitting rejected is
   * the silent failure: nobody would ever look again.
   */
  async approve(
    requestId: string,
    staffId: string,
    note: string | null,
  ): Promise<ReattemptRequestView> {
    const row = await this.requirePending(requestId);

    const claimed = await this.prisma.client.orderReattemptRequest.updateMany({
      where: { id: requestId, status: ReattemptRequestStatus.PENDING },
      data: {
        status: ReattemptRequestStatus.APPROVED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'REQUEST_ALREADY_DECIDED',
        message: 'Another admin decided this request first',
      });
    }

    try {
      await this.orderWrites.transitionStatus({
        orderId: row.orderId,
        to: OrderStatus.PENDING_CONFIRMATION,
        actor: { type: ActorType.STAFF, id: staffId },
        // Guarded: refuse if the order moved since the request was
        // raised — a god-mode edit or a later transition means the
        // decision was made about a different situation.
        expectedFrom: OrderStatus.REJECTED_BY_CUSTOMER,
        reason: `Re-attempt approved: ${note ?? 'no note'}`,
      });
    } catch (e) {
      // Compensate. The order did not move, so the request must not read
      // as though it had.
      await this.prisma.client.orderReattemptRequest.updateMany({
        where: { id: requestId, status: ReattemptRequestStatus.APPROVED },
        data: {
          status: ReattemptRequestStatus.PENDING,
          decidedById: null,
          decidedAt: null,
          decisionNote: null,
        },
      });
      this.logger.error(
        { requestId, orderId: row.orderId, err: (e as Error).message },
        'Re-attempt approval rolled back: the order could not be returned to the call queue',
      );
      throw e;
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      sellerId: row.sellerId,
      action: 'order.reattempt_approved',
      entityType: 'order',
      entityId: row.orderId,
      // MEDIUM: this rings a customer who already said no.
      severity: 'MEDIUM',
      metadata: { requestId, reason: row.reason, decisionNote: note },
    });

    return this.toView(
      {
        ...row,
        status: ReattemptRequestStatus.APPROVED,
        decisionNote: note,
        decidedAt: new Date(),
      },
      null,
    );
  }

  async reject(
    requestId: string,
    staffId: string,
    note: string | null,
  ): Promise<ReattemptRequestView> {
    const row = await this.requirePending(requestId);
    const claimed = await this.prisma.client.orderReattemptRequest.updateMany({
      where: { id: requestId, status: ReattemptRequestStatus.PENDING },
      data: {
        status: ReattemptRequestStatus.REJECTED,
        decidedById: staffId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'REQUEST_ALREADY_DECIDED',
        message: 'Another admin decided this request first',
      });
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      sellerId: row.sellerId,
      action: 'order.reattempt_rejected',
      entityType: 'order',
      entityId: row.orderId,
      severity: 'LOW',
      metadata: { requestId, reason: row.reason, decisionNote: note },
    });
    return this.toView(
      {
        ...row,
        status: ReattemptRequestStatus.REJECTED,
        decisionNote: note,
        decidedAt: new Date(),
      },
      null,
    );
  }

  async listForSeller(sellerId: string, orderId?: string): Promise<ReattemptRequestView[]> {
    const rows = await this.prisma.client.orderReattemptRequest.findMany({
      where: { sellerId, ...(orderId === undefined ? {} : { orderId }) },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { orderNumber: true } } },
    });
    return rows.map((r) => this.toView(r, r.order.orderNumber));
  }

  async listForAdmin(status?: ReattemptRequestStatus): Promise<ReattemptRequestView[]> {
    const rows = await this.prisma.client.orderReattemptRequest.findMany({
      where: status === undefined ? {} : { status },
      orderBy: { createdAt: 'asc' },
      include: { order: { select: { orderNumber: true } } },
      take: 200,
    });
    return rows.map((r) => this.toView(r, r.order.orderNumber));
  }

  private async requirePending(requestId: string) {
    const row = await this.prisma.client.orderReattemptRequest.findUnique({
      where: { id: requestId },
    });
    if (!row) throw new NotFoundException(`Re-attempt request ${requestId} not found`);
    if (row.status !== ReattemptRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'REQUEST_ALREADY_DECIDED',
        message: `Request is already ${row.status}`,
      });
    }
    return row;
  }

  private toView(
    row: {
      id: string;
      orderId: string;
      sellerId: string;
      reason: string;
      status: ReattemptRequestStatus;
      decisionNote: string | null;
      decidedAt: Date | null;
      orderStatusAtRequest: string;
      createdAt: Date;
    },
    orderNumber: string | null,
  ): ReattemptRequestView {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber,
      sellerId: row.sellerId,
      reason: row.reason,
      status: row.status,
      decisionNote: row.decisionNote,
      decidedAt: row.decidedAt,
      orderStatusAtRequest: row.orderStatusAtRequest,
      createdAt: row.createdAt,
    };
  }
}
