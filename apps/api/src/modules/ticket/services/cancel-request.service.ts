import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  ResellerStoreActionMode,
  SellerStoreKind,
  type StoreOrderScope,
  TicketType,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { storeOrderOwnerFilter } from '../../../common/auth/store-order-scope';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CANCEL_REQUEST_CATEGORY,
  CANCEL_REQUEST_OPEN_TICKET_STATUSES,
  CANCEL_REQUEST_REASON,
  isCancelRequestEligible,
} from '../../cancel-request/cancel-request.rules';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import { TicketService } from './ticket.service';

export interface CancelRequestResult {
  /** False when an open cancel ticket already existed and is returned as-is. */
  readonly created: boolean;
  readonly ticket: { readonly id: string; readonly number: string };
}

export type CancelRequestRaiser =
  | { readonly kind: 'SELLER'; readonly sellerId: string; readonly sellerUserId: string }
  | {
      readonly kind: 'STORE';
      readonly storeId: string;
      readonly storeUserId: string;
      readonly orderScope: StoreOrderScope;
    };

/**
 * 2026-11-15 (owner) — past the direct-cancel window the cancel button
 * does not vanish: it asks Skydrop, through the ordinary ticket path, in
 * the "Cancel order / delivery / pickup" category with the reason
 * "Shipment has been returned by merchant".
 *
 * Exactly once while open: an advisory lock on the order, then "is one
 * open?" and the insert in the SAME transaction. A second request returns
 * the existing ticket (`created: false`) rather than a duplicate; once the
 * ticket is closed a new one may be raised.
 */
@Injectable()
export class CancelRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly policies: ResellerStoreActionPolicyService,
  ) {}

  async raise(
    raiser: CancelRequestRaiser,
    orderId: string,
    note: string | null,
  ): Promise<CancelRequestResult> {
    // Ownership first, in the WHERE clause: another tenant's order is a 404.
    const order = await this.prisma.client.order.findFirst({
      where:
        raiser.kind === 'SELLER'
          ? { id: orderId, sellerId: raiser.sellerId, deletedAt: null }
          : {
              id: orderId,
              storeId: raiser.storeId,
              storeKind: SellerStoreKind.RESELLER,
              deletedAt: null,
              ...storeOrderOwnerFilter({
                scope: raiser.orderScope,
                storeUserId: raiser.storeUserId,
              }),
            },
      select: { id: true, sellerId: true, orderNumber: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    if (raiser.kind === 'STORE') {
      const policy = await this.policies.forStore(raiser.storeId);
      if (policy.cancel === ResellerStoreActionMode.OFF) {
        throw new ForbiddenException({
          code: 'STORE_ACTION_NOT_ALLOWED',
          message:
            'The client has not enabled cancelling for this store. Ask them to call the order off.',
        });
      }
    }

    const description = [CANCEL_REQUEST_REASON, note?.trim() || null].filter(Boolean).join('\n\n');

    return this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.CANCEL_REQUEST, order.id);

      const existing = await tx.ticket.findFirst({
        where: {
          orderId: order.id,
          issueCategoryExternalId: CANCEL_REQUEST_CATEGORY,
          status: { in: [...CANCEL_REQUEST_OPEN_TICKET_STATUSES] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, ticketNumber: true },
      });
      if (existing !== null) {
        return { created: false, ticket: { id: existing.id, number: existing.ticketNumber } };
      }

      const fresh = await tx.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });
      if (fresh === null || !isCancelRequestEligible(fresh.status)) {
        throw new ConflictException({
          code: 'CANCEL_REQUEST_NOT_AVAILABLE',
          message:
            'This order is not at a stage where a cancel request applies. If it has not been packed you can cancel it directly.',
        });
      }

      const opened = await this.tickets.openOrFind(
        {
          ticketType:
            raiser.kind === 'SELLER' ? TicketType.SELLER_RAISED_ISSUE : TicketType.STORE_ISSUE,
          sellerId: order.sellerId,
          subject: `Cancel order ${order.orderNumber}`,
          description,
          orderId: order.id,
          issueCategoryExternalId: CANCEL_REQUEST_CATEGORY,
          ...(raiser.kind === 'STORE'
            ? { storeId: raiser.storeId, openedByStoreUserId: raiser.storeUserId }
            : {}),
        },
        raiser.kind === 'SELLER'
          ? { type: ActorType.SELLER, sellerUserId: raiser.sellerUserId }
          : { type: ActorType.STORE, storeUserId: raiser.storeUserId },
        tx,
      );
      return {
        created: opened.created,
        ticket: { id: opened.ticket.id, number: opened.ticket.ticketNumber },
      };
    });
  }
}
