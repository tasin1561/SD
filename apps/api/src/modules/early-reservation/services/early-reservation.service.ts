import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  EarlyReservationReviewStatus,
  ReservationBookingStage,
  ReservationReleaseReason,
  ReservationStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  InsufficientStockError,
  StockReservationService,
} from '../../inventory-stock/services/stock-reservation.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

const ENABLED_KEY = 'inventory.early_reservation_enabled';
const NDR_ACTION_KEY = 'inventory.early_reservation_ndr_action';
const TTL_KEY = 'inventory.early_reservation_ttl_hours';
const MANUAL_REVIEW = 'MANUAL_REVIEW';

/** One order line to hold stock for. The CALLER marshals this (R3
 *  snapshot-DTO discipline) so this service needs no Order dependency
 *  and both `order` and `call-center` can import it without a cycle. */
export interface EarlyReservationLine {
  readonly orderItemId: string;
  readonly variantId: string;
  readonly quantity: number;
}

export interface EarlyReservationRequest {
  readonly orderId: string;
  readonly sellerId: string;
  readonly warehouseId: string;
  readonly lines: readonly EarlyReservationLine[];
}

export interface EarlyReservationOutcome {
  readonly reserved: number;
  readonly skipped: number;
  /** false ⇒ the seller has not opted into at-placement booking. */
  readonly enabled: boolean;
}

export type NdrCapOutcome =
  | { readonly kind: 'NO_EARLY_HOLD' }
  | { readonly kind: 'AUTO_RELEASED'; readonly releasedCount: number }
  | { readonly kind: 'MANUAL_REVIEW'; readonly reviewId: string; readonly heldQty: number };

/**
 * R5 — the at-placement ("virtual") half of two-stage inventory booking.
 *
 * Stage 1 (this service): an opted-in seller has stock claimed the moment
 * an order lands, before anyone has called the customer.
 * Stage 2 (unchanged): `OrderWriteService.transitionStatus`'s existing
 * saga claims at CONFIRMED.
 *
 * Deliberately BEST-EFFORT on the way in: insufficient stock must NOT
 * block order creation. The at-CONFIRMED saga fail-routes to
 * OUT_OF_STOCK because a confirmed order really cannot be fulfilled; an
 * unconfirmed order with no early hold is just a normal order that will
 * claim stock later. Failing creation there would turn an optimisation
 * into an outage.
 */
@Injectable()
export class EarlyReservationService {
  private readonly logger = new Logger(EarlyReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: StockReservationService,
    private readonly settings: SettingsResolverService,
    private readonly audit: AuditLogService,
  ) {}

  /** Stage 1. No-op unless the seller opted in. Never throws. */
  async reserveAtPlacement(req: EarlyReservationRequest): Promise<EarlyReservationOutcome> {
    try {
      const enabled = await this.settings.resolve(req.sellerId, ENABLED_KEY);
      if (enabled.value !== true) {
        return { reserved: 0, skipped: req.lines.length, enabled: false };
      }

      // Idempotent: a re-fired placement hook must not double-hold.
      const already = await this.prisma.client.stockReservation.findFirst({
        where: {
          orderId: req.orderId,
          bookingStage: ReservationBookingStage.AT_PLACEMENT,
          status: ReservationStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (already) {
        return { reserved: 0, skipped: req.lines.length, enabled: true };
      }

      const ttl = await this.settings.resolve(req.sellerId, TTL_KEY);
      const ttlHours = Number(ttl.value);

      let reserved = 0;
      let skipped = 0;
      for (const line of req.lines) {
        try {
          await this.reservations.reserve({
            sellerId: req.sellerId,
            variantId: line.variantId,
            warehouseId: req.warehouseId,
            qtyToReserve: line.quantity,
            orderId: req.orderId,
            orderItemId: line.orderItemId,
            bookingStage: ReservationBookingStage.AT_PLACEMENT,
            ttlHoursOverride: ttlHours,
          });
          reserved += 1;
        } catch (err) {
          // Per-line isolation: one out-of-stock SKU must not deny the
          // rest of the order its hold.
          skipped += 1;
          if (!(err instanceof InsufficientStockError)) {
            this.logger.warn(
              { orderId: req.orderId, variantId: line.variantId, err: (err as Error).message },
              'At-placement reservation failed for a line; continuing',
            );
          }
        }
      }

      if (reserved > 0) {
        await this.audit.log({
          actorType: ActorType.SYSTEM,
          sellerId: req.sellerId,
          action: 'inventory.early_reservation.created',
          entityType: 'order',
          entityId: req.orderId,
          severity: 'LOW',
          metadata: { reserved, skipped, ttlHours },
        });
      }
      return { reserved, skipped, enabled: true };
    } catch (err) {
      // Belt-and-braces: this hook can never fail an order create.
      this.logger.error(
        { orderId: req.orderId, err: (err as Error).message },
        'At-placement reservation hook failed wholesale; order is unaffected',
      );
      return { reserved: 0, skipped: req.lines.length, enabled: false };
    }
  }

  /**
   * Call-attempt cap reached. MUST be invoked BEFORE the REJECTED_NDR
   * transition: the durable side-effect (release, or the review row that
   * says "we are still holding this") goes first, so a crash can never
   * leave a REJECTED_NDR order with silently-held stock. Re-running is
   * safe — release is natively idempotent and the review row is unique
   * per order.
   */
  async handleNdrCap(
    orderId: string,
    sellerId: string,
    attemptCount: number,
  ): Promise<NdrCapOutcome> {
    const holds = await this.prisma.client.stockReservation.findMany({
      where: {
        orderId,
        bookingStage: ReservationBookingStage.AT_PLACEMENT,
        status: ReservationStatus.ACTIVE,
      },
      select: { id: true, qtyReserved: true },
    });
    if (holds.length === 0) return { kind: 'NO_EARLY_HOLD' };

    const action = await this.settings.resolve(sellerId, NDR_ACTION_KEY);
    const heldQty = holds.reduce((sum, h) => sum + h.qtyReserved, 0);

    if (action.value === MANUAL_REVIEW) {
      const review = await this.prisma.client.earlyReservationReview.upsert({
        where: { orderId },
        create: {
          orderId,
          sellerId,
          status: EarlyReservationReviewStatus.OPEN,
          attemptCount,
          heldQty,
        },
        update: {},
      });
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        sellerId,
        action: 'inventory.early_reservation.review_raised',
        entityType: 'order',
        entityId: orderId,
        severity: 'MEDIUM',
        metadata: { reviewId: review.id, heldQty, attemptCount },
      });
      return { kind: 'MANUAL_REVIEW', reviewId: review.id, heldQty };
    }

    let releasedCount = 0;
    for (const hold of holds) {
      const res = await this.reservations.release(
        hold.id,
        ReservationReleaseReason.NDR_CAP_REACHED,
        { type: ActorType.SYSTEM },
      );
      if (!res.alreadyInactive) releasedCount += 1;
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      sellerId,
      action: 'inventory.early_reservation.auto_released',
      entityType: 'order',
      entityId: orderId,
      severity: 'MEDIUM',
      metadata: { releasedCount, heldQty, attemptCount },
    });
    return { kind: 'AUTO_RELEASED', releasedCount };
  }
}
