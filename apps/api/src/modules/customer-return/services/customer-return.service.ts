import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType, OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

export interface RequestReturnInput {
  readonly orderId: string;
  /** Null for staff — the seller id scopes a seller's own request. */
  readonly sellerId: string | null;
  readonly reason: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
}

export interface ReturnRequestResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly alreadyRequested: boolean;
}

/**
 * A return the CUSTOMER asked for.
 *
 * ── HOW THIS DIFFERS FROM RTO, AND WHERE IT DOES NOT ─────────────────
 * RTO is the courier failing to deliver and bringing the parcel back;
 * the order never left the customer's doorstep. This starts from
 * DELIVERED: the goods are with the customer and are coming back on
 * purpose.
 *
 * From the WAREHOUSE's side those are the same event — a parcel arrives
 * that has to be inspected, restocked or written off — so this
 * deliberately rejoins the existing RTO path at RTO_INITIATED and is
 * received by `RtoReceiptService` like any other return. Building a
 * parallel receipt flow would mean two ways to take goods back in, and
 * the one used less often is the one that rots.
 *
 * From the MONEY side they are not the same at all, which is why the
 * order carries `customerReturnRequestedAt`: the parcel travelled the
 * whole distance twice, so the seller pays a second delivery (₹200)
 * rather than the smaller fee an undelivered parcel carries (₹30). The
 * fee is taken at RECEIPT, not here — a request is not a return, and a
 * customer who never hands the parcel over has cost us nothing.
 */
@Injectable()
export class CustomerReturnService {
  private readonly logger = new Logger(CustomerReturnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderWrite: OrderWriteService,
    private readonly audit: AuditLogService,
  ) {}

  async request(input: RequestReturnInput): Promise<ReturnRequestResult> {
    const reason = input.reason.trim();
    if (reason.length < 5) {
      throw new BadRequestException({
        code: 'RETURN_REASON_REQUIRED',
        message: 'Say why it is coming back — the warehouse reads this when it arrives.',
      });
    }

    const order = await this.prisma.client.order.findFirst({
      where: {
        id: input.orderId,
        deletedAt: null,
        ...(input.sellerId === null ? {} : { sellerId: input.sellerId }),
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        sellerId: true,
        customerReturnRequestedAt: true,
      },
    });
    if (order === null) {
      throw new BadRequestException({
        code: 'ORDER_NOT_FOUND',
        message: 'No order found with that reference.',
      });
    }

    // Idempotent: asking twice is a double-click or a retry, not a
    // second return. The first request stands, with its reason.
    if (order.customerReturnRequestedAt !== null) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        alreadyRequested: true,
      };
    }

    if (order.status !== OrderStatus.DELIVERED) {
      throw new ConflictException({
        code: 'ORDER_NOT_RETURNABLE',
        // Named states rather than a generic refusal: a seller looking
        // at a parcel still in transit wants to be told to wait, not
        // that something went wrong.
        message: `Only a delivered order can be returned — this one is ${order.status}. A parcel still on its way comes back as an RTO if it cannot be delivered.`,
      });
    }

    // The MARK first, then the transition — the visible-vs-silent
    // ordering. A crash between leaves an order flagged as
    // return-requested but still DELIVERED, which reads correctly as
    // "asked for, not yet moving" and converges on a retry. The reverse
    // would leave an order in RTO_INITIATED that nobody can explain and
    // that would be priced as a courier RTO.
    await this.prisma.client.order.update({
      where: { id: order.id },
      data: { customerReturnRequestedAt: new Date(), customerReturnReason: reason },
    });

    const result = await this.orderWrite.transitionStatus({
      orderId: order.id,
      to: OrderStatus.RTO_INITIATED,
      actor: { type: input.actorType, id: input.actorId },
      // Guards against a concurrent transition between the read above
      // and this write — a parcel that started coming back on its own
      // must not be re-labelled as a customer return.
      expectedFrom: OrderStatus.DELIVERED,
      reason: `Customer return requested: ${reason}`,
    });

    await this.audit.log({
      actorType: input.actorType,
      actorId: input.actorId,
      action: 'order.customer_return.requested',
      entityType: 'order',
      entityId: order.id,
      // The seller is choosing to pay a second delivery, and the goods
      // are coming back into stock — worth finding later without
      // knowing what to search for.
      severity: 'MEDIUM',
      metadata: { orderNumber: order.orderNumber, reason, sellerId: order.sellerId },
    });

    this.logger.log(
      { orderId: order.id, orderNumber: order.orderNumber },
      'Customer return requested — the parcel rejoins the RTO path home',
    );

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: result.status,
      alreadyRequested: false,
    };
  }
}
