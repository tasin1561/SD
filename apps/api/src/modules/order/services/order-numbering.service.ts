import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * ORD-8 — order-number allocation.
 *
 * Format: `SD-YYYY-NN-XXXXXX`
 *   YYYY   full UTC year of allocation
 *   NN     2-digit year suffix (year % 100) — per the Module 6 spec
 *   XXXXXX zero-padded value from a PER-YEAR Postgres SEQUENCE
 *
 * Why a real SEQUENCE and not a counter row / max()+1:
 *   - `nextval()` is atomic and lock-free; it never hands the same value
 *     to two concurrent allocators. Gaps (rolled-back txns) are fine —
 *     uniqueness, not contiguity, is the contract (`orders.order_number`
 *     is `@unique`).
 *   - A per-year sequence (`order_number_seq_<YYYY>`) resets numbering
 *     each year without a maintenance job.
 *
 * Lazy creation under an advisory lock (ORD-8): the first allocation of a
 * year creates the sequence. `CREATE SEQUENCE IF NOT EXISTS` is itself
 * race-safe, but two concurrent first-callers could still collide on the
 * catalog write; a transaction-scoped advisory lock keyed by the year
 * serialises just that window. The lock auto-releases at txn end, so it
 * is cheap and deadlock-free.
 *
 * `nextOrderNumber(tx?)` accepts an existing transaction client so the
 * caller (OrderService.create) can allocate the number inside the same
 * txn that inserts the order row — number and row commit atomically. When
 * no txn is supplied it self-wraps (the advisory lock REQUIRES a txn to
 * be transaction-scoped).
 */
@Injectable()
export class OrderNumberingService {
  private readonly logger = new Logger(OrderNumberingService.name);

  /**
   * Advisory-lock namespace for order numbering. Paired with the year as
   * the second 32-bit key in `pg_advisory_xact_lock(int, int)`. No other
   * code in the codebase takes advisory locks, so any stable constant is
   * safe; this one is documented purely so future lock users avoid it.
   */
  private static readonly LOCK_NAMESPACE = 0x0_4f_52 /* 'OR' */;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocate the next order number. Pass `tx` to allocate inside an
   * existing transaction (recommended from OrderService.create so the
   * number and the order row are atomic); omit it to run standalone.
   */
  async nextOrderNumber(tx?: Prisma.TransactionClient, now: Date = new Date()): Promise<string> {
    const year = now.getUTCFullYear();
    // year is always a 4-digit integer from a Date; assert it so the
    // sequence identifier interpolation below is provably injection-free.
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new Error(`OrderNumberingService: refusing to allocate for implausible year ${year}`);
    }

    const seq = `order_number_seq_${year}`;
    const value = tx
      ? await this.allocate(tx, year, seq)
      : await this.prisma.client.$transaction((t) => this.allocate(t, year, seq));

    const yy = String(year % 100).padStart(2, '0');
    const serial = String(value).padStart(6, '0');
    return `SD-${year}-${yy}-${serial}`;
  }

  private async allocate(
    client: Prisma.TransactionClient,
    year: number,
    seq: string,
  ): Promise<number> {
    // Serialise the lazy CREATE for this year (txn-scoped, auto-released).
    await client.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      OrderNumberingService.LOCK_NAMESPACE,
      year,
    );
    // `seq` is `order_number_seq_<4-digit-int>` — no user input, safe to
    // interpolate as a quoted identifier.
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}"`);
    const rows = await client.$queryRawUnsafe<Array<{ value: bigint }>>(
      `SELECT nextval('"${seq}"') AS value`,
    );
    const raw = rows[0]?.value;
    if (raw === undefined) {
      // Should be unreachable — nextval always returns one row.
      this.logger.error(`nextval returned no row for sequence ${seq}`);
      throw new Error(`OrderNumberingService: nextval produced no value for ${seq}`);
    }
    return Number(raw);
  }
}
