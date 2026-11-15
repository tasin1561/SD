import { Injectable } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CANCEL_REQUEST_CATEGORY,
  CANCEL_REQUEST_OPEN_TICKET_STATUSES,
  isCancelRequestEligible,
  type CancelRequestView,
} from './cancel-request.rules';

/**
 * The read half of the cancel request: is the button on offer for this order,
 * and is a cancel ticket already open. An R3 primitive (imports nothing
 * order- or ticket-shaped) so the order reads and the ticket module can both
 * use it without a cycle. Writes nothing.
 */
@Injectable()
export class CancelRequestReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** The open cancel ticket of one order, or null. */
  async openTicketFor(
    orderId: string,
    client?: Prisma.TransactionClient,
  ): Promise<{ id: string; number: string } | null> {
    const row = await (client ?? this.prisma.client).ticket.findFirst({
      where: {
        orderId,
        issueCategoryExternalId: CANCEL_REQUEST_CATEGORY,
        status: { in: [...CANCEL_REQUEST_OPEN_TICKET_STATUSES] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, ticketNumber: true },
    });
    return row === null ? null : { id: row.id, number: row.ticketNumber };
  }

  /**
   * `allowed` is the caller's own gate (a member store whose cancel policy
   * is OFF passes false). It only ever narrows; eligibility is the status.
   */
  async viewFor(
    order: { readonly id: string; readonly status: OrderStatus },
    allowed = true,
  ): Promise<CancelRequestView> {
    if (!allowed || !isCancelRequestEligible(order.status)) {
      return { available: false, openTicket: null };
    }
    return { available: true, openTicket: await this.openTicketFor(order.id) };
  }
}
