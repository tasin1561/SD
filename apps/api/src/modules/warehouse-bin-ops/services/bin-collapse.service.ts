import { createHash, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType, StockMovementType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { BinPolicyService } from '../../inventory-shared/bin-policy.service';
import { FLOOR_BIN_CODE } from '../../inventory-warehouse/bin-code';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Collapsing a warehouse back to one location.
 *
 * Turning location tracking off is a toggle and moves nothing. THIS is
 * the destructive half, kept deliberately separate: it merges every
 * bin's contents into FLOOR, and once merged the original placement
 * exists only in the snapshot taken alongside. Making it a side effect
 * of the toggle would mean a misclick costs a warehouse's worth of
 * putaway work.
 *
 * ── Why a merge and not an UPDATE ─────────────────────────────────────
 * `stock_levels` is unique on (seller, variant, warehouse, bin, batch).
 * The obvious `UPDATE stock_levels SET bin_id = floor` hits that unique
 * the moment two bins hold the same variant+batch — which after any real
 * trading period is most of them. So each source row is moved as a
 * paired TRANSFER_OUT/TRANSFER_IN through the sole stock writer (INV-1)
 * and the quantities accumulate in FLOOR.
 *
 * ── Ordering ──────────────────────────────────────────────────────────
 * Snapshot FIRST, collapse SECOND — the visible-vs-silent rule this
 * codebase applies everywhere. A crash between the two leaves a complete
 * backup and an untouched warehouse. The reverse ordering would leave a
 * half-collapsed warehouse and no record of what it had been.
 *
 * ── Why hold/damaged/quarantine bins are left alone ───────────────────
 * Those are not about FINDING stock, they are about not selling it.
 * Sweeping a damaged bin into FLOOR would put broken goods back in the
 * pickable pool — the same class of error as counting them as available
 * in the first place.
 */

const RETENTION_SETTING_KEY = 'ops.bin_snapshot_retention_months';
/** Seeded default when the settings row is absent. */
const DEFAULT_RETENTION_MONTHS = 3;
const CHALLENGE_TTL_MINUTES = 10;
const MAX_CHALLENGE_ATTEMPTS = 5;
const MIN_REASON_LENGTH = 30;

export interface RequestCollapseResult {
  readonly challengeId: string;
  readonly expiresAt: Date;
  readonly sentToEmail: string;
  readonly binsAffected: number;
  readonly unitsAffected: number;
}

export interface CollapseResult {
  readonly warehouseId: string;
  readonly snapshotId: string;
  readonly binsCollapsed: number;
  readonly rowsMoved: number;
  readonly unitsMoved: number;
}

export interface RestoreResult {
  readonly snapshotId: string;
  readonly restoredLines: number;
  readonly skippedLines: ReadonlyArray<{ binCode: string; variantId: string; why: string }>;
}

@Injectable()
export class BinCollapseService {
  private readonly logger = new Logger(BinCollapseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly mutation: StockMutationService,
    private readonly binPolicy: BinPolicyService,
  ) {}

  /**
   * Step 1 of 2. Records intent, tells the operator what it would cost,
   * and mails a code.
   *
   * The counts are returned BEFORE anything happens on purpose — "this
   * will merge 47 bins holding 1,203 units" is the sentence that stops
   * the wrong person continuing.
   */
  async requestCollapse(
    warehouseId: string,
    staffId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<RequestCollapseResult> {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      throw new BadRequestException({
        code: 'COLLAPSE_REASON_TOO_SHORT',
        message: `Give a reason of at least ${MIN_REASON_LENGTH} characters — this is the only explanation anyone will have later`,
      });
    }
    const warehouse = await this.requireWarehouse(warehouseId);
    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: staffId, deletedAt: null },
      select: { id: true, email: true, emailDisplay: true },
    });
    if (!staff) {
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Staff user not found' });
    }

    const { rows } = await this.collectSourceRows(warehouseId);
    const binsAffected = new Set(rows.map((r) => r.binId)).size;
    const unitsAffected = rows.reduce((n, r) => n + r.qtyOnHand, 0);

    // A six-digit code: long enough that guessing inside five attempts is
    // hopeless, short enough to read off a phone.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60_000);

    const challenge = await this.prisma.client.binCollapseChallenge.create({
      data: {
        warehouseId,
        staffUserId: staffId,
        codeHash: this.hash(code),
        reason: reason.trim(),
        expiresAt,
      },
      select: { id: true },
    });

    await this.email.enqueue({
      templateCode: 'staff.bin_collapse_challenge.email',
      recipient: { type: NotificationRecipientType.STAFF, id: staffId, email: staff.email },
      variables: {
        staff_name: staff.emailDisplay,
        warehouse_code: warehouse.code,
        warehouse_name: warehouse.name,
        code,
        bins_affected: String(binsAffected),
        units_affected: String(unitsAffected),
        expires_minutes: String(CHALLENGE_TTL_MINUTES),
        reason: reason.trim(),
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'warehouse.bin_collapse.requested',
      entityType: 'warehouse',
      entityId: warehouseId,
      severity: 'HIGH',
      metadata: {
        challengeId: challenge.id,
        binsAffected,
        unitsAffected,
        reason: reason.trim(),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
      },
    });

    return {
      challengeId: challenge.id,
      expiresAt,
      sentToEmail: staff.email,
      binsAffected,
      unitsAffected,
    };
  }

  /**
   * Step 2 of 2. Verifies the code and the typed warehouse code, takes
   * the snapshot, then merges.
   */
  async confirmCollapse(
    warehouseId: string,
    staffId: string,
    input: { challengeId: string; code: string; typedWarehouseCode: string },
    ctx?: ClientContext,
  ): Promise<CollapseResult> {
    const warehouse = await this.requireWarehouse(warehouseId);
    if (input.typedWarehouseCode.trim().toUpperCase() !== warehouse.code.toUpperCase()) {
      throw new BadRequestException({
        code: 'WAREHOUSE_CODE_MISMATCH',
        message: `Type the warehouse code exactly (${warehouse.code}) to confirm`,
      });
    }

    // Claim the challenge INSIDE a guarded update. A read-then-write
    // check would let two tabs both pass and collapse twice.
    const claimed = await this.prisma.client.binCollapseChallenge.updateMany({
      where: {
        id: input.challengeId,
        warehouseId,
        staffUserId: staffId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
        codeHash: this.hash(input.code.trim()),
      },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Burn an attempt whether or not the id was real, so a wrong code
      // and a wrong id are indistinguishable from outside.
      await this.prisma.client.binCollapseChallenge.updateMany({
        where: { id: input.challengeId, warehouseId, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: staffId,
        action: 'warehouse.bin_collapse.challenge_failed',
        entityType: 'warehouse',
        entityId: warehouseId,
        severity: 'HIGH',
        metadata: { challengeId: input.challengeId, ipAddress: ctx?.ipAddress },
      });
      throw new ConflictException({
        code: 'COLLAPSE_CHALLENGE_INVALID',
        message: 'That code is wrong, expired, or already used. Request a new one.',
      });
    }
    const challenge = await this.prisma.client.binCollapseChallenge.findUniqueOrThrow({
      where: { id: input.challengeId },
      select: { reason: true },
    });

    // ── Snapshot FIRST. ────────────────────────────────────────────────
    const { rows, floorBinId } = await this.collectSourceRows(warehouseId);
    const snapshot = await this.takeSnapshot(warehouseId, staffId, challenge.reason, rows);

    // ── Then merge, row by row through the sole stock writer. ──────────
    let rowsMoved = 0;
    let unitsMoved = 0;
    for (const row of rows) {
      await this.mutation.runWithRetry(async (tx) => {
        await this.mutation.apply(tx, {
          sellerId: row.sellerId,
          variantId: row.variantId,
          warehouseId,
          binId: row.binId,
          batchId: row.batchId,
          qtyChange: -row.qtyOnHand,
          type: StockMovementType.TRANSFER_OUT,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Bin collapse — ${row.binCode} → ${FLOOR_BIN_CODE}`,
        });
        await this.mutation.apply(tx, {
          sellerId: row.sellerId,
          variantId: row.variantId,
          warehouseId,
          binId: floorBinId,
          batchId: row.batchId,
          qtyChange: row.qtyOnHand,
          type: StockMovementType.TRANSFER_IN,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Bin collapse — ${row.binCode} → ${FLOOR_BIN_CODE}`,
        });
      });
      rowsMoved += 1;
      unitsMoved += row.qtyOnHand;
    }

    const binsCollapsed = new Set(rows.map((r) => r.binId)).size;
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'warehouse.bin_collapse.executed',
      entityType: 'warehouse',
      entityId: warehouseId,
      severity: 'CRITICAL',
      metadata: {
        snapshotId: snapshot.id,
        binsCollapsed,
        rowsMoved,
        unitsMoved,
        reason: challenge.reason,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
      },
    });

    return {
      warehouseId,
      snapshotId: snapshot.id,
      binsCollapsed,
      rowsMoved,
      unitsMoved,
    };
  }

  /**
   * Put a snapshot back.
   *
   * Best-effort per line, and honestly so: stock sells, gets adjusted and
   * gets received between the snapshot and the restore, so a line whose
   * units are no longer in FLOOR cannot be put back and is reported
   * rather than forced. A restore is a strong head start, not a rewind.
   */
  async restore(snapshotId: string, staffId: string, ctx?: ClientContext): Promise<RestoreResult> {
    const snapshot = await this.prisma.client.binLayoutSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        warehouseId: true,
        lines: {
          select: {
            sellerId: true,
            variantId: true,
            binId: true,
            binCode: true,
            batchId: true,
            qtyOnHand: true,
          },
        },
      },
    });
    if (!snapshot) {
      throw new NotFoundException({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'That snapshot no longer exists — it may have passed its retention window',
      });
    }
    const floorBinId = await this.binPolicy.floorBinId(snapshot.warehouseId);

    let restoredLines = 0;
    const skipped: Array<{ binCode: string; variantId: string; why: string }> = [];

    for (const line of snapshot.lines) {
      const bin = await this.prisma.client.warehouseBin.findFirst({
        where: { id: line.binId, deletedAt: null },
        select: { id: true },
      });
      if (!bin) {
        skipped.push({
          binCode: line.binCode,
          variantId: line.variantId,
          why: 'the bin has since been removed',
        });
        continue;
      }
      const floorLevel = await this.prisma.client.stockLevel.findFirst({
        where: {
          sellerId: line.sellerId,
          variantId: line.variantId,
          warehouseId: snapshot.warehouseId,
          binId: floorBinId,
          batchId: line.batchId,
        },
        select: { qtyOnHand: true },
      });
      const availableInFloor = floorLevel?.qtyOnHand ?? 0;
      if (availableInFloor <= 0) {
        skipped.push({
          binCode: line.binCode,
          variantId: line.variantId,
          why: 'those units are no longer in FLOOR — sold, adjusted or already moved',
        });
        continue;
      }
      // Move back only what is actually still there.
      const qty = Math.min(availableInFloor, line.qtyOnHand);
      await this.mutation.runWithRetry(async (tx) => {
        await this.mutation.apply(tx, {
          sellerId: line.sellerId,
          variantId: line.variantId,
          warehouseId: snapshot.warehouseId,
          binId: floorBinId,
          batchId: line.batchId,
          qtyChange: -qty,
          type: StockMovementType.TRANSFER_OUT,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Bin layout restore — ${FLOOR_BIN_CODE} → ${line.binCode}`,
        });
        await this.mutation.apply(tx, {
          sellerId: line.sellerId,
          variantId: line.variantId,
          warehouseId: snapshot.warehouseId,
          binId: line.binId,
          batchId: line.batchId,
          qtyChange: qty,
          type: StockMovementType.TRANSFER_IN,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reasonCode: null,
          reason: `Bin layout restore — ${FLOOR_BIN_CODE} → ${line.binCode}`,
        });
      });
      restoredLines += 1;
      if (qty < line.qtyOnHand) {
        skipped.push({
          binCode: line.binCode,
          variantId: line.variantId,
          why: `only ${qty} of ${line.qtyOnHand} were still in FLOOR`,
        });
      }
    }

    await this.prisma.client.binLayoutSnapshot.update({
      where: { id: snapshotId },
      data: { restoredAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'warehouse.bin_layout.restored',
      entityType: 'warehouse',
      entityId: snapshot.warehouseId,
      severity: 'HIGH',
      metadata: {
        snapshotId,
        restoredLines,
        skippedCount: skipped.length,
        ipAddress: ctx?.ipAddress,
        requestId: ctx?.requestId,
      },
    });

    return { snapshotId, restoredLines, skippedLines: skipped };
  }

  async listSnapshots(warehouseId: string): Promise<
    Array<{
      id: string;
      reason: string;
      lineCount: number;
      totalQty: number;
      restoredAt: Date | null;
      expiresAt: Date;
      createdAt: Date;
    }>
  > {
    return this.prisma.client.binLayoutSnapshot.findMany({
      where: { warehouseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        lineCount: true,
        totalQty: true,
        restoredAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  /** Snapshots past their retention window. Swept by the cron. */
  async purgeExpiredSnapshots(): Promise<number> {
    const res = await this.prisma.client.binLayoutSnapshot.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (res.count > 0) {
      this.logger.log(`Purged ${res.count} expired bin layout snapshot(s)`);
    }
    return res.count;
  }

  // ── internal ──────────────────────────────────────────────────────

  private hash(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  private async requireWarehouse(
    warehouseId: string,
  ): Promise<{ id: string; code: string; name: string }> {
    const w = await this.prisma.client.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });
    if (!w) {
      throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' });
    }
    return w;
  }

  /**
   * Everything that would move: stock in a real bin that is neither
   * FLOOR nor a hold/damaged/quarantine bin.
   */
  private async collectSourceRows(warehouseId: string): Promise<{
    rows: Array<{
      sellerId: string;
      variantId: string;
      binId: string;
      binCode: string;
      batchId: string;
      qtyOnHand: number;
    }>;
    floorBinId: string;
  }> {
    const floorBinId = await this.binPolicy.floorBinId(warehouseId);
    const levels = await this.prisma.client.stockLevel.findMany({
      where: {
        warehouseId,
        qtyOnHand: { gt: 0 },
        binId: { not: floorBinId },
        // Hold, damaged and quarantine bins are about not SELLING stock,
        // not about finding it. Sweeping them into FLOOR would put
        // broken and untriaged goods back into the pickable pool.
        bin: { type: { notIn: ['RTO_HOLD', 'DAMAGED', 'QUARANTINE'] }, deletedAt: null },
      },
      select: {
        sellerId: true,
        variantId: true,
        binId: true,
        batchId: true,
        qtyOnHand: true,
        bin: { select: { code: true } },
      },
    });
    return {
      floorBinId,
      rows: levels.map((l) => ({
        sellerId: l.sellerId,
        variantId: l.variantId,
        binId: l.binId,
        binCode: l.bin.code,
        batchId: l.batchId,
        qtyOnHand: l.qtyOnHand,
      })),
    };
  }

  private async takeSnapshot(
    warehouseId: string,
    staffId: string,
    reason: string,
    rows: ReadonlyArray<{
      sellerId: string;
      variantId: string;
      binId: string;
      binCode: string;
      batchId: string;
      qtyOnHand: number;
    }>,
  ): Promise<{ id: string }> {
    const months = await this.retentionMonths();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + months);

    return this.prisma.client.$transaction(async (tx) => {
      const snap = await tx.binLayoutSnapshot.create({
        data: {
          warehouseId,
          reason,
          takenByStaffId: staffId,
          lineCount: rows.length,
          totalQty: rows.reduce((n, r) => n + r.qtyOnHand, 0),
          expiresAt,
        },
        select: { id: true },
      });
      if (rows.length > 0) {
        await tx.binLayoutSnapshotLine.createMany({
          data: rows.map((r) => ({
            snapshotId: snap.id,
            sellerId: r.sellerId,
            variantId: r.variantId,
            binId: r.binId,
            binCode: r.binCode,
            batchId: r.batchId,
            qtyOnHand: r.qtyOnHand,
          })),
        });
      }
      return snap;
    });
  }

  private async retentionMonths(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: RETENTION_SETTING_KEY },
      select: { valueInt: true },
    });
    // Fails open to the seeded default rather than refusing to snapshot:
    // a settings outage must never be a reason to skip the backup.
    return row?.valueInt ?? DEFAULT_RETENTION_MONTHS;
  }
}
