import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { CourierWaybillStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';

const COURIER_CODE = 'delhivery';
const LOW_WATER_SETTING = 'courier.delhivery_waybill_pool_low_water';
const REFILL_BATCH_SETTING = 'courier.delhivery_waybill_pool_refill_batch';
const SETTLE_SECONDS_SETTING = 'courier.delhivery_waybill_settle_seconds';

const DEFAULT_LOW_WATER = 200;
const DEFAULT_REFILL_BATCH = 500;
const DEFAULT_SETTLE_SECONDS = 120;

export interface PoolStats {
  readonly available: number;
  readonly usableNow: number;
  readonly assigned: number;
  readonly used: number;
  readonly void: number;
}

/**
 * The AWB pool.
 *
 * ── WHY A POOL AND NOT A FETCH-PER-SHIPMENT ──────────────────────────
 * Two hard constraints from Delhivery, both verified against production
 * on 2026-07-27:
 *
 *  1. The bulk endpoint allows **five requests per five minutes**. A
 *     fetch per shipment would throttle us out of business on any real
 *     volume — and a WAF 403 blocks our whole egress IP, taking live
 *     traffic with it.
 *  2. Their docs warn that a waybill used immediately after being
 *     fetched "may occasionally result in errors", because numbers are
 *     minted in batches of 25 behind the scenes. So a freshly-fetched
 *     number is not immediately trustworthy — hence `usableAfter`.
 *
 * The response is also not what you would guess: a bare JSON **string**,
 * comma-separated for multiples (`"3806…262"`, `"3806…273,3806…284"`),
 * not an array.
 *
 * ── CLAIMING ──────────────────────────────────────────────────────────
 * `claim()` uses `FOR UPDATE SKIP LOCKED LIMIT 1` — the same
 * Postgres-native pattern as the pick and pack queues (WMS-2). Two
 * concurrent manifests can never be handed the same AWB, which would put
 * two parcels on one tracking identity.
 */
@Injectable()
export class DelhiveryWaybillPoolService {
  private readonly logger = new Logger(DelhiveryWaybillPoolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  /**
   * Take one AWB for a shipment. Throws when the pool is dry rather than
   * fetching inline — an empty pool is an ops problem (the refill cron
   * has stalled), and blocking a manifest on a rate-limited network call
   * would turn one stall into a queue-wide one.
   */
  async claim(shipmentId: string): Promise<string> {
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string; awb_number: string }>>`
      SELECT id, awb_number
        FROM courier_waybills
       WHERE courier_code = ${COURIER_CODE}
         AND status = 'available'
         AND usable_after <= NOW()
       ORDER BY fetched_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      const stats = await this.stats();
      throw new ConflictException({
        code: 'WAYBILL_POOL_EMPTY',
        message:
          `No usable Delhivery waybill available (${stats.available} in pool, ` +
          `${stats.usableNow} settled). The refill job may have stalled — ` +
          `Delhivery allows only 5 bulk fetches per 5 minutes, so this cannot ` +
          `be resolved inline.`,
        cause: stats,
      });
    }

    await this.prisma.client.courierWaybill.update({
      where: { id: row.id },
      data: {
        status: CourierWaybillStatus.ASSIGNED,
        assignedAt: new Date(),
        shipmentId,
      },
    });
    return row.awb_number;
  }

  /** Confirm the AWB actually made it onto a manifested shipment. */
  async markUsed(awbNumber: string): Promise<void> {
    await this.prisma.client.courierWaybill.updateMany({
      where: { awbNumber, status: CourierWaybillStatus.ASSIGNED },
      data: { status: CourierWaybillStatus.USED },
    });
  }

  /**
   * Retire an AWB the courier rejected. Deliberately NOT a return to the
   * pool: Delhivery may have partially registered it, and re-issuing a
   * number that already means something is worse than wasting one.
   */
  async void(awbNumber: string, reason: string): Promise<void> {
    await this.prisma.client.courierWaybill.updateMany({
      where: { awbNumber, status: { not: CourierWaybillStatus.USED } },
      data: {
        status: CourierWaybillStatus.VOID,
        voidedAt: new Date(),
        voidReason: reason.slice(0, 500),
      },
    });
    this.logger.warn({ awbNumber, reason }, 'Delhivery waybill voided — never re-issued');
  }

  /**
   * Top the pool up if it is below the low-water mark. Returns how many
   * numbers were added.
   *
   * Consuming AWB numbers is gated by the write guard: it draws on the
   * account's real allocation, and a runaway loop here would burn through
   * it.
   */
  async refillIfNeeded(): Promise<{ fetched: number; poolAfter: number }> {
    const [lowWater, batch, settleSeconds] = await Promise.all([
      this.intSetting(LOW_WATER_SETTING, DEFAULT_LOW_WATER),
      this.intSetting(REFILL_BATCH_SETTING, DEFAULT_REFILL_BATCH),
      this.intSetting(SETTLE_SECONDS_SETTING, DEFAULT_SETTLE_SECONDS),
    ]);

    const available = await this.prisma.client.courierWaybill.count({
      where: { courierCode: COURIER_CODE, status: CourierWaybillStatus.AVAILABLE },
    });
    if (available >= lowWater) return { fetched: 0, poolAfter: available };

    if (await this.http.isStubMode()) {
      // Stub mode mints local numbers so the whole manifest path can be
      // exercised without a network.
      const stub = Array.from({ length: Math.min(batch, 25) }, () =>
        `STUB${Math.floor(Math.random() * 1e12).toString().padStart(12, '0')}`,
      );
      const added = await this.store(stub, settleSeconds);
      return { fetched: added, poolAfter: available + added };
    }

    await this.writeGuard.assertWritable('waybill.fetch', {
      requested: batch,
      poolBefore: available,
    });

    const raw = await this.http.request<string | string[]>({
      method: 'GET',
      path: `/waybill/api/bulk/json/?count=${batch}`,
      endpoint: 'waybill_bulk',
    });

    const numbers = this.parseWaybillResponse(raw);
    if (numbers.length === 0) {
      this.logger.error(
        { raw: typeof raw === 'string' ? raw.slice(0, 200) : raw },
        'Delhivery bulk waybill returned nothing parseable',
      );
      return { fetched: 0, poolAfter: available };
    }

    const added = await this.store(numbers, settleSeconds);
    this.logger.log(
      { requested: batch, returned: numbers.length, stored: added, poolAfter: available + added },
      'Delhivery waybill pool refilled',
    );
    return { fetched: added, poolAfter: available + added };
  }

  async stats(): Promise<PoolStats> {
    const grouped = await this.prisma.client.courierWaybill.groupBy({
      by: ['status'],
      where: { courierCode: COURIER_CODE },
      _count: { _all: true },
    });
    const by = (s: CourierWaybillStatus): number =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;
    const usableNow = await this.prisma.client.courierWaybill.count({
      where: {
        courierCode: COURIER_CODE,
        status: CourierWaybillStatus.AVAILABLE,
        usableAfter: { lte: new Date() },
      },
    });
    return {
      available: by(CourierWaybillStatus.AVAILABLE),
      usableNow,
      assigned: by(CourierWaybillStatus.ASSIGNED),
      used: by(CourierWaybillStatus.USED),
      void: by(CourierWaybillStatus.VOID),
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /**
   * The response is a bare JSON string, comma-separated for multiples —
   * verified against production. An array is accepted too, in case the
   * shape ever changes under us.
   */
  parseWaybillResponse(raw: string | string[]): string[] {
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    return list
      .map((w) => String(w).trim().replace(/^"|"$/g, ''))
      .filter((w) => w.length > 0);
  }

  private async store(numbers: string[], settleSeconds: number): Promise<number> {
    const usableAfter = new Date(Date.now() + settleSeconds * 1000);
    // skipDuplicates: re-fetching a number we already hold must not throw
    // away the whole batch.
    const res = await this.prisma.client.courierWaybill.createMany({
      data: numbers.map((awbNumber) => ({
        courierCode: COURIER_CODE,
        awbNumber,
        usableAfter,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  private async intSetting(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    const n = row?.valueInt ?? null;
    return n !== null && n > 0 ? n : fallback;
  }
}

/** Narrow on a dry pool without reaching for the error's internals. */
export const isPoolEmptyError = (e: unknown): boolean =>
  e instanceof ConflictException &&
  (e.getResponse() as { code?: string })?.code === 'WAYBILL_POOL_EMPTY';
