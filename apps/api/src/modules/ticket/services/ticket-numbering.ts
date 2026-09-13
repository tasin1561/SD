import type { Prisma } from '@skydrop/db';
import { AdvisoryLock } from '../../../common/db/advisory-lock';

/**
 * `TK-YYYY-NNNNNN` — the number a person reads out for a ticket.
 *
 * Same mechanism as ORD-8 / `ShipmentNumberingService` /
 * `ConsignmentNumberingService`: a per-year Postgres SEQUENCE, created
 * lazily under a transaction-scoped advisory lock, and allocated INSIDE
 * the transaction that inserts the ticket — so a rolled-back open cannot
 * hand its number to the next one, and two opens can never share one.
 * Gaps are fine: `tickets.ticket_number` is UNIQUE, and uniqueness rather
 * than contiguity is the contract.
 *
 * No month segment, unlike SH-/CN-/MF-. Those serials are per YEAR too,
 * so the month there adds nothing to uniqueness; it is decoration. A
 * ticket number is the one identifier a seller is most likely to read
 * down a phone, so it carries only what makes it unique.
 *
 * The year is the UTC year of the moment of allocation, which is what
 * the backfill migration (`20260913000200_ticket_numbers`) used for the
 * tickets that existed before this — `created_at` in UTC.
 */
export function formatTicketNumber(year: number, serial: number): string {
  return `TK-${year}-${String(serial).padStart(6, '0')}`;
}

/** Recognises a ticket number typed into a search box, in any case. */
export const TICKET_NUMBER_PATTERN = /^TK-\d{4}-\d{6,}$/i;

export async function allocateTicketNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error(`allocateTicketNumber: refusing to allocate for implausible year ${year}`);
  }
  // `seq` is `ticket_number_seq_<4-digit-int>` — no user input reaches it.
  const seq = `ticket_number_seq_${year}`;
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock($1::int, $2::int)',
    AdvisoryLock.TICKET_NUMBER,
    year,
  );
  await tx.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}" START 1`);
  const rows = await tx.$queryRawUnsafe<Array<{ value: bigint }>>(
    `SELECT nextval('"${seq}"') AS value`,
  );
  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error(`allocateTicketNumber: nextval produced no value for ${seq}`);
  }
  return formatTicketNumber(year, Number(value));
}
