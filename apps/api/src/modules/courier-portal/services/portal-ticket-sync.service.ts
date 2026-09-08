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
import { SupportTicketsPage, TAB_PATH, type PortalTicketRow } from '../pages/support-tickets.page';
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
      /*
        NOTHING TO DO, so do not open a browser.

        The scan is nine page loads against their portal. With no live
        escalation there is no question it could answer, and running it
        anyway is load on somebody else's systems to learn nothing.
      */
      const live = await this.prisma.client.courierEscalation.count({
        where: {
          courierCode,
          ticket: { status: { in: [TicketStatus.OPEN, TicketStatus.NEGOTIATING] } },
        },
      });
      if (live === 0) {
        this.logger.debug('No live courier escalations; ticket sync stood down');
        return { listed: 0, bound: 0, ingested: 0, closed: 0, skipped: 0 };
      }

      const accounts = await this.accountsToSweep(courierCode);

      for (const accountId of accounts) {
        const page = await this.session.page(accountId);
        const list = new SupportTicketsPage(page);
        const scan = await list.listOpenAndResolved();
        listed += scan.rows.length;

        const byId = new Map(scan.rows.map((r) => [r.externalTicketId, r]));
        const unboundByAwb = new Map<string, (typeof scan.rows)[number]>();
        for (const r of scan.rows) {
          if (r.awbNumber !== null && !unboundByAwb.has(r.awbNumber))
            unboundByAwb.set(r.awbNumber, r);
        }

        /*
          OURS, not theirs.

          The account holds ~200 open tickets and about eleven are ours —
          the rest are the client's other business on the same login.
          Driving the sweep from OUR escalations rather than from their
          list is what turns two hundred thread opens into a handful, and
          it is the difference between a sweep that takes fifteen minutes
          and one that takes twenty seconds.

          Terminal tickets are excluded: a conversation we have already
          closed has nothing left to read, and re-reading it every twenty
          minutes forever is the cost that grows without bound.
        */
        const mine = await this.prisma.client.courierEscalation.findMany({
          where: {
            courierCode,
            /*
              THIS ACCOUNT, OR NONE RECORDED.

              `courierAccountId` was added after these rows existed, so
              every escalation opened before it carries null — and one
              opened from an inbound email has no shipment to ask. A
              filter of `= accountId` excludes exactly those, silently:
              the sweep read all 280 of their tickets, matched nothing,
              and reported a clean run. Observed in production, where the
              one live escalation is a legacy row.

              Including nulls is right rather than merely lenient: with
              one account they ARE this account, and with several an
              unattributed conversation is better swept by whichever
              session can see it than by none.
            */
            ...(accountId === null
              ? {}
              : { OR: [{ courierAccountId: accountId }, { courierAccountId: null }] }),
            ticket: { status: { in: [TicketStatus.OPEN, TicketStatus.NEGOTIATING] } },
          },
          select: {
            id: true,
            externalTicketId: true,
            awbNumber: true,
            portalRowHash: true,
            ticketId: true,
          },
        });

        for (const esc of mine) {
          try {
            let row = esc.externalTicketId === null ? undefined : byId.get(esc.externalTicketId);

            // BIND: a raise does not reliably hand back its id, and the
            // list is the only place the id and the waybill meet.
            if (esc.externalTicketId === null && esc.awbNumber !== null) {
              const candidate = unboundByAwb.get(esc.awbNumber);
              if (
                candidate !== undefined &&
                (await this.claim(esc.awbNumber, candidate.externalTicketId))
              ) {
                bound += 1;
                row = candidate;
              }
            }

            if (row === undefined) {
              /*
                In neither Open nor Resolved.

                That is Delhivery having closed it — the same conclusion
                the Closed tab would give, reached without paging through
                a tab that grows forever. Guarded on a COMPLETE scan: a
                login bounce returns zero rows, and acting on that would
                close every seller's ticket at once.
              */
              if (!scan.complete || esc.externalTicketId === null) {
                skipped += 1;
                continue;
              }
              if (await this.closeThrough(esc.id, esc.externalTicketId, 'closed')) closed += 1;
              continue;
            }

            // UNCHANGED: the row reads exactly as it did last sweep, so
            // there is nothing new to read and no reason to spend ten
            // seconds opening it.
            if (esc.portalRowHash === row.rowHash) {
              skipped += 1;
              continue;
            }

            ingested += await this.ingestThread(page, list, row);
            await this.prisma.client.courierEscalation.update({
              where: { id: esc.id },
              data: { portalRowHash: row.rowHash },
            });

            if (row.state === 'RESOLVED') {
              if (await this.closeThrough(esc.id, row.externalTicketId, 'resolved')) closed += 1;
            }
          } catch (err) {
            // One bad ticket must not cost the others their sweep — the
            // same per-item isolation as the AWB fan-out.
            this.logger.warn(
              { escalationId: esc.id, err: this.msg(err) },
              'Ticket sync failed for one escalation; continuing',
            );
          }
        }

        if (!scan.complete) {
          // Said out loud rather than logged: an incomplete scan means
          // closure inference was withheld, so a ticket Delhivery closed
          // this morning still reads as open here.
          await this.issues.raise({
            kind: SystemIssueKind.INTEGRATION,
            severity: SystemIssueSeverity.MEDIUM,
            title: 'Only part of the courier ticket list could be read',
            detail:
              `A sweep of Delhivery's support tabs did not finish. Their stated totals were ` +
              `${JSON.stringify(scan.statedTotals)} and ${scan.rows.length} rows were read.\n\n` +
              (Object.keys(scan.errors).length > 0
                ? `What went wrong, per tab:\n${Object.entries(scan.errors)
                    .map(([tab, message]) => `  ${tab}: ${message}`)
                    .join('\n')}\n\n`
                : '') +
              'Replies were still collected for the tickets that WERE seen. What was withheld ' +
              'is closing: a ticket missing from a half-read list looks closed, and acting on ' +
              "that would close every seller's ticket at once. A login challenge is the usual " +
              'cause — check the portal session.',
            source: 'PortalTicketSyncService',
            dedupeKey: `portal-ticket-scan-partial:${accountId ?? 'default'}`,
            metadata: {
              accountId,
              rows: scan.rows.length,
              statedTotals: scan.statedTotals,
              errors: scan.errors,
            },
          });
        }
      }
    } catch (err) {
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
   * Claim a ticket id for the escalation holding that waybill.
   *
   * Guarded, not read-then-write: two sweeps overlapping would otherwise
   * both see "no id" and both claim the same escalation for different
   * tickets. Only ever claims one that has NO id — a parcel carries
   * several tickets over its life, and re-pointing a bound escalation
   * would thread a September reply into an August conversation.
   */
  private async claim(awbNumber: string, externalTicketId: string): Promise<boolean> {
    const res = await this.prisma.client.courierEscalation.updateMany({
      where: { awbNumber, externalTicketId: null },
      data: { externalTicketId },
    });
    if (res.count > 0) {
      this.logger.log({ externalTicketId, awbNumber }, 'Bound a courier ticket to its escalation');
    }
    return res.count > 0;
  }

  /**
   * Which portal sessions to walk.
   *
   * The ACTIVE accounts for this courier — an account switched off still
   * holds real parcels moving towards real customers (CUR-16), so its
   * tickets are still read; `isActive` governs new parcels, not whether
   * we listen. Falls back to the default session when none is
   * configured.
   */
  private async accountsToSweep(courierCode: string): Promise<(string | null)[]> {
    const accounts = await this.prisma.client.courierAccount.findMany({
      // Through the COURIER, because an account carries `courierId` and
      // the code is the courier's. Matching on a string field that does
      // not exist is what the compiler just refused.
      where: { courier: { code: courierCode }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.length === 0 ? [null] : accounts.map((a) => a.id);
  }

  /**
   * Store what the COURIER said. Dedup is the ingest service's job.
   *
   * Only their side. Their thread right-aligns the client's own messages
   * and `readThread` reports that as `mine`, so our own words are
   * skipped here rather than stored as things Delhivery told us — which
   * would quote a seller's message back to them as a reply and label our
   * own text with a courier state.
   */
  private async ingestThread(
    page: Awaited<ReturnType<PortalSessionService['page']>>,
    list: SupportTicketsPage,
    row: PortalTicketRow,
  ): Promise<number> {
    // Clicked, not navigated: their list prints the id as a span with a
    // click handler and carries no link to the detail at all.
    const url = await list.openByTicketId(row.externalTicketId, TAB_PATH[row.state]);
    if (url === null) return 0;

    const detail = new TicketDetailPage(page);
    await detail.settle();
    const thread = await detail.readThread();

    let stored = 0;
    for (const message of thread) {
      if (message.mine) continue;
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
    return stored;
  }

  /**
   * Their tab says finished; close ours to match.
   *
   * Idempotent by construction: a ticket already in a terminal status
   * has no edge to CLOSED_BY_COURIER, so a re-run is refused by the
   * state machine rather than by a flag here.
   */
  private async closeThrough(
    escalationId: string,
    externalTicketId: string,
    how: 'resolved' | 'closed',
  ): Promise<boolean> {
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
          `Delhivery marked ticket ${externalTicketId} ${how}. ` +
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
