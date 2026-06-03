import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Phase 1B — invoice-number allocation (mirrors ORD-8 / OrderNumberingService).
 *
 * Format: `SD/INV/YYYY-YY/NNNNNN`
 *   YYYY-YY  Indian financial year (April-March). For dates in
 *            April..December, FY = `<year>-<year+1 % 100>`; for
 *            January..March, FY = `<year-1>-<year % 100>`.
 *   NNNNNN   zero-padded value from a per-FY Postgres SEQUENCE
 *
 * Per-FY sequence created lazily under a transaction-scoped advisory
 * lock (auto-released at txn end). `nextval()` is atomic + lock-free
 * for subsequent allocations.
 */
@Injectable()
export class InvoiceNumberingService {
  private readonly logger = new Logger(InvoiceNumberingService.name);

  // Advisory-lock namespace. 0x494E for 'IN' (invoice).
  private static readonly LOCK_NAMESPACE = 0x494e;

  constructor(private readonly prisma: PrismaService) {}

  static fiscalYearFor(date: Date): { fy: string; startYear: number } {
    const month = date.getUTCMonth() + 1; // 1..12
    const year = date.getUTCFullYear();
    const startYear = month >= 4 ? year : year - 1;
    const endYY = String((startYear + 1) % 100).padStart(2, '0');
    return { fy: `${startYear}-${endYY}`, startYear };
  }

  async nextInvoiceNumber(
    tx?: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<{ invoiceNumber: string; fiscalYear: string }> {
    const { fy, startYear } = InvoiceNumberingService.fiscalYearFor(now);
    if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 9999) {
      throw new Error(
        `InvoiceNumberingService: refusing to allocate for implausible FY ${fy}`,
      );
    }

    const seq = `invoice_number_seq_${startYear}`;
    const value = tx
      ? await this.allocate(tx, startYear, seq)
      : await this.prisma.client.$transaction((t) =>
          this.allocate(t, startYear, seq),
        );

    const serial = String(value).padStart(6, '0');
    return { invoiceNumber: `SD/INV/${fy}/${serial}`, fiscalYear: fy };
  }

  private async allocate(
    client: Prisma.TransactionClient,
    startYear: number,
    seq: string,
  ): Promise<number> {
    await client.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      InvoiceNumberingService.LOCK_NAMESPACE,
      startYear,
    );
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}"`);
    const rows = await client.$queryRawUnsafe<Array<{ value: bigint }>>(
      `SELECT nextval('"${seq}"') AS value`,
    );
    const raw = rows[0]?.value;
    if (raw === undefined) {
      this.logger.error(`nextval returned no row for sequence ${seq}`);
      throw new Error(
        `InvoiceNumberingService: nextval produced no value for ${seq}`,
      );
    }
    return Number(raw);
  }
}
