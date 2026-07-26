import { Injectable } from '@nestjs/common';
import { TicketStatus } from '@skydrop/db';

/**
 * R7 — the ticket lifecycle matrix. Pure logic, no Prisma; mirrors
 * `OrderStateMachineService`'s discipline: transitions are DECLARED, so
 * there is no any→any path and an illegal move is a typed rejection
 * rather than a silently-accepted status write.
 *
 * OPEN ⇄ NEGOTIATING, and either may terminate. The four terminals
 * (three resolutions + REJECTED) have NO outbound edges — reopening a
 * settled claim would mean re-litigating money that has already moved,
 * so it requires a new ticket instead.
 */
const MATRIX: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  [TicketStatus.OPEN]: [
    TicketStatus.NEGOTIATING,
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ],
  [TicketStatus.NEGOTIATING]: [
    TicketStatus.OPEN,
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ],
  [TicketStatus.RESOLVED_REFUND]: [],
  [TicketStatus.RESOLVED_RETURNED]: [],
  [TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED]: [],
  [TicketStatus.REJECTED]: [],
};

/** Statuses that end the ticket's life. */
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.RESOLVED_REFUND,
  TicketStatus.RESOLVED_RETURNED,
  TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
  TicketStatus.REJECTED,
];

@Injectable()
export class TicketStateMachineService {
  canTransition(from: TicketStatus, to: TicketStatus): boolean {
    return MATRIX[from].includes(to);
  }

  allowedFrom(from: TicketStatus): readonly TicketStatus[] {
    return MATRIX[from];
  }

  isTerminal(status: TicketStatus): boolean {
    return TERMINAL_TICKET_STATUSES.includes(status);
  }
}
