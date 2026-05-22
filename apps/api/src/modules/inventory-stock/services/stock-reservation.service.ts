import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  ReservationReleaseReason,
  ReservationStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockAvailabilityService } from '../../inventory-shared/stock-availability.service';

const RESERVATION_TTL_SETTING_KEY = 'ops.stock_reservation_ttl_hours';
/** Last-resort fallback if the system setting is somehow missing. */
const DEFAULT_TTL_HOURS = 48;

export class InsufficientStockError extends ConflictException {
  constructor(requested: number, available: number) {
    super({
      code: 'INSUFFICIENT_STOCK',
      message: `Requested ${requested} but only ${available} available`,
      requested,
      available,
    });
  }
}

export interface ReserveInput {
  sellerId: string;
  variantId: string;
  warehouseId: string;
  qtyToReserve: number;
  /** Caller-supplied (Module 6 passes the real order/orderItem ids).
   *  stock_reservations.orderId/orderItemId are NOT NULL FK columns. */
  orderId: string;
  orderItemId: string;
  /** Test seam. */
  now?: Date;
}

export interface ReservationView {
  id: string;
  sellerId: string;
  variantId: string;
  warehouseId: string;
  binId: string | null;
  batchId: string | null;
  qtyReserved: number;
  orderId: string;
  orderItemId: string;
  status: ReservationStatus;
  expiresAt: Date | null;
}

export interface ReleaseResult {
  reservationId: string;
  qtyReleased: number;
  status: ReservationStatus;
  alreadyInactive: boolean;
}

const RESERVATION_SELECT = {
  id: true,
  sellerId: true,
  variantId: true,
  warehouseId: true,
  binId: true,
  batchId: true,
  qtyReserved: true,
  orderId: true,
  orderItemId: true,
  status: true,
  expiresAt: true,
} as const;

/**
 * LATE reservation allocation (locked decision #1).
 *
 *  - reserve(): PHASE-1. Creates an ACTIVE stock_reservations row with
 *    NULL bin/batch — a soft qty claim placed at order-confirm. Does NOT
 *    touch stock_levels.qtyReserved (INV-4: that column counts only
 *    phase-2 allocated reservations).
 *  - release()/fulfill(): ACTIVE → RELEASED/FULFILLED status transition
 *    (NOT a physical delete — releasedAt/fulfilledAt/releaseReason exist
 *    precisely to record this, and FULFILLED must persist for Module 8).
 *    INV-3 only counts ACTIVE reservations toward availability, so the
 *    transition frees stock. A phase-2 reservation also decrements
 *    stock_levels.qtyReserved (atomic SQL decrement).
 *
 * Concurrency: phase-1's availability check is a best-effort soft guard
 * (READ COMMITTED, no lock — locked decision #9 protects stock_levels via
 * version, not these floating rows). Two racing reservers can transiently
 * over-claim; the HARD physical guard is phase-2 allocation through
 * StockMutationService's version path, which can never allocate more than
 * physically on hand. This is inherent to the LATE-allocation model — see
 * phase-1a-debt (added at module end).
 *
 * ── SANCTIONED CROSS-MODULE API (Module 6 / Module 8) ──────────────────
 *
 * reserve(input): ReservationView
 *   Module 6 calls this at order-confirm. Creates a PHASE-1 ACTIVE
 *   reservation (binId/batchId NULL) — a SOFT qty claim. The availability
 *   check is best-effort (READ COMMITTED, no lock); transient over-claim
 *   under concurrency is possible and intentional — the HARD physical
 *   guard is phase-2 (StockPickAllocationService.allocateAndPopulate,
 *   version-CAS on stock_levels). Throws InsufficientStockError when
 *   qty > live available. Caller supplies orderId/orderItemId (NOT NULL
 *   FK columns). expiresAt = now + (seller.reservationTtlHoursOverride ??
 *   ops.stock_reservation_ttl_hours ?? 48).
 *
 * release(id, reason, actor?, now?): ReleaseResult
 *   ACTIVE → RELEASED (status transition, NOT a physical delete). NO-OP-
 *   SAFE / idempotent: a non-ACTIVE reservation returns
 *   { qtyReleased: 0, alreadyInactive: true } without side effects. A
 *   phase-2 reservation additionally gives back stock_levels.qtyReserved
 *   via an atomic clamped SQL decrement. INV-3 stops counting it toward
 *   availability immediately. Module 6 calls this on order cancel.
 *
 * fulfill(id, actor?, now?): ReleaseResult
 *   ACTIVE → FULFILLED. Same no-op-safe idempotency as release(). Module 8
 *   calls this at pick completion; the physical qtyOnHand decrement is a
 *   SEPARATE StockMutationService PICK movement — fulfill() only clears
 *   the reservation hold (+ phase-2 qtyReserved give-back).
 *
 * resolveTtlHours(sellerId): number  — effective reservation TTL.
 * ───────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class StockReservationService {
  private readonly logger = new Logger(StockReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly availability: StockAvailabilityService,
  ) {}

  /** PHASE-1: soft qty claim, NULL bin/batch. Module 6 calls this at
   *  order confirm. */
  async reserve(input: ReserveInput): Promise<ReservationView> {
    const qty = input.qtyToReserve;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ConflictException({
        code: 'INVALID_RESERVE_QTY',
        message: 'qtyToReserve must be a positive integer',
      });
    }
    const now = input.now ?? new Date();

    // INV-2: availability MUST be read live (never the display cache) on a
    // mutation path. The shared primitive clamps to ≥0 — the best-effort
    // soft guard below is unchanged for any positive qty (the HARD guard
    // is phase-2 version-CAS allocation, see class JSDoc).
    const available = await this.availability.compute({
      sellerId: input.sellerId,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
    });
    if (qty > available) {
      throw new InsufficientStockError(qty, available);
    }

    const ttlHours = await this.resolveTtlHours(input.sellerId);
    const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);

    const row = await this.prisma.client.stockReservation.create({
      data: {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: null, // phase-1
        batchId: null, // phase-1
        qtyReserved: qty,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        status: ReservationStatus.ACTIVE,
        expiresAt,
      },
      select: RESERVATION_SELECT,
    });
    this.logger.log(
      { reservationId: row.id, sellerId: input.sellerId, variantId: input.variantId, qty, expiresAt },
      'Phase-1 reservation created',
    );
    return row;
  }

  /** ACTIVE → RELEASED. Idempotent: a non-ACTIVE reservation is a no-op.
   *  Phase-2 reservations also give back stock_levels.qtyReserved. */
  async release(
    reservationId: string,
    reason: ReservationReleaseReason,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    now: Date = new Date(),
  ): Promise<ReleaseResult> {
    return this.transition(reservationId, ReservationStatus.RELEASED, reason, actor, now);
  }

  /** ACTIVE → FULFILLED (Module 8 pick completion). The physical qtyOnHand
   *  decrement is a separate StockMutationService PICK movement; here we
   *  only clear the reservation hold. */
  async fulfill(
    reservationId: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    now: Date = new Date(),
  ): Promise<ReleaseResult> {
    return this.transition(reservationId, ReservationStatus.FULFILLED, null, actor, now);
  }

  /**
   * Effective reservation TTL: seller.reservationTtlHoursOverride wins,
   * else ops.stock_reservation_ttl_hours, else a hard fallback.
   */
  async resolveTtlHours(sellerId: string): Promise<number> {
    const [seller, setting] = await Promise.all([
      this.prisma.client.seller.findUnique({
        where: { id: sellerId },
        select: { reservationTtlHoursOverride: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: RESERVATION_TTL_SETTING_KEY },
        select: { valueInt: true },
      }),
    ]);
    return (
      seller?.reservationTtlHoursOverride ?? setting?.valueInt ?? DEFAULT_TTL_HOURS
    );
  }

  /**
   * ACTIVE reservations for an order. Sanctioned cross-module read added
   * for Module 6 (expand-by-need boundary — same precedent as
   * CatalogReadService; see phase-1a-debt). OrderWriteService needs the
   * reservation ids to release()/fulfill() on a *later* transition
   * (cancel / delivered) without querying stock_reservations directly
   * (CLAUDE MUST #15). Read-only; ACTIVE only (release/fulfill are no-op
   * on the rest anyway, but filtering keeps the caller's intent clear).
   */
  async listActiveForOrder(
    orderId: string,
  ): Promise<Array<Pick<ReservationView, 'id' | 'orderItemId' | 'qtyReserved'>>> {
    return this.prisma.client.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
      select: { id: true, orderItemId: true, qtyReserved: true },
    });
  }

  /**
   * ACTIVE reservations for an order WITH their stock location
   * (sellerId / variantId / warehouseId / binId / batchId). Sanctioned
   * cross-module read added for Module 9 (expand-by-need — same
   * precedent as `listActiveForOrder` and M8's `releaseAllocation`).
   * The Model-A `DISPATCH_STOCK` saga (M9 commit 12) needs bin+batch
   * per phase-2 reservation to issue the `DISPATCH` StockMovement that
   * decrements qtyOnHand at dispatch.
   *
   * A row with `binId === null || batchId === null` is a phase-1
   * residual (an unallocated shortfall — should not exist at
   * PENDING_DISPATCH, but the caller defensively skips it rather than
   * issuing a movement with no concrete location).
   */
  async listActiveForOrderWithLocations(
    orderId: string,
  ): Promise<
    Array<
      Pick<
        ReservationView,
        | 'id'
        | 'orderItemId'
        | 'qtyReserved'
        | 'sellerId'
        | 'variantId'
        | 'warehouseId'
        | 'binId'
        | 'batchId'
      >
    >
  > {
    return this.prisma.client.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
      select: {
        id: true,
        orderItemId: true,
        qtyReserved: true,
        sellerId: true,
        variantId: true,
        warehouseId: true,
        binId: true,
        batchId: true,
      },
    });
  }

  // ---------- internal ----------

  private async transition(
    reservationId: string,
    to: ReservationStatus,
    reason: ReservationReleaseReason | null,
    actor: { type: ActorType; id?: string | null },
    now: Date,
  ): Promise<ReleaseResult> {
    const resv = await this.prisma.client.stockReservation.findUnique({
      where: { id: reservationId },
      select: RESERVATION_SELECT,
    });
    if (!resv) {
      throw new NotFoundException({
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found',
      });
    }
    if (resv.status !== ReservationStatus.ACTIVE) {
      // Idempotent — release/fulfill of an already-terminal reservation.
      return {
        reservationId,
        qtyReleased: 0,
        status: resv.status,
        alreadyInactive: true,
      };
    }

    // Locals so TS narrows null away for the phase-2 stock_levels filter.
    const binId = resv.binId;
    const batchId = resv.batchId;
    const isPhase2 = binId !== null && batchId !== null;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.stockReservation.update({
        where: { id: reservationId },
        data:
          to === ReservationStatus.RELEASED
            ? { status: to, releasedAt: now, releaseReason: reason }
            : { status: to, fulfilledAt: now },
      });

      if (binId !== null && batchId !== null) {
        // Give back the phase-2 hold (INV-4). Atomic SQL decrement —
        // race-safe; clamp so a double-release can't drive it negative.
        await tx.stockLevel.updateMany({
          where: {
            sellerId: resv.sellerId,
            variantId: resv.variantId,
            warehouseId: resv.warehouseId,
            binId,
            batchId,
            qtyReserved: { gte: resv.qtyReserved },
          },
          data: { qtyReserved: { decrement: resv.qtyReserved } },
        });
      }

      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action:
            to === ReservationStatus.RELEASED
              ? 'inventory.reservation.released'
              : 'inventory.reservation.fulfilled',
          entityType: 'stock_reservation',
          entityId: reservationId,
          metadata: {
            sellerId: resv.sellerId,
            variantId: resv.variantId,
            warehouseId: resv.warehouseId,
            qty: resv.qtyReserved,
            phase: isPhase2 ? 2 : 1,
            reason,
          },
        },
        tx,
      );
    });

    return {
      reservationId,
      qtyReleased: resv.qtyReserved,
      status: to,
      alreadyInactive: false,
    };
  }
}
