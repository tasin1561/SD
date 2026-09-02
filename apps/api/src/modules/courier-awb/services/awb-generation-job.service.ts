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
import { CourierFeeAccrualService } from '../../seller-wallet-accrual/services/courier-fee-accrual.service';
import { AwbGenerationService } from './awb-generation.service';
import { AwbSupersedeService } from './awb-supersede.service';

export interface AwbJobShipmentOutcome {
  shipmentId: string;
  /** GENERATED — AWB issued AND label persisted; GENERATED_AWB_LABEL_PENDING
   *  — AWB durably persisted but the label upload is pending a retry
   *  (M10 commit 1 visible-vs-silent ordering); SUPERSEDED — AWB failed,
   *  shipment retired + replacement created + order routed to manual
   *  placement; ERROR — an unexpected exception (state uncertain, ops
   *  investigates). */
  result: 'GENERATED' | 'GENERATED_AWB_LABEL_PENDING' | 'SUPERSEDED' | 'ERROR';
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

export interface AwbOrderJobResult {
  orderId: string;
  shipmentId: string | null;
  result: 'GENERATED' | 'ALREADY_HAS_AWB' | 'SUPERSEDED' | 'NO_LIVE_SHIPMENT' | 'ERROR';
  awbNumber?: string | null;
  newShipmentId?: string;
  error?: string;
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
    private readonly courierFeeAccrual: CourierFeeAccrualService,
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
    /** M10 commit 1 — count of shipments where the AWB is durably
     *  persisted but the label upload (Phase D) is pending a retry. A
     *  non-zero count at the end of the loop blocks the manifest status
     *  flip and throws so BullMQ retries the whole job; on retry the
     *  CUR-9 recovery path runs ONLY the label leg (no second
     *  Delhivery generateAwb / no double real charge). */
    let labelPendingCount = 0;

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
          // R1c: best-effort AT_AWB early charge accrual — a no-op for
          // AT_DELIVERY-tier sellers (the default). Never blocks or
          // fails this loop; a failure here is caught by the
          // DELIVERED-time debit later (shared idempotent gate).
          if (orderId !== null) {
            await this.courierFeeAccrual.tryEarlyAccrual(orderId);
          }
          continue;
        }
        if (gen.status === 'GENERATED_AWB_LABEL_PENDING') {
          // Forward progress (AWB durably persisted) but not done —
          // count as generated for the manifest-status decision (the
          // AWB is real, the shipment can dispatch) yet record the
          // label-pending flag so the post-loop block throws to BullMQ
          // for a retry of the label leg.
          generatedCount += 1;
          labelPendingCount += 1;
          outcomes.push({
            shipmentId: shipment.id,
            result: 'GENERATED_AWB_LABEL_PENDING',
            awbNumber: gen.awbNumber,
            error: gen.errorMessage,
          });
          // The AWB is durably persisted (source-of-truth) even though
          // the label leg is still pending — the charge is legitimately
          // incurred at this point, same as the GENERATED branch.
          if (orderId !== null) {
            await this.courierFeeAccrual.tryEarlyAccrual(orderId);
          }
          continue;
        }
        // gen.status === 'FAILED' — route to manual placement, supersede.
        failedCount += 1;
        const reason = gen.serviceable
          ? SupersedeReason.COURIER_FAILURE
          : SupersedeReason.NON_SERVICEABLE;
        if (orderId !== null) {
          await this.routeOrderToManual(orderId, shipment.id, OrderStatus.PENDING_DISPATCH);
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

    // M10 commit 1: do NOT flip the manifest status while any label is
    // pending. The manifest stays CLOSED, the AWB-already-persisted gate
    // (CUR-9 recovery) handles the retry, and only once every label has
    // landed does the manifest move forward. Throwing here is the
    // RETRY signal to BullMQ (one queue, one policy — F11 decision).
    if (labelPendingCount > 0) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'manifest.awb_job_label_pending',
        entityType: 'manifest',
        entityId: manifestId,
        severity: 'HIGH',
        metadata: {
          generatedCount,
          failedCount,
          labelPendingCount,
          shipmentCount: manifest.shipments.length,
        },
      });
      throw new Error(
        `AWB label upload pending for ${labelPendingCount} shipment(s) on manifest ${manifestId}; BullMQ will retry`,
      );
    }

    // Manifest status: ≥1 AWB → CONFIRMED; zero → FAILED.
    const manifestStatus = generatedCount > 0 ? ManifestStatus.CONFIRMED : ManifestStatus.FAILED;
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

  /**
   * Generate the AWB for ONE order, at confirmation.
   *
   * ── WHY THIS EXISTS ────────────────────────────────────────────────
   * The AWB used to be created when a supervisor closed the manifest,
   * which is AFTER the parcel has been picked and packed. That left the
   * pack bench with nothing meaningful to scan — no invoice (raised on
   * delivery) and no AWB — and it meant an unserviceable pincode was
   * discovered only once the goods had been picked, packed and boxed.
   *
   * Creating it at confirmation puts a real shipping label on the bench
   * before picking starts, and turns a courier refusal into something
   * caught before anyone touches stock.
   *
   * ── WHAT IT COSTS, HONESTLY ────────────────────────────────────────
   * A waybill is consumed for every CONFIRMED order, including ones
   * that never ship — a pick shortfall, a late cancellation. Each of
   * those leaves a live AWB that needs cancelling with the courier
   * (CUR-10: operator-triggered and audited, never automatic). Size the
   * waybill pool against confirmed volume, not dispatched volume.
   *
   * ── IDEMPOTENCY ────────────────────────────────────────────────────
   * CUR-9 is unchanged and does the work: `shipment.awbNumber !== null`
   * is the gate, so a re-run — a BullMQ retry, a re-emit of the
   * transition, or the manifest-close job later catching up — skips a
   * shipment that already has one. It never doubles a real Delhivery
   * call or a real charge.
   */
  async processOrder(orderId: string): Promise<AwbOrderJobResult> {
    // The LIVE shipment: superseded ones carry `supersededAt` and are
    // replaced by a CREATED successor (CUR-7), so filtering on status
    // alone would pick up a retired parcel.
    const link = await this.prisma.client.orderShipment.findFirst({
      where: {
        orderId,
        shipment: { status: ShipmentStatus.CREATED, supersededAt: null, deletedAt: null },
      },
      orderBy: { shipmentSequence: 'desc' },
      select: { shipmentId: true },
    });

    if (link === null) {
      // Not an error: an order can reach CONFIRMED and have its
      // shipment voided underneath (a cancel racing the hook), and a
      // re-run after the parcel dispatched finds nothing CREATED.
      return { orderId, shipmentId: null, result: 'NO_LIVE_SHIPMENT' };
    }

    const shipmentId = link.shipmentId;
    try {
      const gen = await this.generation.generateForShipment(shipmentId, { type: ActorType.SYSTEM });

      if (gen.status === 'ALREADY_HAS_AWB') {
        return { orderId, shipmentId, result: 'ALREADY_HAS_AWB', awbNumber: gen.awbNumber };
      }
      if (gen.status === 'GENERATED' || gen.status === 'GENERATED_AWB_LABEL_PENDING') {
        // R1c early-accrual, same as the manifest path: a no-op for
        // AT_DELIVERY sellers, and never allowed to fail the job.
        await this.courierFeeAccrual.tryEarlyAccrual(orderId);
        if (gen.status === 'GENERATED_AWB_LABEL_PENDING') {
          // The AWB is durably persisted; only the label upload is
          // outstanding. Throwing hands it back to BullMQ, whose retry
          // re-enters on the CUR-9 gate and runs the label leg alone.
          throw new Error(
            `AWB persisted but label upload pending for shipment ${shipmentId}; BullMQ will retry`,
          );
        }
        return { orderId, shipmentId, result: 'GENERATED', awbNumber: gen.awbNumber };
      }

      // FAILED. What happens next depends on WHY, and the distinction
      // matters more here than it did at manifest close.
      //
      // At manifest close the parcel was already picked and packed, so
      // any failure meant "a human must place this". At confirmation
      // nothing has been touched yet, and the two failures are not
      // alike:
      //
      //   REFUSED — the courier looked at this parcel and said no. Not
      //     only "wrong pincode": a consignee their fraud check does not
      //     believe refuses identically every time too (CUR-13 — the
      //     field means "will not carry THIS parcel"). By the time we
      //     are here, CUR-14 has already offered it to the alternate
      //     courier and that one refused as well, so there is no carrier
      //     left to ask. Route it out and retire the shipment; a human
      //     places it. Catching this at confirmation is the whole reason
      //     for generating early — nobody picks an order that was never
      //     going to ship.
      //
      //   COURIER FAILURE — a timeout, a 500, a rate limit, an explicit
      //     "try again". Nobody formed an opinion about this parcel.
      //     Derailing the order into manual placement over a hiccup
      //     would move a day's volume, and a courier's cost, to somebody
      //     nobody chose. So leave it CONFIRMED and let it flow.
      //     Manifest close runs the same job again, and CUR-9's gate
      //     means the retry is free if this attempt secretly succeeded.
      if (gen.serviceable) {
        this.logger.warn(
          { orderId, shipmentId, error: gen.errorMessage },
          'AWB generation failed transiently at confirmation — order continues; manifest close will retry',
        );
        return {
          orderId,
          shipmentId,
          result: 'ERROR',
          error: gen.errorMessage ?? 'transient courier failure',
        };
      }

      // Refused by every courier that would take it. Route the order out
      // FIRST (the durable "a human must place this" fact), then retire
      // the shipment — visible-vs-silent, same ordering as the manifest
      // job.
      //
      // PENDING_MANUAL_PLACEMENT no longer means "this must be picked
      // already": recording the manual AWB on an unpicked order routes
      // it to PENDING_PICK and it flows through the ordinary pick → pack
      // → handoff path, where DISPATCH_STOCK fires exactly once (CUR-3).
      // That is what makes routing a confirmation-time refusal here
      // correct rather than a dead end.
      await this.routeOrderToManual(orderId, shipmentId, OrderStatus.CONFIRMED);
      const sup = await this.supersede.supersede(shipmentId, SupersedeReason.NON_SERVICEABLE, {
        type: ActorType.SYSTEM,
      });

      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: 'order.awb_at_confirmation_non_serviceable',
        entityType: 'order',
        entityId: orderId,
        severity: 'HIGH',
        metadata: { shipmentId, newShipmentId: sup.newShipmentId, error: gen.errorMessage },
      });

      return { orderId, shipmentId, result: 'SUPERSEDED', newShipmentId: sup.newShipmentId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { orderId, shipmentId, err: message },
        'AWB generation at confirmation failed',
      );
      throw err;
    }
  }

  /** Route a failed shipment's order → PENDING_MANUAL_PLACEMENT.
   *  Idempotent on STALE (a mid-retry order already moved).
   *
   *  `expectedFrom` is a parameter because the AWB is now generated at
   *  order CONFIRMATION as well as at manifest close, so the order can
   *  legitimately be sitting in either state when the courier refuses.
   *  Both edges exist on the matrix with no side-effects. */
  private async routeOrderToManual(
    orderId: string,
    shipmentId: string,
    expectedFrom: OrderStatus,
  ): Promise<void> {
    try {
      await this.orderWrite.transitionStatus({
        orderId,
        to: OrderStatus.PENDING_MANUAL_PLACEMENT,
        actor: { type: ActorType.SYSTEM, id: null },
        expectedFrom,
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
