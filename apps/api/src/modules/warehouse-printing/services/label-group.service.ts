import { createHash } from 'node:crypto';
import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { LabelPrintService, type LabelSheetResult } from './label-print.service';
import { PickBatchService } from './pick-batch.service';
import { PrintQueueService, type PrintQueueRow } from './print-queue.service';

export const PRINT_GROUP_SIZE_SETTING = 'warehouse.print_group_size';
export const DEFAULT_PRINT_GROUP_SIZE = 30;
const MIN_GROUP_SIZE = 1;
const MAX_GROUP_SIZE = 200;

const RUNNING = '__running__';
const TTL_SECONDS = 24 * 60 * 60;

export interface LabelGroup {
  /** Stable for the same contents: courier + warehouse + first parcel. */
  readonly key: string;
  readonly courierCode: string;
  readonly courierName: string;
  readonly warehouseId: string;
  /** e.g. "Delhivery · Group 2". */
  readonly label: string;
  readonly size: number;
  /** Oldest order first. */
  readonly shipmentIds: readonly string[];
  readonly oldestPlacedAt: string | null;
}

export interface LabelGroupList {
  /** The parcels-per-group setting in force. */
  readonly groupSize: number;
  readonly totalParcels: number;
  readonly groups: readonly LabelGroup[];
}

export interface LabelGroupPrintResult {
  readonly batchId: string;
  readonly batchNumber: string;
  /** Null on an idempotent replay — the first response carried the file. */
  readonly pdfBase64: string | null;
  readonly fileName: string | null;
  readonly shipmentCount: number;
  readonly pageCount: number;
  readonly failed: LabelSheetResult['failed'];
  readonly replayed: boolean;
}

type StoredResult = Omit<LabelGroupPrintResult, 'pdfBase64' | 'replayed'>;

function titleCase(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Courier first (A to Z), then warehouse, then OLDEST order first. */
export function compareForGroups(a: PrintQueueRow, b: PrintQueueRow): number {
  const c = a.courierName.localeCompare(b.courierName);
  if (c !== 0) return c;
  const w = a.warehouseId.localeCompare(b.warehouseId);
  if (w !== 0) return w;
  const ta = a.placedAtIso ?? a.confirmedAtIso ?? '';
  const tb = b.placedAtIso ?? b.confirmedAtIso ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.shipmentNumber.localeCompare(b.shipmentNumber);
}

/** Pure: cut rows into groups of `size`. */
export function buildGroups(rows: readonly PrintQueueRow[], size: number): LabelGroup[] {
  const sorted = [...rows].sort(compareForGroups);
  const buckets = new Map<string, PrintQueueRow[]>();
  for (const r of sorted) {
    const k = `${r.courierName}\u0000${r.warehouseId}`;
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [r]);
    else list.push(r);
  }
  const out: LabelGroup[] = [];
  for (const list of buckets.values()) {
    const first = list[0];
    if (first === undefined) continue;
    let n = 0;
    for (let i = 0; i < list.length; i += size) {
      n += 1;
      const chunk = list.slice(i, i + size);
      const head = chunk[0] ?? first;
      out.push({
        key: `${head.courierCode}:${head.warehouseId}:${head.shipmentId}`,
        courierCode: first.courierCode,
        courierName: first.courierName,
        warehouseId: first.warehouseId,
        label: `${titleCase(first.courierName)} · Group ${n}`,
        size: chunk.length,
        shipmentIds: chunk.map((r) => r.shipmentId),
        oldestPlacedAt: head.placedAtIso ?? head.confirmedAtIso,
      });
    }
  }
  return out;
}

/**
 * Automatic label groups, and "print the groups I ticked".
 *
 * Groups are computed LIVE from the not-yet-printed pool (a parcel on a
 * batch, or with its label confirmed, is not in it), so there is no table.
 * Printing several groups is ONE walk: one pick batch for all parcels and
 * one merged label PDF, each label tagged "<batch> · <i>/<total>".
 */
@Injectable()
export class LabelGroupService {
  private readonly log = new Logger(LabelGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queues: PrintQueueService,
    private readonly labels: LabelPrintService,
    private readonly batches: PickBatchService,
  ) {}

  async groupSize(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: PRINT_GROUP_SIZE_SETTING },
      select: { valueInt: true },
    });
    const v = row?.valueInt;
    if (v === null || v === undefined || !Number.isFinite(v)) return DEFAULT_PRINT_GROUP_SIZE;
    return Math.min(MAX_GROUP_SIZE, Math.max(MIN_GROUP_SIZE, Math.trunc(v)));
  }

  async list(warehouseId?: string): Promise<LabelGroupList> {
    const [size, rows] = await Promise.all([this.groupSize(), this.queues.labelPool(warehouseId)]);
    return { groupSize: size, totalParcels: rows.length, groups: buildGroups(rows, size) };
  }

  async print(
    input: { readonly shipmentIds: readonly string[]; readonly idempotencyKey: string },
    staffId: string,
    ctx?: ClientContext,
  ): Promise<LabelGroupPrintResult> {
    const ids = [...new Set(input.shipmentIds)];
    const digest = createHash('sha256')
      .update([...ids].sort().join(','))
      .digest('hex')
      .slice(0, 24);
    const key = `label-groups:v1:${staffId}:${input.idempotencyKey}:${digest}`;

    let claimed: string | null;
    try {
      claimed = await this.redis.client.set(key, RUNNING, 'EX', TTL_SECONDS, 'NX');
    } catch (err) {
      this.log.error(`label-group idempotency store unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'LABEL_GROUPS_UNAVAILABLE',
        message: 'Group printing is unavailable right now. Try again shortly.',
      });
    }
    if (claimed === null) {
      const stored = await this.redis.client.get(key).catch(() => null);
      if (stored === null || stored === RUNNING) {
        throw new ConflictException({
          code: 'LABEL_GROUPS_IN_PROGRESS',
          message: 'This print is already running. Its result will appear when it finishes.',
        });
      }
      const r = JSON.parse(stored) as StoredResult;
      return { ...r, pdfBase64: null, replayed: true };
    }

    try {
      const result = await this.run(ids, staffId, ctx);
      const toStore: StoredResult = {
        batchId: result.batchId,
        batchNumber: result.batchNumber,
        fileName: result.fileName,
        shipmentCount: result.shipmentCount,
        pageCount: result.pageCount,
        failed: result.failed,
      };
      await this.redis.client
        .set(key, JSON.stringify(toStore), 'EX', TTL_SECONDS)
        .catch((err: unknown) =>
          this.log.warn(`label-group result not stored: ${(err as Error).message}`),
        );
      return result;
    } catch (err) {
      // Nothing was produced: free the key so the operator can click again.
      await this.redis.client.del(key).catch(() => undefined);
      throw err;
    }
  }

  private async run(
    ids: readonly string[],
    staffId: string,
    ctx?: ClientContext,
  ): Promise<LabelGroupPrintResult> {
    const pool = await this.queues.labelPool();
    const byId = new Map(pool.map((r) => [r.shipmentId, r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'NOT_IN_LABEL_POOL',
        message:
          `${missing.length} of the selected parcels are no longer waiting for a label ` +
          '(already printed or on a batch). Refresh the groups and choose again.',
      });
    }
    // Group order, then oldest first: the order the stack comes off the printer.
    const ordered = ids
      .map((id) => byId.get(id) as PrintQueueRow)
      .sort(compareForGroups)
      .map((r) => r.shipmentId);

    const batch = await this.batches.create(ordered, staffId, ctx, { skipLabelGate: true });
    let sheet: LabelSheetResult;
    try {
      const tags = new Map(
        ordered.map((id, i) => [id, `${batch.batchNumber} · ${i + 1}/${ordered.length}`] as const),
      );
      sheet = await this.labels.build(ordered, staffId, { tags });
      if (sheet.shipmentCount === 0) {
        throw new ConflictException({
          code: 'NO_LABELS_BUILT',
          message: 'No label could be produced for the selected parcels.',
        });
      }
    } catch (err) {
      // A batch with no labels behind it would hold parcels for nothing.
      await this.batches.cancel(batch.id, staffId, ctx).catch((e: unknown) => {
        this.log.error(`could not cancel batch ${batch.batchNumber}: ${(e as Error).message}`);
      });
      throw err;
    }
    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      pdfBase64: sheet.pdfBase64,
      fileName: sheet.fileName,
      shipmentCount: sheet.shipmentCount,
      pageCount: sheet.pageCount,
      failed: sheet.failed,
      replayed: false,
    };
  }
}
