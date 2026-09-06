import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
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
export class SellerIssueEscalationService implements OnModuleDestroy {
  private readonly logger = new Logger(SellerIssueEscalationService.name);

  /**
   * Escalations still being opened.
   *
   * `escalate` is called with `void` from the seller's ticket handler —
   * correct, because a slow portal must not hold their browser — which
   * means its writes outlive the request that started them. That is the
   * shape CLAUDE.md's drain rule exists for, and skipping it here cost a
   * CI shard: the INSERT holds a RowShareLock on orders and sellers
   * while the harness TRUNCATE wants an AccessExclusiveLock, and
   * Postgres kills one with a 40P01 that names neither the test nor the
   * cause.
   */
  private readonly inFlight = new Set<Promise<unknown>>();

  /** Await every escalation still opening. Public for the e2e harness. */
  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drainInFlight();
  }

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
  escalate(input: {
    ticketId: string;
    sellerId: string;
    description: string | null;
  }): Promise<void> {
    // Registered before it is returned, so a caller that fires and
    // forgets is still drainable. `finally` rather than `then`: a
    // rejected escalation must leave the set too, or the drain waits
    // forever on work that already gave up.
    const p = this.escalateInner(input);
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
    return p;
  }

  private async escalateInner(input: {
    ticketId: string;
    sellerId: string;
    description: string | null;
  }): Promise<void> {
    try {
      const parcel = await this.resolveParcel(input.ticketId);
      const awbNumber = parcel?.awbNumber ?? null;
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
        // The account that actually carried it (CACC-1), so the raise
        // lands on the panel that can see this waybill. Null only when
        // the shipment predates account tracking — the dispatcher then
        // falls back to the default session, which is what happens today
        // for every escalation.
        courierAccountId: parcel?.courierAccountId ?? null,
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
   * The waybill this issue is about, and whose account carried it.
   *
   * Read from the ticket's own shipment, and from the ORDER's live
   * shipment when the ticket names no parcel — a seller raising an issue
   * from an order page has an order id and no shipment id, which is the
   * common shape. `awbNumber` rather than shipment status (CUR-2b): the
   * waybill is the authoritative fact that a parcel exists on their
   * system, and the status says only where it physically is.
   */
  private async resolveParcel(
    ticketId: string,
  ): Promise<{ awbNumber: string; courierAccountId: string | null } | null> {
    const pick = { awbNumber: true, courierAccountId: true } as const;
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: {
        shipment: { select: pick },
        order: {
          select: {
            orderShipments: {
              where: { shipment: { awbNumber: { not: null } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { shipment: { select: pick } },
            },
          },
        },
      },
    });
    if (ticket === null) return null;
    // The waybill AND the account come from the SAME shipment row. Read
    // separately they could disagree — a ticket naming one parcel and an
    // order whose latest is another — and the raise would go to a panel
    // that cannot see the waybill it was given.
    const from = ticket.shipment ?? ticket.order?.orderShipments[0]?.shipment ?? null;
    if (from?.awbNumber == null) return null;
    return { awbNumber: from.awbNumber, courierAccountId: from.courierAccountId };
  }
}
