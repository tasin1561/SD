import { Module } from '@nestjs/common';
import { TicketHandlingService } from './services/ticket-handling.service';

/**
 * WHO is carrying a ticket to the courier — the R3 shared primitive.
 *
 * ── WHY IT IS NOT IN `ticket` ────────────────────────────────────────
 * A seller raising an issue makes `ticket` depend on `courier-escalation`
 * (the raise), and recording who is carrying it makes the escalation
 * depend back on the ticket. That is a module cycle, and CLAUDE.md's
 * answer to a cycle is to EXTRACT the primitive rather than reach for
 * `forwardRef` — the sixth time that rule has applied here after
 * call-queue, shipment-provision, inventory-shared and lifecycle-events.
 *
 * It depends on nothing but Prisma, which is what makes the extraction
 * possible at all.
 *
 * ── THE TKT-1 TENSION, STATED RATHER THAN HIDDEN ─────────────────────
 * TKT-1 makes `TicketService` the sole writer of `tickets`. This writes
 * ONE column of that table, and the exception is the documented shape
 * MUST #13 already allows: a column owned by another domain that lives
 * on a table for storage convenience. `handling` is a fact about the
 * COURIER channel, not about the ticket's own lifecycle — it moves when
 * an automated raise fails, which `TicketService` knows nothing about
 * and should not learn. The state machine, the status and the events
 * remain entirely TicketService's.
 */
@Module({
  providers: [TicketHandlingService],
  exports: [TicketHandlingService],
})
export class TicketHandlingModule {}
