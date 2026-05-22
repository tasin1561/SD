import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, ManifestStatus, OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { AwbGenerationQueue } from '../../courier-awb/queue/awb-generation.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { ManifestNumberingService } from './manifest-numbering.service';

/** Advisory-lock namespace for the (courier, warehouse) DRAFT
 *  find-or-create. Serializes concurrent attachShipments for the same
 *  pair so we never get parallel DRAFTs. Distinct from numbering
 *  (0x04d46 'MF') — use 0x04d47. */
const ATTACH_LOCK_NAMESPACE = 0x0_4d_47;

export interface AttachShipmentResult {
  shipmentId: string;
  manifestId: string;
  manifestNumber: string;
  /** true ⇒ this call created the DRAFT manifest; false ⇒ attached to
   *  an existing one (or no-op when already attached to a DRAFT for the
   *  same courier/warehouse — idempotent). */
  manifestCreated: boolean;
  /** true ⇒ already attached to a DRAFT manifest matching the target —
   *  pure idempotent no-op. */
  alreadyAttached: boolean;
}

export interface MoveShipmentResult {
  shipmentId: string;
  sourceManifestId: string;
  targetManifestId: string;
  /** true ⇒ idempotent no-op (already on the target DRAFT). */
  alreadyOnTarget: boolean;
}

export interface CloseManifestFailure {
  shipmentId: string;
  orderId: string | null;
  error: string;
}

export interface ManifestListRow {
  id: string;
  manifestNumber: string;
  status: ManifestStatus;
  courierCode: string;
  originWarehouseId: string;
  closedAt: Date | null;
  closedByStaffId: string | null;
  createdAt: Date;
  shipmentCount: number;
}

export interface ManifestDetail extends ManifestListRow {
  shipments: Array<{
    id: string;
    shipmentNumber: string;
    status: ShipmentStatus;
    packCompletedAt: Date | null;
    orderId: string | null;
  }>;
}

export interface ListManifestsInput {
  status?: ManifestStatus;
  courierCode?: string;
  warehouseId?: string;
  page: number;
  pageSize: number;
}

export interface CloseManifestResult {
  manifestId: string;
  manifestNumber: string;
  status: ManifestStatus;
  closedAt: Date;
  closedByStaffId: string;
  shipmentIds: string[];
  /** Successful PACKED → PENDING_DISPATCH transitions. */
  transitionedCount: number;
  /** Per-shipment post-commit failures (closure itself succeeded). */
  failures: CloseManifestFailure[];
  /** true ⇒ idempotent no-op (manifest was already CLOSED). */
  alreadyClosed: boolean;
}

/**
 * Module 8 — manifest service (commit-9 scope: `attachShipment` only;
 * commit 11 adds `moveShipment`; commit 12 adds `close`). Provides the
 * WMS-7 find-or-create-DRAFT-and-attach primitive PackService consumes
 * post-pack-complete.
 *
 * Concurrency: the find-or-create is serialized per (courierCode,
 * warehouseId) with `pg_advisory_xact_lock` (namespace 0x04d47), so
 * two concurrent attachShipments for the same pair never both create a
 * DRAFT — they converge on one. Across distinct pairs there's no
 * contention (independent lock keys).
 *
 * Idempotency: a shipment already attached to a DRAFT manifest matching
 * (courier, warehouse) is a no-op (`alreadyAttached:true`). A shipment
 * attached to a CLOSED manifest cannot be moved by this primitive (use
 * commit 11's `moveShipment`, which gates on DRAFT only).
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: ManifestNumberingService,
    private readonly orderWrite: OrderWriteService,
    private readonly awbQueue: AwbGenerationQueue,
  ) {}

  /**
   * Find (or create) the DRAFT manifest for (courierCode, warehouseId)
   * and attach the shipment to it. Guards:
   *   - shipment exists, not soft-deleted, status CREATED (pre-AWB)
   *   - shipment.packCompletedAt set (must be packed)
   *   - shipment not already on a CLOSED manifest (use moveShipment if
   *     intended — but only DRAFT-to-DRAFT moves are allowed)
   */
  async attachShipment(
    shipmentId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    ctx?: ClientContext,
  ): Promise<AttachShipmentResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        status: true,
        courierCode: true,
        originWarehouseId: true,
        packCompletedAt: true,
        manifestId: true,
        manifest: { select: { id: true, status: true, courierCode: true, originWarehouseId: true, manifestNumber: true } },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_ATTACHABLE',
        message: `Shipment is ${shipment.status}; attach requires CREATED`,
      });
    }
    if (shipment.packCompletedAt === null) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_PACKED',
        message: 'Shipment must be packed (packCompletedAt set) before attaching to a manifest',
      });
    }
    if (
      shipment.manifest &&
      shipment.manifest.status === ManifestStatus.CLOSED
    ) {
      throw new ConflictException({
        code: 'MANIFEST_CLOSED',
        message: `Shipment is already on CLOSED manifest ${shipment.manifest.manifestNumber}`,
      });
    }
    if (
      shipment.manifest &&
      shipment.manifest.status === ManifestStatus.DRAFT &&
      shipment.manifest.courierCode === shipment.courierCode &&
      shipment.manifest.originWarehouseId === shipment.originWarehouseId
    ) {
      return {
        shipmentId,
        manifestId: shipment.manifest.id,
        manifestNumber: shipment.manifest.manifestNumber,
        manifestCreated: false,
        alreadyAttached: true,
      };
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Serialize concurrent attaches for this (courier, warehouse).
      // Hash JS-side (FNV-1a 32-bit) so the SQL is parameter-clean and
      // doesn't depend on a server-side hash function.
      const key = fnv1a32(
        `${shipment.courierCode}|${shipment.originWarehouseId}`,
      );
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1::int, $2::int)',
        ATTACH_LOCK_NAMESPACE,
        key,
      );

      let manifest = await tx.manifest.findFirst({
        where: {
          courierCode: shipment.courierCode,
          originWarehouseId: shipment.originWarehouseId,
          status: ManifestStatus.DRAFT,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, manifestNumber: true },
      });
      let manifestCreated = false;
      if (!manifest) {
        const manifestNumber = await this.numbering.nextManifestNumber(tx);
        manifest = await tx.manifest.create({
          data: {
            manifestNumber,
            courierCode: shipment.courierCode,
            originWarehouseId: shipment.originWarehouseId,
            status: ManifestStatus.DRAFT,
          },
          select: { id: true, manifestNumber: true },
        });
        manifestCreated = true;
      }

      await tx.shipment.update({
        where: { id: shipmentId },
        data: { manifestId: manifest.id },
      });

      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'manifest.shipment_attached',
          entityType: 'manifest',
          entityId: manifest.id,
          severity: 'LOW',
          metadata: {
            shipmentId,
            manifestNumber: manifest.manifestNumber,
            courierCode: shipment.courierCode,
            originWarehouseId: shipment.originWarehouseId,
            manifestCreated,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );

      return { manifest, manifestCreated };
    });

    return {
      shipmentId,
      manifestId: result.manifest.id,
      manifestNumber: result.manifest.manifestNumber,
      manifestCreated: result.manifestCreated,
      alreadyAttached: false,
    };
  }

  /**
   * Supervisor move (WMS-7 pre-close): reassign a packed shipment from
   * its current DRAFT manifest to another DRAFT manifest. Guards:
   *   - shipment exists, status CREATED, packCompletedAt set, currently
   *     attached to a manifest
   *   - source manifest is DRAFT (CLOSED → 409 SOURCE_MANIFEST_CLOSED)
   *   - target manifest exists + DRAFT
   *   - both manifests same courierCode (+ same originWarehouseId, since
   *     a manifest groups parcels leaving one warehouse via one courier)
   * Idempotent on already-on-target. Audit MEDIUM.
   */
  async moveShipment(
    shipmentId: string,
    targetManifestId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    ctx?: ClientContext,
  ): Promise<MoveShipmentResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        status: true,
        courierCode: true,
        originWarehouseId: true,
        packCompletedAt: true,
        manifestId: true,
        manifest: {
          select: {
            id: true,
            status: true,
            manifestNumber: true,
            courierCode: true,
            originWarehouseId: true,
          },
        },
      },
    });
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `Shipment ${shipmentId} not found`,
      });
    }
    if (shipment.status !== ShipmentStatus.CREATED) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_MOVABLE',
        message: `Shipment is ${shipment.status}; move requires CREATED`,
      });
    }
    if (shipment.packCompletedAt === null) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_PACKED',
        message: 'Shipment must be packed before being moved between manifests',
      });
    }
    if (!shipment.manifest || shipment.manifestId === null) {
      throw new ConflictException({
        code: 'SHIPMENT_NOT_ATTACHED',
        message: 'Shipment is not currently attached to any manifest',
      });
    }
    if (shipment.manifest.status !== ManifestStatus.DRAFT) {
      throw new ConflictException({
        code: 'SOURCE_MANIFEST_CLOSED',
        message: `Source manifest ${shipment.manifest.manifestNumber} is ${shipment.manifest.status}; only DRAFT shipments can be moved`,
      });
    }

    if (shipment.manifestId === targetManifestId) {
      return {
        shipmentId,
        sourceManifestId: shipment.manifestId,
        targetManifestId,
        alreadyOnTarget: true,
      };
    }

    const target = await this.prisma.client.manifest.findUnique({
      where: { id: targetManifestId },
      select: {
        id: true,
        status: true,
        manifestNumber: true,
        courierCode: true,
        originWarehouseId: true,
      },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'TARGET_MANIFEST_NOT_FOUND',
        message: `Target manifest ${targetManifestId} not found`,
      });
    }
    if (target.status !== ManifestStatus.DRAFT) {
      throw new ConflictException({
        code: 'TARGET_MANIFEST_NOT_DRAFT',
        message: `Target manifest ${target.manifestNumber} is ${target.status}; only DRAFT targets are valid`,
      });
    }
    if (target.courierCode !== shipment.manifest.courierCode) {
      throw new ConflictException({
        code: 'COURIER_MISMATCH',
        message: `Target manifest courier ${target.courierCode} does not match source ${shipment.manifest.courierCode}`,
      });
    }
    if (target.originWarehouseId !== shipment.manifest.originWarehouseId) {
      throw new ConflictException({
        code: 'WAREHOUSE_MISMATCH',
        message: 'Target manifest origin warehouse does not match source',
      });
    }

    const sourceManifestId = shipment.manifestId;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { manifestId: targetManifestId },
      });
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'manifest.shipment_moved',
          entityType: 'manifest',
          entityId: targetManifestId,
          severity: 'MEDIUM',
          metadata: {
            shipmentId,
            sourceManifestId,
            targetManifestId,
            sourceManifestNumber: shipment.manifest?.manifestNumber ?? null,
            targetManifestNumber: target.manifestNumber,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    return {
      shipmentId,
      sourceManifestId,
      targetManifestId,
      alreadyOnTarget: false,
    };
  }

  /**
   * WMS-6 manifest close (supervisor — role gated at controller layer).
   * Closes a DRAFT manifest, then drives every attached shipment's order
   * PACKED → PENDING_DISPATCH (saga, post-commit, best-effort), and
   * emits the Module-9 AWB enqueue STUB (audit HIGH, manifestId +
   * shipmentIds in metadata). Manifest stays CLOSED (commit-1 schema
   * intentionally restricts ManifestStatus to DRAFT/CLOSED for M8;
   * Module 9 extends with AWB_PENDING/CONFIRMED/FAILED).
   *
   * Saga discipline: the CLOSURE TX (manifest update + audit) commits
   * atomically. The per-shipment order transitions are POST-COMMIT, each
   * its own transitionStatus tx (matrix PACKED→PENDING_DISPATCH has
   * EMPTY side-effects so no nested M5 work). A per-shipment failure is
   * collected into `failures` and the loop continues — the manifest is
   * correctly CLOSED, the supervisor can investigate via the response.
   * A persistent transition failure does NOT undo the closure (the
   * authoritative state — manifest closed — is the supervisor's
   * intent and the AWB pipeline lives downstream).
   *
   * Idempotent on already-CLOSED (no transitions, no AWB stub re-emit).
   */
  async close(
    manifestId: string,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<CloseManifestResult> {
    const manifest = await this.prisma.client.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNumber: true,
        status: true,
        closedAt: true,
        closedByStaffId: true,
        shipments: {
          select: {
            id: true,
            status: true,
            orderShipments: {
              select: { orderId: true },
              orderBy: { shipmentSequence: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    if (!manifest) {
      throw new NotFoundException({
        code: 'MANIFEST_NOT_FOUND',
        message: `Manifest ${manifestId} not found`,
      });
    }
    const shipmentIds = manifest.shipments.map((s) => s.id);

    // Idempotent on any ALREADY-PROGRESSED manifest. Module 9 expanded
    // ManifestStatus (DRAFT → CLOSED → CONFIRMED → DISPATCHED, + FAILED):
    // re-closing a manifest the async AWB job has already advanced to
    // CONFIRMED/DISPATCHED/FAILED must be a no-op, not a 409 race —
    // `!== DRAFT` is the correct gate (was `=== CLOSED` when CLOSED was
    // the only post-DRAFT state).
    if (manifest.status !== ManifestStatus.DRAFT) {
      return {
        manifestId,
        manifestNumber: manifest.manifestNumber,
        status: manifest.status,
        closedAt: manifest.closedAt ?? new Date(),
        closedByStaffId: manifest.closedByStaffId ?? staffId,
        shipmentIds,
        transitionedCount: 0,
        failures: [],
        alreadyClosed: true,
      };
    }
    if (manifest.shipments.length === 0) {
      throw new ConflictException({
        code: 'MANIFEST_EMPTY',
        message: `Manifest ${manifest.manifestNumber} has no shipments; closing an empty manifest is not allowed`,
      });
    }

    const now = new Date();
    // 1. CLOSURE TX — atomic state change + audit.
    await this.prisma.client.$transaction(async (tx) => {
      const upd = await tx.manifest.updateMany({
        where: { id: manifestId, status: ManifestStatus.DRAFT },
        data: {
          status: ManifestStatus.CLOSED,
          closedAt: now,
          closedByStaffId: staffId,
          // Module 9: the AWB job WILL be enqueued post-commit. Stamping
          // the intent inside the closure tx; if the post-commit enqueue
          // fails, an admin re-trigger / re-close recovers.
          awbJobEnqueuedAt: now,
        },
      });
      if (upd.count !== 1) {
        // Lost a race to another close call — treat as idempotent.
        throw new ConflictException({
          code: 'MANIFEST_CLOSE_RACE',
          message: 'Manifest was already closed concurrently',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: staffId,
          action: 'manifest.closed',
          entityType: 'manifest',
          entityId: manifestId,
          severity: 'MEDIUM',
          metadata: {
            manifestNumber: manifest.manifestNumber,
            shipmentCount: shipmentIds.length,
            shipmentIds,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    // 2. POST-COMMIT per-shipment PACKED → PENDING_DISPATCH (saga). The
    //    matrix edge has EMPTY side-effects (no M5 work). Failures are
    //    collected per-shipment and DO NOT undo the closure (manifest is
    //    correctly CLOSED; supervisor sees failures in the response).
    const actor = { type: ActorType.STAFF, id: staffId };
    let transitionedCount = 0;
    const failures: CloseManifestFailure[] = [];
    for (const ship of manifest.shipments) {
      const orderId = ship.orderShipments[0]?.orderId ?? null;
      if (orderId === null) {
        failures.push({
          shipmentId: ship.id,
          orderId: null,
          error: 'ORDER_SHIPMENT_MISSING',
        });
        continue;
      }
      try {
        await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.PENDING_DISPATCH,
          actor,
          expectedFrom: OrderStatus.PACKED,
          reason: `Manifest ${manifest.manifestNumber} closed`,
          ...(ctx !== undefined ? { ctx } : {}),
        });
        transitionedCount += 1;
      } catch (e) {
        const err = e as Error;
        this.logger.warn(
          { manifestId, shipmentId: ship.id, orderId, err: err.message },
          'Manifest close: PACKED→PENDING_DISPATCH failed for shipment — supervisor will reconcile',
        );
        failures.push({ shipmentId: ship.id, orderId, error: err.message });
      }
    }

    // 3. POST-COMMIT — enqueue the per-manifest AWB generation job
    //    (Module 9, CUR-2; replaces the M8 audit-only stub). The job is
    //    idempotent (jobId = manifestId dedup; AwbGenerationJobService
    //    CUR-9) and the worker drives the manifest CLOSED → CONFIRMED/
    //    FAILED transition. Best-effort: a failed enqueue leaves the
    //    manifest CLOSED with awbJobEnqueuedAt set — an admin re-close
    //    (idempotent) or a manual processManifest trigger recovers.
    try {
      await this.awbQueue.enqueueManifest(manifestId);
    } catch (e) {
      this.logger.error(
        { manifestId, err: (e as Error).message },
        'Manifest closed but AWB job enqueue failed — manifest is CLOSED; admin re-trigger required',
      );
    }

    return {
      manifestId,
      manifestNumber: manifest.manifestNumber,
      status: ManifestStatus.CLOSED,
      closedAt: now,
      closedByStaffId: staffId,
      shipmentIds,
      transitionedCount,
      failures,
      alreadyClosed: false,
    };
  }

  /** Paginated admin/supervisor list. status / courierCode /
   *  warehouseId optional filters; default page 1 / size 20. */
  async listManifests(input: ListManifestsInput): Promise<{
    items: ManifestListRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.courierCode !== undefined
        ? { courierCode: input.courierCode }
        : {}),
      ...(input.warehouseId !== undefined
        ? { originWarehouseId: input.warehouseId }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.client.manifest.count({ where }),
      this.prisma.client.manifest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.pageSize,
        skip: (input.page - 1) * input.pageSize,
        select: {
          id: true,
          manifestNumber: true,
          status: true,
          courierCode: true,
          originWarehouseId: true,
          closedAt: true,
          closedByStaffId: true,
          createdAt: true,
          _count: { select: { shipments: true } },
        },
      }),
    ]);
    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        manifestNumber: r.manifestNumber,
        status: r.status,
        courierCode: r.courierCode,
        originWarehouseId: r.originWarehouseId,
        closedAt: r.closedAt,
        closedByStaffId: r.closedByStaffId,
        createdAt: r.createdAt,
        shipmentCount: r._count.shipments,
      })),
    };
  }

  /** Manifest detail (header + attached shipments). 404 on missing. */
  async getById(manifestId: string): Promise<ManifestDetail> {
    const m = await this.prisma.client.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNumber: true,
        status: true,
        courierCode: true,
        originWarehouseId: true,
        closedAt: true,
        closedByStaffId: true,
        createdAt: true,
        shipments: {
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            packCompletedAt: true,
            orderShipments: {
              select: { orderId: true },
              orderBy: { shipmentSequence: 'asc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!m) {
      throw new NotFoundException({
        code: 'MANIFEST_NOT_FOUND',
        message: `Manifest ${manifestId} not found`,
      });
    }
    return {
      id: m.id,
      manifestNumber: m.manifestNumber,
      status: m.status,
      courierCode: m.courierCode,
      originWarehouseId: m.originWarehouseId,
      closedAt: m.closedAt,
      closedByStaffId: m.closedByStaffId,
      createdAt: m.createdAt,
      shipmentCount: m.shipments.length,
      shipments: m.shipments.map((s) => ({
        id: s.id,
        shipmentNumber: s.shipmentNumber,
        status: s.status,
        packCompletedAt: s.packCompletedAt,
        orderId: s.orderShipments[0]?.orderId ?? null,
      })),
    };
  }
}

/** 32-bit FNV-1a — small, deterministic, signed-int-fits.
 *  Used as the second arg of pg_advisory_xact_lock(int, int). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0; // signed 32-bit
}
