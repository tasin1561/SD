import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  OrderReadService,
  type ResolvedOrder,
} from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/** Effective pick-task timeout when ops.pick_task_timeout_hours is unset
 *  — mirrors the seeded default (commit 2). */
const DEFAULT_PICK_TIMEOUT_HOURS = 4;
const PICK_TIMEOUT_SETTING_KEY = 'ops.pick_task_timeout_hours';

export interface PulledPickItem {
  shipmentItemId: string;
  orderItemId: string;
  skuCode: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitWeightGrams: number | null;
}

export interface PulledPick {
  /** The pick task IS the shipment (Module 8 is shipment-centric — no
   *  task table, WMS-9). `pickId === shipmentId`. */
  pickId: string;
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  /** The CAS token for the WMS-5 timeout sweep (commit 7) — the
   *  M7-`assignedAt` analogue. */
  pickStartedAt: Date;
  pickExpiresAt: Date;
  items: PulledPickItem[];
  /** Order snapshot (recipient + items) for the picker. null only if the
   *  referenced order vanished (data anomaly — logged). */
  order: ResolvedOrder | null;
}

/**
 * Module 8 — warehouse pick pull (WMS-1, WMS-2). The picker-facing
 * analogue of M7's `CallAssignmentService.pullNext`: hand the next
 * eligible parcel to a picker and CLAIM it so no one else can.
 *
 * Concurrency (locked decision, mirrors M7): the pickable shipment is
 * selected with `FOR UPDATE OF s SKIP LOCKED LIMIT 1` inside the SAME tx
 * that stamps `pickStartedAt`/`pickStartedByStaffId`/`pickExpiresAt`, so
 * two pickers pulling simultaneously can never get the same parcel (one
 * gets the next row, or QUEUE_EMPTY). Postgres-native — no advisory
 * locks. `FOR UPDATE OF s` restricts row locking to `shipments` ONLY:
 * the joined `orders` row is NOT locked, so a concurrent
 * `OrderWriteService.transitionStatus` (which locks the order row in its
 * own tx) can never deadlock against a pick pull.
 *
 * Eligibility (WMS-1, the authoritative gate is the ORDER status —
 * db-schema WMS-9): shipment `CREATED` + `pickStartedAt IS NULL` (claim
 * marker, also the re-pick gate after a WMS-5 expiry) AND its order in
 * {CONFIRMED, PENDING_PICK} AND neither soft-deleted. The order-status
 * predicate is a HARD filter, not a proxy: `ShipmentProvisionService.
 * voidForOrder` is a best-effort post-commit hook, so a cancelled/
 * rejected order whose void lagged must still be excluded here.
 *
 * FIFO = `ORDER BY s.created_at ASC` (the parcel was provisioned on
 * order CONFIRMED, so shipment creation order == confirmation order).
 *
 * Claim-vs-start split (mirrors M7 pull-vs-recordAttempt): `pullNext`
 * only CLAIMS the parcel (stamps the operational who/when + the timeout
 * token). The order's `CONFIRMED → PENDING_PICK` transition and the M5
 * phase-2 allocation are the picker's subsequent START action
 * (PickExecutionService, commit 6) — the order stays CONFIRMED between
 * pull and start, and a WMS-5 expiry (commit 7) just clears
 * `pickStartedAt` so the parcel re-enters the queue with no order-status
 * bounce.
 */
@Injectable()
export class PickQueueService {
  private readonly logger = new Logger(PickQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly audit: AuditLogService,
  ) {}

  /** Returns the claimed parcel (+ order snapshot), or `null` when no
   *  parcel is currently pickable (QUEUE_EMPTY). */
  async pullNext(
    staffId: string,
    ctx?: ClientContext,
  ): Promise<PulledPick | null> {
    const now = new Date();
    const pickExpiresAt = new Date(
      now.getTime() + (await this.timeoutHours()) * 3_600_000,
    );

    const picked = await this.prisma.client.$transaction(async (tx) => {
      // FIFO, eligible+unclaimed parcels only; FOR UPDATE OF s SKIP
      // LOCKED so concurrent pulls never collide AND only the shipment
      // row is locked (the orders join stays read-only — no contention
      // with OrderWriteService.transitionStatus). All literals are fixed
      // enum values, never user input — safe for $queryRawUnsafe (same
      // precedent as M7 CallAssignmentService.pullNext).
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT s.id
           FROM shipments s
           JOIN order_shipments os ON os.shipment_id = s.id
           JOIN orders o ON o.id = os.order_id
           WHERE s.status = 'created'
             AND s.pick_started_at IS NULL
             AND s.deleted_at IS NULL
             AND o.deleted_at IS NULL
             AND o.status IN ('confirmed','pending_pick')
           ORDER BY s.created_at ASC
           FOR UPDATE OF s SKIP LOCKED
           LIMIT 1`,
      );
      const id = rows[0]?.id;
      if (id === undefined) return null;

      const shipment = await tx.shipment.update({
        where: { id },
        data: {
          pickStartedAt: now,
          pickStartedByStaffId: staffId,
          pickExpiresAt,
        },
        select: {
          id: true,
          shipmentNumber: true,
          orderShipments: {
            select: { orderId: true },
            orderBy: { shipmentSequence: 'asc' },
            take: 1,
          },
          items: {
            select: {
              id: true,
              orderItemId: true,
              skuCode: true,
              productName: true,
              variantLabel: true,
              quantity: true,
              unitWeightGrams: true,
            },
          },
        },
      });

      const orderId = shipment.orderShipments[0]?.orderId ?? null;

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: staffId,
          action: 'warehouse_pick.pulled',
          entityType: 'shipment',
          entityId: shipment.id,
          severity: 'LOW',
          metadata: {
            orderId,
            shipmentNumber: shipment.shipmentNumber,
            pickExpiresAt: pickExpiresAt.toISOString(),
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );

      return {
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        orderId,
        items: shipment.items.map((i) => ({
          shipmentItemId: i.id,
          orderItemId: i.orderItemId,
          skuCode: i.skuCode,
          productName: i.productName,
          variantLabel: i.variantLabel,
          quantity: i.quantity,
          unitWeightGrams: i.unitWeightGrams,
        })),
      };
    });

    if (!picked) return null; // QUEUE_EMPTY

    if (picked.orderId === null) {
      // The parcel passed the orders-join filter but its OrderShipment
      // junction is gone — a data anomaly. The claim stands (the picker
      // still holds the parcel); surface it loudly.
      this.logger.error(
        { shipmentId: picked.shipmentId },
        'Pulled shipment has no OrderShipment junction row',
      );
      return {
        pickId: picked.shipmentId,
        shipmentId: picked.shipmentId,
        shipmentNumber: picked.shipmentNumber,
        orderId: '',
        pickStartedAt: now,
        pickExpiresAt,
        items: picked.items,
        order: null,
      };
    }

    const order = await this.orders.getById(picked.orderId);
    if (!order) {
      this.logger.error(
        { shipmentId: picked.shipmentId, orderId: picked.orderId },
        'Pulled shipment references a missing/soft-deleted order',
      );
    }
    return {
      pickId: picked.shipmentId,
      shipmentId: picked.shipmentId,
      shipmentNumber: picked.shipmentNumber,
      orderId: picked.orderId,
      pickStartedAt: now,
      pickExpiresAt,
      items: picked.items,
      order,
    };
  }

  /** Effective pick-task timeout (hours): ops.pick_task_timeout_hours,
   *  else the seeded default. */
  private async timeoutHours(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: PICK_TIMEOUT_SETTING_KEY },
      select: { valueInt: true },
    });
    return row?.valueInt ?? DEFAULT_PICK_TIMEOUT_HOURS;
  }
}
