import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Module 8 — manifest-number allocation. Mirrors `ShipmentNumberingService`
 * (commit 3) and ORD-8 exactly: per-year Postgres SEQUENCE +
 * txn-scoped advisory lock for the lazy CREATE. Gaps are fine —
 * `manifests.manifest_number` is `@unique`; uniqueness, not contiguity,
 * is the contract.
 *
 * Format: `MF-YYYY-MM-XXXXXX` (MM = 2-digit UTC month, matching the
 * SH-YYYY-MM-XXXXXX shipment format — the db-schema "NN" notation reads
 * as "two digits"; we adopt MM for consistency with the existing
 * numbering services).
 */
@Injectable()
export class PickBatchNumberingService {
  private readonly logger = new Logger(PickBatchNumberingService.name);

  /** Advisory-lock namespace, distinct from Order (0x04f52) and
   *  Shipment (0x05348). 0x04d46 = 'MF'. */
  private static readonly LOCK_NAMESPACE = 0x0_50_42;

  constructor(private readonly prisma: PrismaService) {}

  async nextBatchNumber(tx?: Prisma.TransactionClient, now: Date = new Date()): Promise<string> {
    const year = now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new Error(
        `PickBatchNumberingService: refusing to allocate for implausible year ${year}`,
      );
    }
    const month = now.getUTCMonth() + 1;
    const seq = `pick_batch_number_seq_${year}`;
    const value = tx
      ? await this.allocate(tx, year, seq)
      : await this.prisma.client.$transaction((t) => this.allocate(t, year, seq));

    const mm = String(month).padStart(2, '0');
    const serial = String(value).padStart(6, '0');
    return `PB-${year}-${mm}-${serial}`;
  }

  private async allocate(
    client: Prisma.TransactionClient,
    year: number,
    seq: string,
  ): Promise<number> {
    await client.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      PickBatchNumberingService.LOCK_NAMESPACE,
      year,
    );
    // `seq` is `pick_batch_number_seq_<4-digit-int>` — no user input.
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}"`);
    const rows = await client.$queryRawUnsafe<Array<{ value: bigint }>>(
      `SELECT nextval('"${seq}"') AS value`,
    );
    const raw = rows[0]?.value;
    if (raw === undefined) {
      this.logger.error(`nextval returned no row for sequence ${seq}`);
      throw new Error(`PickBatchNumberingService: nextval produced no value for ${seq}`);
    }
    return Number(raw);
  }
}
