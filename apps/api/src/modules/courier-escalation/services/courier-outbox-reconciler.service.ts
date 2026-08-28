import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CourierOutboxStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierSupportRegistryService } from './courier-support-registry.service';
import { CourierMessageClassifierService } from './courier-message-classifier.service';
import { CourierOutboxService, CLAIM_LEASE_MS } from './courier-outbox.service';

export interface ReconcileSummary {
  readonly examined: number;
  readonly confirmed: number;
  readonly returnedToQueue: number;
  readonly stillUnknown: number;
  readonly leasesReclaimed: number;
  readonly readBackUnavailable: boolean;
}

/**
 * Decide what happened to everything we sent but could not confirm.
 *
 * ── THE RULE THIS SERVICE EXISTS TO ENFORCE ──────────────────────────
 * A `SENT_UNCONFIRMED` item is NEVER blind-retried. It reached the point
 * where the courier may or may not have processed it, and the only way to
 * find out is to ASK — read the thread back and look for the message. A
 * retry instead of a read is how one comment becomes two in a thread the
 * customer is reading, and the duplicate is invisible to us.
 *
 * ── WHAT IT DOES WHEN IT CANNOT READ ─────────────────────────────────
 * Today it cannot: MCP is unprovisioned, so `getThread` is unsupported.
 * That is reported (`readBackUnavailable`) and the items are LEFT ALONE.
 * Leaving them is the correct behaviour, not a gap being papered over —
 * the alternative is guessing, and both guesses are bad: assume sent and
 * a real message is silently dropped; assume not sent and we duplicate.
 * They wait, visible in the console, for a human or for MCP.
 *
 * The exception is an item with no external ref at all, which CAN be
 * decided without reading: nothing was ever bound to it, so there is
 * nothing to duplicate. That is the "Mark sent but pasted nothing" case,
 * and it returns to the queue.
 *
 * ── IT ALSO RECLAIMS EXPIRED LEASES ──────────────────────────────────
 * A human who claims an item and closes the tab would otherwise hold it
 * forever. Reclaiming is a guarded update on the exact lease it saw, so
 * a stale sweep cannot steal an item someone just re-claimed.
 */
@Injectable()
export class CourierOutboxReconcilerService {
  private readonly logger = new Logger(CourierOutboxReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: CourierOutboxService,
    private readonly registry: CourierSupportRegistryService,
    private readonly classifier: CourierMessageClassifierService,
  ) {}

  /** Public so it doubles as the manual ops trigger. */
  async reconcile(): Promise<ReconcileSummary> {
    const leasesReclaimed = await this.reclaimExpiredLeases();

    const items = await this.prisma.client.courierOutboxItem.findMany({
      where: { status: CourierOutboxStatus.SENT_UNCONFIRMED },
      select: {
        id: true,
        body: true,
        externalRef: true,
        escalation: { select: { externalTicketId: true, courierCode: true } },
      },
      orderBy: { dispatchedAt: 'asc' },
      take: 100,
    });

    let confirmed = 0;
    let returnedToQueue = 0;
    let stillUnknown = 0;

    for (const item of items) {
      const ticketId = item.externalRef ?? item.escalation.externalTicketId;

      if (ticketId === null || ticketId === '') {
        // Decidable WITHOUT a read: nothing was ever bound, so nothing
        // can be duplicated. This is "Mark sent" with an empty paste-back
        // — the item goes back to the queue rather than sitting as a
        // permanent unknown.
        await this.outbox.release(
          item.id,
          'Marked sent but no ticket id was ever bound — returned to the queue',
        );
        await this.prisma.client.courierOutboxItem.updateMany({
          where: { id: item.id, status: CourierOutboxStatus.SENT_UNCONFIRMED },
          data: {
            status: CourierOutboxStatus.PENDING,
            claimedByKind: null,
            claimedByStaffId: null,
            claimedAt: null,
            claimExpiresAt: null,
            dispatchedAt: null,
            lastError: 'Marked sent with no ticket id bound — returned to the queue',
          },
        });
        returnedToQueue += 1;
        continue;
      }

      // PER ITEM, because read-back availability is per courier: one
      // desk becoming readable must not make us try to read a ticket
      // that lives at the other.
      const adapter = this.registry.for(item.escalation.courierCode);
      if (adapter === null || !adapter.capabilities().getThread) {
        // No read-back available. Leave it. See the class doc — every
        // alternative is a guess, and both guesses are worse than a wait.
        stillUnknown += 1;
        continue;
      }

      try {
        const thread = await adapter.getThread(ticketId);
        const target = this.classifier.hashBody(item.body);
        const present = thread.some((m) => this.classifier.hashBody(m.body) === target);
        if (present) {
          await this.outbox.confirmFromReadBack({
            itemId: item.id,
            externalRef: ticketId,
            actorType: ActorType.SYSTEM,
          });
          confirmed += 1;
        } else {
          // Read successfully, message genuinely absent: it did NOT
          // land, so re-queueing is safe and is the point of reading.
          await this.prisma.client.courierOutboxItem.updateMany({
            where: { id: item.id, status: CourierOutboxStatus.SENT_UNCONFIRMED },
            data: {
              status: CourierOutboxStatus.PENDING,
              dispatchedAt: null,
              claimedByKind: null,
              claimedByStaffId: null,
              claimedAt: null,
              claimExpiresAt: null,
              lastError: 'Read-back found the message absent — safe to send again',
            },
          });
          returnedToQueue += 1;
        }
      } catch (err) {
        // A failed READ tells us nothing about the WRITE. Stay unknown.
        stillUnknown += 1;
        this.logger.warn(
          { itemId: item.id, err: err instanceof Error ? err.message : String(err) },
          'Outbox read-back failed; item stays SENT_UNCONFIRMED',
        );
      }
    }

    const summary: ReconcileSummary = {
      examined: items.length,
      confirmed,
      returnedToQueue,
      stillUnknown,
      leasesReclaimed,
      // TRUE when NO courier we know of can read a thread back. With
      // one readable and one not, read-back IS available — the items it
      // cannot cover are counted in stillUnknown, which is where a
      // reader would look for them.
      readBackUnavailable: !this.registry
        .known()
        .some((code) => this.registry.for(code)?.capabilities().getThread === true),
    };
    if (items.length > 0 || leasesReclaimed > 0) {
      this.logger.log(summary, 'Courier outbox reconciliation complete');
    }
    return summary;
  }

  /**
   * Return items whose claim lease expired.
   *
   * Guarded on the exact lease instant the sweep saw, mirroring CC-7 and
   * WMS-5: a stale timer racing a fresh re-claim must lose, not steal.
   */
  private async reclaimExpiredLeases(): Promise<number> {
    const now = new Date();
    const stale = await this.prisma.client.courierOutboxItem.findMany({
      where: {
        status: CourierOutboxStatus.SENDING,
        claimExpiresAt: { lt: now },
      },
      select: { id: true, claimExpiresAt: true },
      take: 100,
    });

    let reclaimed = 0;
    for (const s of stale) {
      const { count } = await this.prisma.client.courierOutboxItem.updateMany({
        where: {
          id: s.id,
          status: CourierOutboxStatus.SENDING,
          // The exact value seen — not "still expired".
          claimExpiresAt: s.claimExpiresAt,
        },
        data: {
          status: CourierOutboxStatus.PENDING,
          claimedByKind: null,
          claimedByStaffId: null,
          claimedAt: null,
          claimExpiresAt: null,
          lastError: `Claim lease expired after ${Math.round(CLAIM_LEASE_MS / 60_000)} minutes`,
        },
      });
      reclaimed += count;
    }
    return reclaimed;
  }
}
