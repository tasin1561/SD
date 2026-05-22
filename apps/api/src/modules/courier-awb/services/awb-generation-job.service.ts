import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  ManifestStatus,
  OrderStatus,
  ShipmentStatus,
  SupersedeReason,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { AwbGenerationService } from './awb-generation.service';
import { AwbSupersedeService } from './awb-supersede.service';

export interface AwbJobShipmentOutcome {
  shipmentId: string;
  /** GENERATED — AWB issued; SUPERSEDED — AWB failed, shipment retired
   *  + replacement created + order routed to manual placement;
   *  ERROR — an unexpected exception (state uncertain, ops investigates). */
  result: 'GENERATED' | 'SUPERSEDED' | 'ERROR';
  awbNumber?: string;
  newShipmentId?: string;
  error?: string;
}

export interface AwbJobResult {
  manifestId: string;
  manifestStatus: ManifestStatus;
  generatedCount: number;
  failedCount: number;
  outcomes: AwbJobShipmentOutcome[];
  /** true ⇒ idempotent no-op (manifest already past CLOSED). */
  alreadyProcessed: boolean;
}

/**
 * Module 9 — per-manifest AWB generation job (commit 9, CUR-2 + CUR-9).
 *
 * processManifest iterates the manifest's CREATED shipments and, for
 * each, generates an AWB. PER-SHIPMENT FAILURE ISOLATION (same fan-out
 * discipline as M8 ManifestService.close): a single shipment's failure
 * NEVER aborts the others — every shipment is processed, outcomes
 * collected, the manifest status reflects the mix.
 *
 *   - GENERATED → the shipment carries an AWB and stays in the manifest.
 *   - FAILED → the order is routed PENDING_DISPATCH → PENDING_MANUAL_
 *     PLACEMENT FIRST (idempotent on STALE), THEN the shipment is
 *     auto-superseded (CUR-7) — the visible-vs-silent ordering: the
 *     order-status move is the durable "this needs manual handling"
 *     fact; the supersede (which detaches the old shipment from the
 *     manifest, manifestId=null) is the cleanup. On a mid-failure
 *     BullMQ retry the still-attached old shipment is re-processed and
 *     converges (transition 409-STALE caught, supersede idempotent).
 *   - thrown exception → ERROR outcome, logged HIGH, loop continues.
 *
 * Manifest status: ≥1 AWB generated → CONFIRMED (the AWB'd shipments
 * can still dispatch); ALL shipments failed → FAILED. awbJobCompletedAt
 * stamped either way.
 *
 * Idempotent (CUR-2/CUR-9): re-running on an already-CONFIRMED/
 * DISPATCHED/FAILED manifest is a no-op; CUR-9 skips already-AWB'd
 * shipments; superseded shipments self-detach from the manifest so a
 * retry never re-supersedes. `processManifest` is public — it doubles
 * as the manual ops trigger.
 */
@Injectable()
export class AwbGenerationJobService {
  private readonly logger = new Logger(AwbGenerationJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orderWrite: OrderWriteService,
    private readonly generation: AwbGenerationService,
    private readonly supersede: AwbSupersedeService,
  ) {}

  async processManifest(manifestId: string): Promise<AwbJobResult> {
    const manifest = await this.prisma.client.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        status: true,
        shipments: {
          where: { status: ShipmentStatus.CREATED },
          select: {
            id: true,
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

    // Idempotency: only a CLOSED manifest is processable. An
    // already-CONFIRMED/DISPATCHED/FAILED manifest is a no-op (a prior
    // run finished). DRAFT means it was never closed.
    if (manifest.status !== ManifestStatus.CLOSED) {
      return {
        manifestId,
        manifestStatus: manifest.status,
        generatedCount: 0,
        failedCount: 0,
        outcomes: [],
        alreadyProcessed: manifest.status !== ManifestStatus.DRAFT,
      };
    }

    const outcomes: AwbJobShipmentOutcome[] = [];
    let generatedCount = 0;
    let failedCount = 0;

    for (const shipment of manifest.shipments) {
      const orderId = shipment.orderShipments[0]?.orderId ?? null;
      try {
        const gen = await this.generation.generateForShipment(shipment.id, {
          type: ActorType.SYSTEM,
        });
        if (gen.status === 'GENERATED' || gen.status === 'ALREADY_HAS_AWB') {
          generatedCount += 1;
          outcomes.push({
            shipmentId: shipment.id,
            result: 'GENERATED',
            awbNumber: gen.awbNumber,
          });
          continue;
        }
        // gen.status === 'FAILED' — route to manual placement, supersede.
        failedCount += 1;
        const reason = gen.serviceable
          ? SupersedeReason.COURIER_FAILURE
          : SupersedeReason.NON_SERVICEABLE;
        if (orderId !== null) {
          await this.routeOrderToManual(orderId, shipment.id);
        }
        const sup = await this.supersede.supersede(shipment.id, reason, {
          type: ActorType.SYSTEM,
        });
        outcomes.push({
          shipmentId: shipment.id,
          result: 'SUPERSEDED',
          newShipmentId: sup.newShipmentId,
        });
      } catch (err) {
        // Per-shipment isolation: an unexpected exception NEVER aborts
        // the rest of the manifest.
        failedCount += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { manifestId, shipmentId: shipment.id, orderId, err: message },
          'AWB generation errored for a shipment — isolated, continuing',
        );
        outcomes.push({
          shipmentId: shipment.id,
          result: 'ERROR',
          error: message,
        });
      }
    }

    // Manifest status: ≥1 AWB → CONFIRMED; zero → FAILED.
    const manifestStatus =
      generatedCount > 0 ? ManifestStatus.CONFIRMED : ManifestStatus.FAILED;
    await this.prisma.client.manifest.update({
      where: { id: manifestId },
      data: { status: manifestStatus, awbJobCompletedAt: new Date() },
    });

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: 'manifest.awb_job_completed',
      entityType: 'manifest',
      entityId: manifestId,
      severity: failedCount > 0 ? 'HIGH' : 'LOW',
      metadata: {
        manifestStatus,
        generatedCount,
        failedCount,
        shipmentCount: manifest.shipments.length,
      },
    });

    return {
      manifestId,
      manifestStatus,
      generatedCount,
      failedCount,
      outcomes,
      alreadyProcessed: false,
    };
  }

  /** Route a failed shipment's order PENDING_DISPATCH →
   *  PENDING_MANUAL_PLACEMENT. Idempotent on STALE (a mid-retry order
   *  already moved). */
  private async routeOrderToManual(
    orderId: string,
    shipmentId: string,
  ): Promise<void> {
    try {
      await this.orderWrite.transitionStatus({
        orderId,
        to: OrderStatus.PENDING_MANUAL_PLACEMENT,
        actor: { type: ActorType.SYSTEM, id: null },
        expectedFrom: OrderStatus.PENDING_DISPATCH,
        reason: `AWB generation failed for shipment ${shipmentId}`,
      });
    } catch (err) {
      const code =
        err !== null &&
        typeof err === 'object' &&
        'response' in err &&
        typeof (err as { response?: unknown }).response === 'object'
          ? ((err as { response: { code?: unknown } }).response.code ?? '')
          : '';
      if (code === 'STALE_ORDER_STATUS' || code === 'NOOP_TRANSITION') {
        // Already routed by a prior (crashed) attempt — fine.
        return;
      }
      throw err;
    }
  }
}
