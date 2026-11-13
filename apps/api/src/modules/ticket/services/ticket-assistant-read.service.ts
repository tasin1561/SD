import { Injectable } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { TicketService, type StoreTicketViewer } from './ticket.service';

/** A ticket as the assistant may describe it: where it stands, and when somebody last answered. */
export interface AssistantTicketSummary {
  readonly ticketNumber: string;
  readonly type: string;
  readonly status: string;
  readonly subject: string;
  readonly orderNumber: string | null;
  readonly shipmentNumber: string | null;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  /** The time of the newest entry on the ticket, by anyone. */
  readonly lastActivityAt: string | null;
  /** The time of the newest entry written by Skydrop staff. */
  readonly lastStaffReplyAt: string | null;
  /** The refund, for a CLIENT whose ticket was settled with one. Never present for a store. */
  readonly resolutionAmountInr?: string | null;
}

/**
 * What the assistant may read about ONE ticket, by its number.
 *
 * Both reads go through `TicketService`'s own scoped methods: the seller's
 * `listForSeller` carries `sellerId` in its `where`, the store's
 * `listForStore` carries the store AND the viewer, so an ASSOCIATE only
 * ever matches the tickets about orders they placed (ASSOC-1). A number
 * that is somebody else's finds nothing — the same `null` as one that does
 * not exist.
 *
 * The STORE projection is built field by field and copies none of the
 * settlement arithmetic: not `figures`, not the claim amount, the payer or
 * the resolution amount. An associate must never read how much the reseller
 * earns, and a store dispute's figures are exactly that by another route.
 */
@Injectable()
export class TicketAssistantReadService {
  constructor(private readonly tickets: TicketService) {}

  async forSeller(sellerId: string, number: string): Promise<AssistantTicketSummary | null> {
    const wanted = number.trim().toLowerCase();
    const rows = await this.tickets.listForSeller(
      sellerId,
      undefined,
      undefined,
      undefined,
      number,
    );
    const hit = rows.find((t) => t.ticketNumber.toLowerCase() === wanted);
    if (hit === undefined) return null;
    const events = await this.tickets.events(hit.id, sellerId);
    return {
      ticketNumber: hit.ticketNumber,
      type: String(hit.ticketType),
      status: String(hit.status),
      subject: hit.subject,
      orderNumber: hit.orderNumber,
      shipmentNumber: hit.shipmentNumber,
      openedAt: hit.createdAt.toISOString(),
      resolvedAt: hit.resolvedAt?.toISOString() ?? null,
      ...lastTimes(events),
      resolutionAmountInr: hit.resolutionAmountInr,
    };
  }

  async forStore(
    storeId: string,
    viewer: StoreTicketViewer,
    number: string,
  ): Promise<AssistantTicketSummary | null> {
    const wanted = number.trim().toLowerCase();
    // Newest first, the store's own page size cap; an older ticket than the
    // newest hundred is not found here and the person is told to open the page.
    const page = await this.tickets.listForStore(storeId, { page: 1, pageSize: 100 }, viewer);
    const hit = page.items.find((t) => t.ticketNumber.toLowerCase() === wanted);
    if (hit === undefined) return null;
    const events = await this.tickets.eventsForStore(storeId, hit.id, viewer);
    return {
      ticketNumber: hit.ticketNumber,
      type: String(hit.ticketType),
      status: String(hit.status),
      subject: hit.subject,
      orderNumber: hit.orderNumber,
      shipmentNumber: null,
      openedAt: hit.createdAt.toISOString(),
      resolvedAt: hit.resolvedAt?.toISOString() ?? null,
      ...lastTimes(events),
    };
  }
}

function lastTimes(events: ReadonlyArray<{ actorType: ActorType; at: Date }>): {
  lastActivityAt: string | null;
  lastStaffReplyAt: string | null;
} {
  let last: Date | null = null;
  let lastStaff: Date | null = null;
  for (const e of events) {
    if (last === null || e.at > last) last = e.at;
    if (e.actorType === ActorType.STAFF && (lastStaff === null || e.at > lastStaff)) {
      lastStaff = e.at;
    }
  }
  return {
    lastActivityAt: last?.toISOString() ?? null,
    lastStaffReplyAt: lastStaff?.toISOString() ?? null,
  };
}
