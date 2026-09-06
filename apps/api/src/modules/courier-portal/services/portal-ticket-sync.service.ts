import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  CourierMessageChannel,
  SystemIssueKind,
  SystemIssueSeverity,
  TicketStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierEscalationIngestService } from '../../courier-escalation/services/courier-escalation-ingest.service';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { TicketService } from '../../ticket/services/ticket.service';
import { PortalSessionService } from './portal-session.service';
import { SupportTicketsPage, type PortalTicketRow } from '../pages/support-tickets.page';
import { TicketDetailPage } from '../pages/ticket-detail.page';

export interface TicketSyncResult {
  readonly listed: number;
  readonly bound: number;
  readonly ingested: number;
  readonly closed: number;
  readonly skipped: number;
}

/**
 * The half of the courier conversation that was only ever one-way.
 *
 * We could raise a ticket with Delhivery and post to it. Nothing ever
 * read it back. Their replies arrived as email to a mailbox and their
 * closures arrived nowhere at all, so a seller who asked us something
 * got an answer only if a person happened to open the portal, see it,
 * and retype it. This sweep is the other direction.
 *
 * ── THREE THINGS, IN THIS ORDER, AND THE ORDER MATTERS ───────────────
 * 1. BIND. A raise does not reliably hand back its id — the modal
 *    confirms and closes — so an escalation can be waiting on a ticket
 *    that exists and cannot be recognised. The support list prints the
 *    id and the waybill together, which is the only place those two
 *    facts meet. Binding first is what makes steps 2 and 3 possible at
 *    all.
 * 2. INGEST. Read each bound thread and store what the courier said,
 *    verbatim. `CourierEscalationIngestService` already owns the dedup
 *    (body hash + minute bucket), so re-reading a thread every sweep is
 *    free and a duplicate is impossible.
 * 3. CLOSE. A ticket sitting in their Resolved or Closed tab is the
 *    courier saying they are finished.
 *
 * ── CLOSING THEIRS IS NOT RESOLVING OURS ─────────────────────────────
 * `CLOSED_BY_COURIER` exists precisely so this sweep never has to claim
 * an outcome. No money moved, no goods came back, the seller accepted
 * nothing and we rejected nothing — and any of the four settled statuses
 * would tell the seller one of those things happened. It reopens, so a
 * seller who disagrees with how Delhivery left it keeps the conversation
 * rather than starting a second one.
 *
 * ── READ-ONLY, SO IT RUNS IN SHADOW TOO ──────────────────────────────
 * Every step here is a read of their portal plus a write of OURS. There
 * is nothing to withhold in SHADOW mode and nothing a mistake here can
 * do to a parcel — which is why this sweep is gated on having a session
 * at all rather than on `portalMode`. Withholding it in shadow would
 * mean the safe mode is also the blind one, and a seller waiting on an
 * answer would get silence for the safest of reasons.
 */
@Injectable()
export class PortalTicketSyncService {
  private readonly logger = new Logger(PortalTicketSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly session: PortalSessionService,
    private readonly ingest: CourierEscalationIngestService,
    private readonly tickets: TicketService,
    private readonly settings: CourierChannelSettingsService,
    private readonly issues: SystemIssueService,
  ) {}

  async sync(courierCode = 'delhivery'): Promise<TicketSyncResult> {
    const channel = await this.settings.get(courierCode);
    if (channel.effectivelyPaused) {
      this.logger.log('Courier channel is paused; ticket sync stood down');
      return { listed: 0, bound: 0, ingested: 0, closed: 0, skipped: 0 };
    }

    let listed = 0;
    let bound = 0;
    let ingested = 0;
    let closed = 0;
    let skipped = 0;

    try {
      const page = await this.session.page();
      const list = new SupportTicketsPage(page);
      const rows = await list.listAll();
      listed = rows.length;

      for (const row of rows) {
        try {
          const escalationId = await this.bind(row);
          if (escalationId === null) {
            // Their panel holds tickets nobody here raised — a person
            // filing one by hand is a real case. Not an error, and NOT
            // something to invent an escalation for: fabricating the
            // seller link would thread somebody else's parcel into this
            // conversation.
            skipped += 1;
            continue;
          }
          if (row.awbNumber !== null) bound += 1;

          ingested += await this.ingestThread(page, list, row, escalationId);
          if (row.state !== 'OPEN') closed += (await this.closeThrough(escalationId, row)) ? 1 : 0;
        } catch (err) {
          // One bad ticket must not cost the other two hundred their
          // sweep — the same per-item isolation as the AWB fan-out.
          this.logger.warn(
            { externalTicketId: row.externalTicketId, err: this.msg(err) },
            'Ticket sync failed for one ticket; continuing',
          );
        }
      }
    } catch (err) {
      // The sweep itself could not run — no session, portal moved,
      // login challenged. That is silence on every seller's question at
      // once, so it says so rather than logging and stopping.
      const message = this.msg(err);
      this.logger.error({ err: message }, 'Courier ticket sync could not run');
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: 'Courier replies are not being collected',
        detail:
          `The sweep that reads Delhivery's support tickets could not run: ${message}\n\n` +
          'While this persists, sellers who raised an issue see no reply and a ticket they ' +
          'have closed stays open here. Check the portal session on /courier-escalation — a ' +
          'login challenge is the usual cause.',
        source: 'PortalTicketSyncService',
        dedupeKey: 'portal-ticket-sync-down',
        metadata: { courierCode, error: message },
      });
    }

    return { listed, bound, ingested, closed, skipped };
  }

  /**
   * Find the escalation this row belongs to, binding the id if needed.
   *
   * By id first — that is exact. Then by WAYBILL, but only onto an
   * escalation that has no id yet: a parcel can carry several tickets
   * over its life, and matching an open escalation to whichever ticket
   * shares its waybill would thread a September reply into an August
   * conversation. An escalation that already has an id is never
   * re-pointed.
   */
  private async bind(row: PortalTicketRow): Promise<string | null> {
    const byId = await this.prisma.client.courierEscalation.findFirst({
      where: { externalTicketId: row.externalTicketId },
      select: { id: true },
    });
    if (byId !== null) return byId.id;

    if (row.awbNumber === null) return null;

    const claimed = await this.prisma.client.courierEscalation.updateMany({
      // Guarded, not read-then-write: two sweeps overlapping would
      // otherwise both see "no id" and both claim the same escalation
      // for different tickets.
      where: { awbNumber: row.awbNumber, externalTicketId: null },
      data: { externalTicketId: row.externalTicketId },
    });
    if (claimed.count === 0) return null;

    const bound = await this.prisma.client.courierEscalation.findFirst({
      where: { externalTicketId: row.externalTicketId },
      select: { id: true },
    });
    this.logger.log(
      { externalTicketId: row.externalTicketId, awbNumber: row.awbNumber },
      'Bound a courier ticket to its escalation',
    );
    return bound?.id ?? null;
  }

  /** Store what the courier said. Dedup is the ingest service's job. */
  private async ingestThread(
    page: Awaited<ReturnType<PortalSessionService['page']>>,
    list: SupportTicketsPage,
    row: PortalTicketRow,
    escalationId: string,
  ): Promise<number> {
    if (row.href === null) return 0;
    await list.openDetail(row.href);
    const detail = new TicketDetailPage(page);
    const thread = await detail.readThread();

    let stored = 0;
    for (const message of thread) {
      const res = await this.ingest.ingest({
        externalTicketId: row.externalTicketId,
        body: message.body,
        // Their portal prints a time per message but not a date we can
        // trust to parse, so receipt time is used and the dedup key
        // carries the BODY HASH — which is what actually prevents a
        // second copy, minute bucket or not.
        occurredAt: new Date(),
        channel: CourierMessageChannel.PORTAL,
        sourceRef: row.externalTicketId,
        awbNumber: row.awbNumber,
      });
      if (res.kind === 'STORED') stored += 1;
    }
    void escalationId;
    return stored;
  }

  /**
   * Their tab says finished; close ours to match.
   *
   * Idempotent by construction: a ticket already in a terminal status
   * has no edge to CLOSED_BY_COURIER, so a re-run is refused by the
   * state machine rather than by a flag here.
   */
  private async closeThrough(escalationId: string, row: PortalTicketRow): Promise<boolean> {
    const escalation = await this.prisma.client.courierEscalation.findUnique({
      where: { id: escalationId },
      select: { ticketId: true, ticket: { select: { status: true } } },
    });
    const current = escalation?.ticket?.status;
    if (escalation === null || current === undefined) return false;
    if (current !== TicketStatus.OPEN && current !== TicketStatus.NEGOTIATING) return false;

    await this.tickets.transition(
      escalation.ticketId,
      {
        to: TicketStatus.CLOSED_BY_COURIER,
        notes:
          `Delhivery moved ticket ${row.externalTicketId} to ${row.state.toLowerCase()}. ` +
          'Their last word is in the conversation above. If this is not settled for you, ' +
          'reply here and we will take it back to them.',
      },
      { type: ActorType.SYSTEM },
    );
    return true;
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
