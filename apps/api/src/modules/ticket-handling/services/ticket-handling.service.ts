import { Injectable, Logger } from '@nestjs/common';
import { TicketHandling } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Couriers whose support tickets software can actually raise.
 *
 * A LIST, because the answer is not a property of the courier but of
 * what we have built for it. Delhivery has a portal we drive; Shiprocket
 * has no ticket automation at all, and `manual` is by definition
 * somebody ringing a person. A parcel on either of those has no portal
 * to open, so its issue moves only if a person moves it.
 *
 * Adding a courier here without building its automation would label
 * tickets AUTO that nothing is carrying — which is exactly the failure
 * this whole field exists to make visible.
 */
const AUTOMATED_COURIERS: readonly string[] = ['delhivery'];

/**
 * WHO is carrying a ticket to the courier.
 *
 * ── ONE READER, ONE WRITER ───────────────────────────────────────────
 * The same discipline as `BinPolicyService` and `WarehouseResolverService`
 * (CNS-2): five call sites each deciding what "automated" means is how
 * they come to disagree, and here disagreeing means a ticket that reads
 * AUTO on one screen and sits in a manual queue on another.
 *
 * ── IT FALLS BACK, NEVER FORWARD ─────────────────────────────────────
 * A ticket starts as whatever its courier makes possible. When an
 * automated attempt FAILS it becomes MANUAL, and it stays there: a
 * conversation a person has picked up must not be handed back to
 * software halfway through, because the person is the only one who
 * knows what they have already said.
 */
@Injectable()
export class TicketHandlingService {
  private readonly logger = new Logger(TicketHandlingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * What this courier makes possible, AND what we are currently willing
   * to let software do.
   *
   * Two different questions, deliberately answered in one place. The
   * courier half is fixed by what has been built; the second half is
   * `courier.ticket_automation_enabled`, an operator switch — because
   * "a person handles these for now" is a decision somebody makes on a
   * Tuesday afternoon about the state of the portal automation, and it
   * has to be reversible without a deploy on either side.
   *
   * It used to be pure and is now a read, which is the cost of the
   * switch existing at all. Keeping it in THIS method rather than
   * checking the flag at the call site is the point: one reader, as with
   * `BinPolicyService` and `WarehouseResolverService` (CNS-2). A caller
   * that consulted the switch itself would be a second opinion about
   * what "automated" means, and the two would drift.
   *
   * FAILS TO MANUAL. If the setting cannot be read we hand it to a
   * person, because the two mistakes are not the same size: manual costs
   * somebody's afternoon, while defaulting to AUTO during a settings
   * outage files real tickets with a real courier under a switch
   * somebody deliberately turned off.
   *
   * NOTHING IN FLIGHT MOVES. This decides the stamp at raise time only —
   * a ticket software has already opened with the courier stays AUTO,
   * because a conversation already under way must not change hands
   * halfway through (which is the same reason `fallBackToManual` never
   * runs backwards).
   */
  async initialFor(courierCode: string | null): Promise<TicketHandling> {
    if (courierCode === null || courierCode === '') return TicketHandling.NONE;
    if (!AUTOMATED_COURIERS.includes(courierCode.toLowerCase())) return TicketHandling.MANUAL;
    return (await this.automationEnabled()) ? TicketHandling.AUTO : TicketHandling.MANUAL;
  }

  /** The operator switch. Absent or unreadable ⇒ manual. */
  private async automationEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: 'courier.ticket_automation_enabled' },
        select: { valueBoolean: true },
      });
      return row?.valueBoolean === true;
    } catch {
      return false;
    }
  }

  /** Stamp it at raise time. */
  async set(ticketId: string, handling: TicketHandling): Promise<void> {
    await this.prisma.client.ticket.update({ where: { id: ticketId }, data: { handling } });
  }

  /**
   * An automated attempt failed; a person has to carry it now.
   *
   * Guarded on being AUTO rather than a blind update: a ticket already
   * MANUAL is not made "more manual" by a second failure, and the
   * `count` is what tells the caller whether this was the transition
   * worth telling somebody about. Returns false when nothing moved, so a
   * retry cannot raise the same alarm twice.
   */
  async fallBackToManual(ticketId: string): Promise<boolean> {
    const res = await this.prisma.client.ticket.updateMany({
      where: { id: ticketId, handling: TicketHandling.AUTO },
      data: { handling: TicketHandling.MANUAL },
    });
    if (res.count > 0) {
      this.logger.warn({ ticketId }, 'Ticket fell back to manual handling');
    }
    return res.count > 0;
  }
}
