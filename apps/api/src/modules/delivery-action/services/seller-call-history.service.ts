import { Injectable, NotFoundException } from '@nestjs/common';
import { CallOutcome } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface SellerVisibleCall {
  readonly id: string;
  readonly calledAt: string;
  readonly outcome: CallOutcome;
  /** What the agent typed. Free text — see the projection note below. */
  readonly notes: string | null;
  /** What the customer corrected, when they did. */
  readonly customerSaidName: string | null;
  readonly customerSaidAddress: string | null;
  readonly rescheduledFor: string | null;
}

/**
 * What we said to the seller's customer, shown to the seller.
 *
 * A seller deciding whether to pay for another delivery attempt is
 * deciding blind without this. "No answer, twice" and "customer says
 * they moved house last month" lead to opposite decisions, and only one
 * of them is worth a van.
 *
 * ── WHAT IS DELIBERATELY LEFT OUT ────────────────────────────────────
 * The AGENT. Not their name, not their id. The seller is entitled to
 * know what was said to their customer; they are not entitled to a named
 * member of our staff to complain about, and a support conversation that
 * turns into "which agent was it" helps nobody. Also out: the queue
 * entry, the internal attempt count, the phone number we dialled — the
 * seller already has their own customer's number, and ours is a record
 * of our work rather than theirs.
 *
 * Notes ARE included, in full, and that is a deliberate choice made
 * knowing they are free text an agent typed under time pressure. The
 * alternative — outcomes only — reduces every call to one of nine words
 * and throws away the one sentence that actually explains the failure.
 * Agents should write them knowing the seller reads them.
 */
@Injectable()
export class SellerCallHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(sellerId: string, orderId: string): Promise<{ items: SellerVisibleCall[] }> {
    const order = await this.prisma.client.order.findFirst({
      // Scoped to the seller, so another seller's order is
      // indistinguishable from one that does not exist.
      where: { id: orderId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'No such order' });
    }

    const rows = await this.prisma.client.callAttempt.findMany({
      where: { orderId },
      orderBy: { startedAt: 'desc' },
      // Explicit select rather than an exclusion: a column added to
      // call_attempts later must not become seller-visible by default.
      select: {
        id: true,
        startedAt: true,
        outcome: true,
        outcomeNotes: true,
        customerSaidName: true,
        customerSaidAddress: true,
        rescheduledFor: true,
      },
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        calledAt: r.startedAt.toISOString(),
        outcome: r.outcome,
        notes: r.outcomeNotes,
        customerSaidName: r.customerSaidName,
        customerSaidAddress: r.customerSaidAddress,
        rescheduledFor: r.rescheduledFor?.toISOString() ?? null,
      })),
    };
  }
}
