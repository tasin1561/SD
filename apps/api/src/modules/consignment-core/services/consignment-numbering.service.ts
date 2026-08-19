import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock } from '../../../common/db/advisory-lock';

/**
 * `CN-YYYY-MM-XXXXXX`. Mirrors ORD-8 / `ShipmentNumberingService` exactly:
 * a per-year Postgres SEQUENCE created lazily under a txn-scoped advisory
 * lock, allocated INSIDE the caller's transaction.
 *
 * Gaps are fine. `consignments.consignment_number` is `@unique`, and
 * uniqueness rather than contiguity is the contract — a rolled-back
 * declaration must not be able to hand its number to the next one.
 */
@Injectable()
export class ConsignmentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async nextConsignmentNumber(
    tx?: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<string> {
    const year = now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new Error(
        `ConsignmentNumberingService: refusing to allocate for implausible year ${year}`,
      );
    }
    const seq = `consignment_number_seq_${year}`;
    const value = tx
      ? await this.allocate(tx, year, seq)
      : await this.prisma.client.$transaction((t) => this.allocate(t, year, seq));

    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `CN-${year}-${mm}-${String(value).padStart(6, '0')}`;
  }

  private async allocate(
    client: Prisma.TransactionClient,
    year: number,
    seq: string,
  ): Promise<number> {
    // The lock covers the CREATE-if-absent, which is not itself atomic
    // against a concurrent CREATE. nextval afterwards needs no lock.
    await client.$executeRaw`SELECT pg_advisory_xact_lock(${AdvisoryLock.CONSIGNMENT_NUMBER}::int, ${year}::int)`;
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seq}" START 1`);
    const rows = await client.$queryRawUnsafe<Array<{ v: bigint }>>(
      `SELECT nextval('"${seq}"') AS v`,
    );
    const v = rows[0]?.v;
    if (v === undefined) throw new Error(`ConsignmentNumberingService: ${seq} returned no value`);
    return Number(v);
  }
}
