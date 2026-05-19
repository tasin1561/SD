import { Injectable, Logger } from '@nestjs/common';
import { ActorType, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import { StockPickAllocationService } from '../../inventory-stock/services/stock-pick-allocation.service';
import { PickExpirationQueue } from '../queue/pick-expiration.queue';

export interface PickExpireResult {
  /** true ⇒ this call performed the revert; false ⇒ idempotent no-op
   *  (already completed / re-pulled / reverted by an earlier delivery). */
  expired: boolean;
}

/**
 * Module 8 — WMS-5 pick-task expiration.
 *
 * A pulled parcel is CLAIMED (commit 4: shipment.pickStartedAt stamped,
 * order CONFIRMED→PENDING_PICK on START). If the picker neither
 * completes nor the parcel gets re-pulled within
 * ops.pick_task_timeout_hours, the claim must be released so the order
 * isn't stranded. A delayed BullMQ job (scheduled by
 * PickQueueService.pullNext) fires here.
 *
 * Idempotency is TIME-BASED, not flag-based (mirrors M7 CC-7): the job
 * carries the pickStartedAt it was scheduled for, and the revert is a
 * guarded conditional updateMany on (status=CREATED, that exact
 * pickStartedAt, pickCompletedAt IS NULL) — the single conditional
 * UPDATE IS the atomic CAS (no tx needed). Any of —
 *   - shipment already PICKED-out / not CREATED
 *   - pickCompletedAt set (pick finished)
 *   - pickStartedAt cleared (an earlier delivery already reverted it)
 *   - re-pulled with a newer pickStartedAt (revert → re-pull)
 * — makes the delivery a safe no-op, so BullMQ retries, duplicate
 * deliveries, and an old timer racing a fresh re-pull can never
 * double-expire or steal a new picker's claim.
 *
 * The ORDER stays in PENDING_PICK (locked pre-flight decision): expiry
 * only clears the shipment claim + gives the M5 phase-2 holds back via
 * releaseAllocation (collapse → one conserved phase-1 row, INV-4), so
 * the parcel re-enters the FIFO queue through the commit-4
 * `pick_started_at IS NULL` filter with NO order-status bounce. The
 * releaseAllocation give-back is POST-CAS + best-effort + idempotent
 * (alreadyPhase1 no-op): a failure leaves phase-2 holds that the next
 * pull's allocateAndPopulate tolerates (idempotent) or a later
 * expiry/supervisor reconciles — never thrown upstream (BullMQ retry is
 * also safe, releaseAllocation being idempotent).
 *
 * `expire()` is public — it doubles as the manual trigger for ops
 * tooling / tests (mirrors M7).
 */
@Injectable()
export class PickExpirationService {
  private readonly logger = new Logger(PickExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly queue: PickExpirationQueue,
    private readonly reservations: StockReservationService,
    private readonly allocation: StockPickAllocationService,
  ) {}

  /** Schedule the delayed expiry sweep for a freshly-claimed parcel.
   *  Called post-claim by PickQueueService.pullNext. The deadline was
   *  already computed at claim time (ops.pick_task_timeout_hours). */
  async scheduleExpiration(
    shipmentId: string,
    pickStartedAt: Date,
    pickExpiresAt: Date,
  ): Promise<void> {
    const delayMs = pickExpiresAt.getTime() - Date.now();
    await this.queue.enqueueExpiration(
      { shipmentId, pickStartedAtIso: pickStartedAt.toISOString() },
      delayMs,
    );
  }

  /**
   * Time-based idempotent expiry. Releases the claim (clears
   * pickStartedAt/By/ExpiresAt) only when the shipment is still
   * CREATED + claimed-with-the-exact-pickStartedAt this job was
   * scheduled for + not completed; otherwise a no-op. On a winning CAS
   * it then gives the M5 phase-2 holds back (releaseAllocation per
   * ACTIVE reservation), best-effort.
   */
  async expire(
    shipmentId: string,
    pickStartedAtIso: string,
  ): Promise<PickExpireResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pickStartedAt: true,
        pickStartedByStaffId: true,
        pickCompletedAt: true,
        orderShipments: {
          select: { orderId: true },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (
      !shipment ||
      shipment.status !== ShipmentStatus.CREATED ||
      shipment.pickStartedAt === null ||
      shipment.pickCompletedAt !== null ||
      shipment.pickStartedAt.toISOString() !== pickStartedAtIso
    ) {
      return { expired: false }; // stale / already-handled — no-op
    }

    const priorStaffId = shipment.pickStartedByStaffId;
    const orderId = shipment.orderShipments[0]?.orderId ?? null;

    // Guard the revert on the (status, pickStartedAt, pickCompletedAt
    // null) it was scheduled for so two concurrent deliveries can't both
    // win (this single conditional UPDATE is the atomic CAS — no tx).
    const { count } = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipmentId,
        status: ShipmentStatus.CREATED,
        pickStartedAt: shipment.pickStartedAt,
        pickCompletedAt: null,
      },
      data: {
        pickStartedAt: null,
        pickStartedByStaffId: null,
        pickExpiresAt: null,
      },
    });
    if (count === 0) return { expired: false }; // lost the race — no-op

    // WMS-5: give the M5 phase-2 holds back so the line is cleanly
    // re-pickable. POST-CAS, best-effort, idempotent per reservation
    // (releaseAllocation: alreadyPhase1 no-op). Failure never thrown
    // upstream — order stays PENDING_PICK, next pull's
    // allocateAndPopulate tolerates residual phase-2 (idempotent).
    let releasedGroups = 0;
    if (orderId !== null) {
      try {
        const active = await this.reservations.listActiveForOrder(orderId);
        for (const resv of active) {
          const r = await this.allocation.releaseAllocation(resv.id, {
            type: ActorType.SYSTEM,
          });
          if (!r.alreadyPhase1) releasedGroups += 1;
        }
      } catch (err) {
        this.logger.warn(
          { shipmentId, orderId, err: (err as Error).message },
          'Pick expiry: releaseAllocation give-back failed — next pull/expiry reconciles (idempotent)',
        );
      }
    }

    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: 'warehouse_pick.expired',
      entityType: 'shipment',
      entityId: shipmentId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        priorStaffId,
        pickStartedAt: pickStartedAtIso,
        releasedGroups,
      },
    });
    this.logger.warn(
      { shipmentId, orderId, priorStaffId },
      'Pick task expired — claim released, parcel returned to the FIFO queue',
    );
    return { expired: true };
  }
}
