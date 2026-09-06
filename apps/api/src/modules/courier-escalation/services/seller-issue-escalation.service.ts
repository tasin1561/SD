import { Injectable, Logger } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { CourierEscalationService } from './courier-escalation.service';

/**
 * A seller's issue, put to the courier.
 *
 * ── THE LINK THAT WAS NEVER THERE ────────────────────────────────────
 * Every piece of this pipeline existed — the escalation, the outbox, the
 * portal that drives Delhivery's own "Raise a ticket" modal — and
 * nothing connected a SELLER raising an issue to any of it. The NDR
 * poller escalated, and a delivery action escalated, and the one person
 * with a problem to report did not. Their ticket sat on our board until
 * somebody happened to read it and retyped it into Delhivery's portal by
 * hand.
 *
 * ── WHY IT GOES STRAIGHT THROUGH, WITH NO OPERATOR ───────────────────
 * CUR-10 forbids a customer-facing handler from firing a courier write,
 * with one narrow widening for a seller cancelling their own parcel.
 * This is the second, and it needs the same argument to hold: whose
 * goods, whose money, and what an operator would add.
 *
 * It is the seller's parcel. Raising a support ticket spends nothing —
 * it dispatches no van and moves no stock; it ASKS A QUESTION, which is
 * the whole difference from a re-attempt (CUR-10 amendment #2 kept that
 * one behind an operator for exactly this reason). And an operator in
 * the loop would forward the seller's words verbatim, hours later, to
 * the same place. The parcel keeps moving the whole time.
 *
 * What does NOT change: the write still passes the portal's own gate.
 * `portalMode` is SHADOW by default and the dispatcher executes nothing
 * until somebody sets it LIVE, so enabling this cannot by itself put a
 * word in front of Delhivery.
 *
 * ── BEST-EFFORT, ALWAYS ──────────────────────────────────────────────
 * The ticket is the durable fact and it has already committed. A courier
 * conversation that could not be opened must never un-raise a seller's
 * issue — they would be told their report failed when we are holding it.
 * So every failure here is caught and put on the board instead, where
 * somebody can carry it by hand.
 */
@Injectable()
export class SellerIssueEscalationService {
  private readonly logger = new Logger(SellerIssueEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalations: CourierEscalationService,
    private readonly issues: SystemIssueService,
  ) {}

  /**
   * Take a freshly-raised seller ticket to the courier.
   *
   * POST-COMMIT and never awaited by the caller's transaction: the
   * escalation and the outbox own their own writes (the M5 saga rule),
   * and a slow portal must not hold a seller's browser.
   */
  async escalate(input: {
    ticketId: string;
    sellerId: string;
    description: string | null;
  }): Promise<void> {
    try {
      const awbNumber = await this.resolveAwb(input.ticketId);
      if (awbNumber === null) {
        /*
          NO AWB, NO TICKET — and this is a decision, not a gap.

          Delhivery's own modal is reached FROM an order and stamps the
          waybill into it ("Orders Involved: 38061110537176"). Without
          one there is nothing to raise a ticket ABOUT, and their support
          desk would be reading a paragraph with no parcel attached.

          An issue raised before dispatch is the ordinary case for this —
          the seller is asking US something, and the ticket already
          reached us. Silent by design: putting it on the board would
          flag the normal path as a fault.
        */
        this.logger.debug(
          { ticketId: input.ticketId },
          'Seller ticket has no waybill yet; nothing to raise with the courier',
        );
        return;
      }

      const escalation = await this.escalations.openForTicket({
        ticketId: input.ticketId,
        awbNumber,
      });

      const body = (input.description ?? '').trim();
      if (body === '') return;

      // The seller's own words, verbatim. Delhivery's box takes 300
      // characters and the seller's form is bounded well under that, so
      // nothing is truncated here — if that ever changes, truncating
      // silently would send a half-sentence, and the right answer is to
      // bound the seller's field rather than to trim it in transit.
      await this.escalations.postReply({
        escalationId: escalation.id,
        body,
        sellerId: input.sellerId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { ticketId: input.ticketId, err: message },
        'Could not put a seller issue to the courier',
      );
      try {
        void this.issues.raise({
          kind: SystemIssueKind.INTEGRATION,
          severity: SystemIssueSeverity.HIGH,
          title: "A seller's issue did not reach the courier",
          detail:
            `Ticket ${input.ticketId} was raised and saved, but opening the courier ` +
            `conversation failed: ${message}\n\n` +
            'The seller believes they have reported this and nothing is carrying it to ' +
            'Delhivery. Open the ticket, raise it on their portal by hand, and record the ' +
            'ticket id on the escalation so the replies thread back.',
          source: 'SellerIssueEscalationService',
          dedupeKey: `seller-issue-not-escalated:${input.ticketId}`,
          metadata: { ticketId: input.ticketId, sellerId: input.sellerId, error: message },
        });
      } catch {
        // Already inside a failure path; the log line above stands.
      }
    }
  }

  /**
   * The waybill this issue is about.
   *
   * Read from the ticket's own shipment, and from the ORDER's live
   * shipment when the ticket names no parcel — a seller raising an issue
   * from an order page has an order id and no shipment id, which is the
   * common shape. `awbNumber` rather than shipment status (CUR-2b): the
   * waybill is the authoritative fact that a parcel exists on their
   * system, and the status says only where it physically is.
   */
  private async resolveAwb(ticketId: string): Promise<string | null> {
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: {
        shipment: { select: { awbNumber: true } },
        order: {
          select: {
            orderShipments: {
              where: { shipment: { awbNumber: { not: null } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { shipment: { select: { awbNumber: true } } },
            },
          },
        },
      },
    });
    if (ticket === null) return null;
    const direct = ticket.shipment?.awbNumber ?? null;
    if (direct !== null) return direct;
    return ticket.order?.orderShipments[0]?.shipment.awbNumber ?? null;
  }
}
