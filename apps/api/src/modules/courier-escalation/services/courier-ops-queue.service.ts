import { Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, CourierOutboxKind, CourierOutboxStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierOutboxService } from './courier-outbox.service';

export interface OpsQueueItem {
  readonly id: string;
  /** Which conversation this belongs to — lets a ticket show its own. */
  readonly escalationId: string;
  readonly kind: CourierOutboxKind;
  readonly status: CourierOutboxStatus;
  /** The exact text to paste. Never edited, never summarised. */
  readonly body: string;
  readonly categoryId: string | null;
  readonly awbNumber: string | null;
  readonly externalTicketId: string | null;
  readonly orderId: string | null;
  readonly sellerId: string | null;
  readonly sellerName: string | null;
  /** Where to go and do it — the whole point of a 20-second item. */
  readonly deepLink: string;
  readonly claimedByStaffId: string | null;
  readonly claimExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly lastError: string | null;
}

export interface OpsQueueCounts {
  readonly pending: number;
  readonly sending: number;
  readonly sentUnconfirmed: number;
  readonly confirmedToday: number;
  readonly failedToday: number;
}

/**
 * What a human needs to clear one item in about twenty seconds.
 *
 * ── THE DEEP LINK IS THE FEATURE ─────────────────────────────────────
 * An ops queue that tells you a message exists but not where to put it
 * makes the operator do the lookup, which is most of the twenty seconds.
 * An existing ticket links straight to its thread; a new one links to the
 * order page, because that is where a ticket gets raised from.
 *
 * TODO(delhivery-api): the support deep-link path is
 * `one.delhivery.com/support/<ticketId>` per the brief and has not been
 * opened against a real ticket id. If it 404s, this is the one line to
 * change.
 */
@Injectable()
export class CourierOpsQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: CourierOutboxService,
  ) {}

  private deepLink(externalTicketId: string | null, orderId: string | null): string {
    if (externalTicketId !== null && externalTicketId !== '') {
      return `https://one.delhivery.com/support/${encodeURIComponent(externalTicketId)}`;
    }
    // No courier ticket yet: send them where one is raised FROM.
    return orderId === null ? 'https://one.delhivery.com/support' : `/orders/${orderId}`;
  }

  async list(input: { status?: CourierOutboxStatus; limit?: number }): Promise<OpsQueueItem[]> {
    const rows = await this.prisma.client.courierOutboxItem.findMany({
      where: {
        status: input.status ?? {
          // The working set: things a human can act on or must chase.
          in: [
            CourierOutboxStatus.PENDING,
            CourierOutboxStatus.SENDING,
            CourierOutboxStatus.SENT_UNCONFIRMED,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(input.limit ?? 50, 200),
      select: {
        id: true,
        escalationId: true,
        kind: true,
        status: true,
        body: true,
        categoryId: true,
        claimedByStaffId: true,
        claimExpiresAt: true,
        createdAt: true,
        lastError: true,
        externalRef: true,
        escalation: {
          select: {
            awbNumber: true,
            externalTicketId: true,
            ticket: {
              select: { orderId: true, sellerId: true, seller: { select: { companyName: true } } },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      escalationId: r.escalationId,
      kind: r.kind,
      status: r.status,
      body: r.body,
      categoryId: r.categoryId,
      awbNumber: r.escalation.awbNumber,
      externalTicketId: r.externalRef ?? r.escalation.externalTicketId,
      orderId: r.escalation.ticket.orderId,
      sellerId: r.escalation.ticket.sellerId,
      sellerName: r.escalation.ticket.seller?.companyName ?? null,
      deepLink: this.deepLink(
        r.externalRef ?? r.escalation.externalTicketId,
        r.escalation.ticket.orderId,
      ),
      claimedByStaffId: r.claimedByStaffId,
      claimExpiresAt: r.claimExpiresAt,
      createdAt: r.createdAt,
      lastError: r.lastError,
    }));
  }

  async counts(): Promise<OpsQueueCounts> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [pending, sending, sentUnconfirmed, confirmedToday, failedToday] = await Promise.all([
      this.prisma.client.courierOutboxItem.count({
        where: { status: CourierOutboxStatus.PENDING },
      }),
      this.prisma.client.courierOutboxItem.count({
        where: { status: CourierOutboxStatus.SENDING },
      }),
      this.prisma.client.courierOutboxItem.count({
        where: { status: CourierOutboxStatus.SENT_UNCONFIRMED },
      }),
      this.prisma.client.courierOutboxItem.count({
        where: { status: CourierOutboxStatus.CONFIRMED, confirmedAt: { gte: startOfDay } },
      }),
      this.prisma.client.courierOutboxItem.count({
        where: { status: CourierOutboxStatus.FAILED, updatedAt: { gte: startOfDay } },
      }),
    ]);
    return { pending, sending, sentUnconfirmed, confirmedToday, failedToday };
  }

  async claim(itemId: string, staffId: string): Promise<OpsQueueItem> {
    // Throws OUTBOX_ITEM_NOT_CLAIMABLE if someone else holds the lease.
    await this.outbox.claimForStaff(itemId, staffId);
    const mine = (await this.list({ status: CourierOutboxStatus.SENDING, limit: 200 })).find(
      (i) => i.id === itemId,
    );
    if (mine === undefined) {
      throw new NotFoundException({
        code: 'OUTBOX_ITEM_NOT_FOUND',
        message: 'The item was claimed but could not be read back.',
      });
    }
    return mine;
  }

  /**
   * "Mark sent" — sets SENT_UNCONFIRMED, never CONFIRMED.
   *
   * A human asserting they pasted something is not evidence it landed:
   * the tab may have failed, the paste may have gone to the wrong ticket.
   * The tick comes from a read-back and nowhere else. If they paste no
   * ticket id, the reconciler returns the item to the queue.
   */
  async markSent(input: {
    itemId: string;
    staffId: string;
    externalTicketId?: string | null;
  }): Promise<void> {
    await this.outbox.markSentUnconfirmed({
      itemId: input.itemId,
      actorType: ActorType.STAFF,
      staffId: input.staffId,
      externalRef: input.externalTicketId ?? null,
    });

    // Binding a newly created ticket id onto the escalation is what makes
    // the READ pipeline able to thread its replies — without it, every
    // reply comes back NO_ESCALATION.
    const ref = (input.externalTicketId ?? '').trim();
    if (ref !== '') {
      const item = await this.prisma.client.courierOutboxItem.findUnique({
        where: { id: input.itemId },
        select: { escalationId: true, escalation: { select: { externalTicketId: true } } },
      });
      if (item !== null && (item.escalation.externalTicketId ?? '') === '') {
        await this.prisma.client.courierEscalation.update({
          where: { id: item.escalationId },
          data: { externalTicketId: ref },
        });
      }
    }
  }

  /** A human giving the item back rather than holding a dead lease. */
  async release(itemId: string, staffId: string): Promise<void> {
    await this.outbox.release(itemId, `Released by staff ${staffId}`);
  }
}
