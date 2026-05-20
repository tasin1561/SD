import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, ManifestStatus, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: ManifestNumberingService,
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
