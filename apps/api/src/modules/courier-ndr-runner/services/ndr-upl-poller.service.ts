import { Injectable, Logger } from '@nestjs/common';
import { ActorType, NdrRequestStatus, TicketType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { DelhiveryNdrService } from '../../courier-delhivery/services/delhivery-ndr.service';
import { TicketService } from '../../ticket/services/ticket.service';
import { NdrSettingsService } from './ndr-settings.service';

const JOB = 'ndr-upl-poller';

export interface UplPollSummary {
  readonly polled: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly stillPending: number;
  readonly expired: number;
  readonly escalated: number;
}

/**
 * Ask Delhivery what actually happened to each submitted NDR request.
 *
 * ── WHY POLLING AT ALL ───────────────────────────────────────────────
 * The NDR API is asynchronous. `takeAction` returns a UPL id, not an
 * outcome; the answer is only available from
 * `/api/cmu/get_bulk_upl/{UPL_ID}`. Without this loop every request
 * would sit at SUBMITTED forever and "did it work?" would be answered by
 * waiting to see whether the parcel moved.
 *
 * ── CADENCE, AND WHY ─────────────────────────────────────────────────
 * Every 20 minutes (`courier.ndr_upl_poll_cron`). The outcome is not
 * real-time — the request is queued on Delhivery's side for the next
 * delivery cycle — so the answer rarely changes within the hour. The NDR
 * endpoints carry no documented rate budget, so our limiter applies a
 * conservative fallback and a tight loop would spend it against a value
 * nobody can act on before morning. Twenty minutes gets every request
 * answered well inside the four-hour deadline while leaving the budget
 * for interactive operator actions.
 *
 * ── UNPOLLED IS FAILED, NOT UNKNOWN ──────────────────────────────────
 * Past `courier.ndr_upl_poll_deadline_minutes` with no answer, the row
 * goes FAILED and escalates. Silence is not "still might work": the
 * customer is waiting either way, and a re-attempt we cannot confirm has
 * to be chased by a human. The cost of being wrong is one duplicate
 * chase. The cost of the other choice is a parcel nobody is looking at.
 */
@Injectable()
export class NdrUplPollerService {
  private readonly logger = new Logger(NdrUplPollerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: NdrSettingsService,
    private readonly ndr: DelhiveryNdrService,
    private readonly tickets: TicketService,
    private readonly audit: AuditLogService,
  ) {}

  /** Public so it doubles as the manual ops trigger. */
  async poll(): Promise<UplPollSummary> {
    const deadlineMinutes = await this.settings.pollDeadlineMinutes();
    const cutoff = new Date(Date.now() - deadlineMinutes * 60_000);

    const pending = await this.prisma.client.ndrActionRequest.findMany({
      where: { status: NdrRequestStatus.SUBMITTED },
      select: {
        id: true,
        uplId: true,
        awbNumber: true,
        shipmentId: true,
        submittedAt: true,
        action: true,
      },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });

    let confirmed = 0;
    let failed = 0;
    let stillPending = 0;
    let expired = 0;
    let escalated = 0;

    for (const row of pending) {
      const overdue = row.submittedAt < cutoff;

      // No UPL id means the submit never produced a handle — there is
      // nothing to ask about, so it is decided immediately.
      if (row.uplId === null || row.uplId === '') {
        await this.settle(row.id, NdrRequestStatus.FAILED, 'No UPL id was returned by the submit');
        failed += 1;
        escalated += (await this.escalate(row.shipmentId, row.awbNumber, row.action, 'no UPL id')) ? 1 : 0;
        continue;
      }

      let outcome: { done: boolean; success: boolean; message: string } | null = null;
      try {
        const status = await this.ndr.checkStatus(row.uplId, courierActor.runner(JOB, row.id));
        // `success` is nullable: complete-but-null means Delhivery
        // answered without saying it worked, which is not a yes. Only an
        // explicit true confirms — anything else waits for the deadline.
        outcome = {
          done: status.complete && status.success !== null,
          success: status.success === true,
          message:
            status.success === true
              ? 'Delhivery confirmed the action'
              : `Delhivery reported the action did not succeed (${JSON.stringify(status.raw).slice(0, 200)})`,
        };
      } catch (err) {
        // A failed poll is not a failed request — Delhivery may be
        // briefly unreachable. It only becomes FAILED at the deadline.
        this.logger.warn(
          { uplId: row.uplId, err: err instanceof Error ? err.message : String(err) },
          'NDR UPL poll failed',
        );
      }

      await this.prisma.client.ndrActionRequest.update({
        where: { id: row.id },
        data: { polledAt: new Date(), pollAttempts: { increment: 1 } },
      });

      if (outcome !== null && outcome.done) {
        if (outcome.success) {
          await this.settle(row.id, NdrRequestStatus.CONFIRMED, outcome.message);
          confirmed += 1;
        } else {
          await this.settle(row.id, NdrRequestStatus.FAILED, outcome.message);
          failed += 1;
          escalated += (await this.escalate(row.shipmentId, row.awbNumber, row.action, outcome.message)) ? 1 : 0;
        }
        continue;
      }

      if (overdue) {
        expired += 1;
        failed += 1;
        await this.settle(
          row.id,
          NdrRequestStatus.FAILED,
          `No outcome within ${deadlineMinutes} minutes — treated as failed`,
        );
        escalated += (await this.escalate(row.shipmentId, row.awbNumber, row.action, 'poll deadline passed'))
          ? 1
          : 0;
        continue;
      }

      stillPending += 1;
    }

    return { polled: pending.length, confirmed, failed, stillPending, expired, escalated };
  }

  private async settle(id: string, status: NdrRequestStatus, message: string): Promise<void> {
    // Guarded on SUBMITTED so two poll cycles racing cannot both settle
    // the same row and double-escalate. A read-then-write here would be
    // the exact shape this codebase keeps finding in money paths.
    const { count } = await this.prisma.client.ndrActionRequest.updateMany({
      where: { id, status: NdrRequestStatus.SUBMITTED },
      data: { status, courierMessage: message, polledAt: new Date() },
    });
    if (count === 0) {
      this.logger.debug({ id }, 'NDR request already settled by a concurrent poll — no-op');
    }
  }

  /**
   * Hand a failed request to the ticket path.
   *
   * The ticket is the seam the courier-escalation work hangs its
   * Delhivery conversation off, which is why this uses the EXISTING R7
   * queue rather than a parallel one: ops should work one list.
   *
   * Returns whether a ticket was raised, so a failure to raise one is
   * counted rather than swallowed — but it never throws, because the
   * request really did fail and losing that fact to a ticket-system
   * error would be worse.
   */
  private async escalate(
    shipmentId: string,
    awbNumber: string,
    action: string,
    why: string,
  ): Promise<boolean> {
    try {
      // A shipment reaches its order through `order_shipments`, not a
      // column — the join table is what allows a superseded shipment to
      // keep its history.
      const shipment = await this.prisma.client.shipment.findUnique({
        where: { id: shipmentId },
        select: {
          id: true,
          courierCode: true,
          orderShipments: { select: { order: { select: { id: true, sellerId: true } } }, take: 1 },
        },
      });
      const order = shipment?.orderShipments[0]?.order;
      if (order === undefined) return false;

      const ticket = await this.tickets.open(
        {
          ticketType: TicketType.COURIER_NDR_ESCALATION,
          sellerId: order.sellerId,
          orderId: order.id,
          shipmentId: shipmentId,
          courierCode: shipment?.courierCode ?? null,
          subject: `Re-attempt could not be confirmed — AWB ${awbNumber}`,
          description:
            `We asked Delhivery for a ${action} on AWB ${awbNumber} and could not confirm it went through. ` +
            `Reason: ${why}. This needs a human to chase with the courier.`,
        },
        { type: ActorType.SYSTEM },
      );

      await this.prisma.client.ndrActionRequest.updateMany({
        where: { shipmentId, status: NdrRequestStatus.FAILED, ticketId: null },
        data: { status: NdrRequestStatus.ESCALATED, ticketId: ticket.id },
      });
      return true;
    } catch (err) {
      this.logger.error(
        { shipmentId, err: err instanceof Error ? err.message : String(err) },
        'Failed to raise an NDR escalation ticket — the request is still recorded FAILED',
      );
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'courier.ndr.escalation_failed',
        entityType: 'shipment',
        entityId: shipmentId,
        severity: 'HIGH',
        metadata: { awbNumber, ndrAction: action, why },
      });
      return false;
    }
  }
}
