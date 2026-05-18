import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Module 8 — shipment-number allocation. Mirrors ORD-8's
 * `OrderNumberingService` exactly (per-year Postgres SEQUENCE +
 * txn-scoped advisory lock for the lazy CREATE; gaps are fine —
 * `shipments.shipment_number` is `@unique`, uniqueness not contiguity is
 * the contract).
 *
 * Format: `SH-YYYY-MM-XXXXXX` (matches the db-schema example
 * `SH-2026-05-000001`): YYYY UTC year, MM 2-digit UTC month, XXXXXX
 * zero-padded value from `shipment_number_seq_<YYYY>`.
 */
@Injectable()
export class ShipmentNumberingService {
  private readonly logger = new Logger(ShipmentNumberingService.name);

  /** Advisory-lock namespace for shipment numbering — distinct from
   *  OrderNumberingService's 0x04f52 ('OR'). 0x05348 = 'SH'. */
  private static readonly LOCK_NAMESPACE = 0x0_53_48;

  constructor(private readonly prisma: PrismaService) {}

  async nextShipmentNumber(
    tx?: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<string> {
    const year = now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new Error(
        `ShipmentNumberingService: refusing to allocate for implausible year ${year}`,
      );
    }
    const month = now.getUTCMonth() + 1;
    const seq = `shipment_number_seq_${year}`;
    const value = tx
      ? await this.allocate(tx, year, seq)
      : await this.prisma.client.$transaction((t) =>
          this.allocate(t, year, seq),
        );

    const mm = String(month).padStart(2, '0');
    const serial = String(value).padStart(6, '0');
    return `SH-${year}-${mm}-${serial}`;
  }

  private async allocate(
    client: Prisma.TransactionClient,
    year: number,
    seq: string,
  ): Promise<number> {
    await client.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::int, $2::int)',
      ShipmentNumberingService.LOCK_NAMESPACE,
      year,
    );
    // `seq` is `shipment_number_seq_<4-digit-int>` — no user input.
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}"`);
    const rows = await client.$queryRawUnsafe<Array<{ value: bigint }>>(
      `SELECT nextval('"${seq}"') AS value`,
    );
    const raw = rows[0]?.value;
    if (raw === undefined) {
      this.logger.error(`nextval returned no row for sequence ${seq}`);
      throw new Error(
        `ShipmentNumberingService: nextval produced no value for ${seq}`,
      );
    }
    return Number(raw);
  }
}
