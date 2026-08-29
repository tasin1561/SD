import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  RtoDisposition,
  ActorType,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  WarehouseStatus,
  SellerCapability,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import { RtoFeeAccrualService } from '../../seller-wallet-accrual/services/rto-fee-accrual.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface ReceiveRtoResult {
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  status: OrderStatus;
  rtoReceivedAt: Date;
  /** R6 — the warehouse the parcel was physically received at. Falls
   *  back to the shipment's origin warehouse when the caller did not
   *  specify one (pre-R6 behavior). */
  rtoReceivedWarehouseId: string;
  /** R6 — true ⇒ received somewhere OTHER than where it shipped from.
   *  RESTOCK finalize is blocked in this state (see
   *  RtoDispositionService restocks it into a lineage-preserving child
   *  batch at THIS warehouse — R6b). */
  crossWarehouse: boolean;
  /** true ⇒ idempotent no-op (already RTO_RECEIVED + stamped). */
  alreadyReceived: boolean;
}

/**
 * Module 8 — RTO receipt (commit 14, WMS-8). Marks the parcel as
 * physically arrived at the warehouse for RTO processing: stamps
 * shipment.rtoReceivedAt + drives the order to RTO_RECEIVED.
 *
 * Saga discipline (mirrors PickExecutionService.complete /
 * PackService.complete): operational stamp FIRST (guarded updateMany
 * idempotent on retry), authoritative transitionStatus LAST. Cross-
 * boundary failure (stamp OK / transition FAIL) leaves a TRUTHFUL
 * intermediate (rtoReceivedAt set, order still RTO_IN_TRANSIT/INITIATED)
 * that converges on retry — the stamp's guard skips re-application and
 * the transition retries cleanly.
 */
@Injectable()
export class RtoReceiptService {
  private readonly logger = new Logger(RtoReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
    private readonly orders: OrderReadService,
    private readonly orderWrite: OrderWriteService,
    private readonly audit: AuditLogService,
    private readonly units: StockUnitService,
    private readonly rtoFees: RtoFeeAccrualService,
    private readonly orderCharges: OrderChargesService,
  ) {}

  /**
   * Receive the RTO parcel by AWB. Canonical AWB is `shipments.awbNumber`
   * (Layer 7; `awb_labels` is the versioned PDF table, separate
   * concern). 404 on missing AWB / shipment / order. 409
   * ORDER_NOT_RTO_RECEIVABLE when the order is not in
   * {RTO_INITIATED, RTO_IN_TRANSIT} — the only inbound matrix edges to
   * RTO_RECEIVED.
   */
  async receive(
    awbNumber: string,
    staffId: string,
    ctx?: ClientContext,
    receivedWarehouseId?: string,
  ): Promise<ReceiveRtoResult> {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { awbNumber, deletedAt: null },
      select: {
        id: true,
        awbNumber: true,
        status: true,
        rtoReceivedAt: true,
        originWarehouseId: true,
        rtoReceivedWarehouseId: true,
        orderShipments: {
          // The seller comes through the ORDER — a shipment has none.
          select: { orderId: true, order: { select: { sellerId: true } } },
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
        },
      },
    });
    if (shipment !== null) {
      // A hold can cover booking returns back in. Offered because an
      // operator occasionally needs it, and it is the one that costs
      // the most: goods physically arrive whether or not we record
      // them, so a blocked return is a carton on the bench with no row
      // behind it. The admin screen says so before it is chosen.
      const sellerId = shipment.orderShipments[0]?.order.sellerId ?? null;
      if (sellerId !== null) {
        await this.restrictions.assertAllowed(sellerId, SellerCapability.RTO_RECEIVE);
      }
    }
    if (!shipment) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: `No shipment found with AWB ${awbNumber}`,
      });
    }
    const orderId = shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: `Shipment ${shipment.id} has no OrderShipment junction`,
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} for shipment ${shipment.id} not found`,
      });
    }

    // R6: validate the receiving warehouse BEFORE any write. An unknown
    // or non-ACTIVE warehouse is a caller error, not something to
    // silently coerce to origin.
    if (receivedWarehouseId !== undefined) {
      const warehouse = await this.prisma.client.warehouse.findFirst({
        where: { id: receivedWarehouseId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!warehouse) {
        throw new NotFoundException({
          code: 'WAREHOUSE_NOT_FOUND',
          message: `Warehouse ${receivedWarehouseId} not found`,
        });
      }
      if (warehouse.status !== WarehouseStatus.ACTIVE) {
        throw new ConflictException({
          code: 'WAREHOUSE_NOT_ACTIVE',
          message: `Warehouse ${receivedWarehouseId} is ${warehouse.status}; RTO receipt requires an ACTIVE warehouse`,
        });
      }
    }

    // Idempotent short-circuit: already RTO_RECEIVED + stamped. Reports
    // the ORIGINALLY-recorded receiving warehouse — a re-submit with a
    // different warehouse does NOT rewrite history.
    if (order.status === OrderStatus.RTO_RECEIVED && shipment.rtoReceivedAt !== null) {
      const settled = shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId;
      return {
        shipmentId: shipment.id,
        orderId,
        awbNumber,
        status: OrderStatus.RTO_RECEIVED,
        rtoReceivedAt: shipment.rtoReceivedAt,
        rtoReceivedWarehouseId: settled,
        crossWarehouse: settled !== shipment.originWarehouseId,
        alreadyReceived: true,
      };
    }
    if (order.status !== OrderStatus.RTO_INITIATED && order.status !== OrderStatus.RTO_IN_TRANSIT) {
      throw new ConflictException({
        code: 'ORDER_NOT_RTO_RECEIVABLE',
        message: `Order is ${order.status}; RTO receive requires RTO_INITIATED or RTO_IN_TRANSIT`,
      });
    }

    const now = new Date();
    // 1. OPERATIONAL stamp FIRST (idempotent: a retry after a failed
    //    transition finds rtoReceivedAt already set → count 0, original
    //    timestamp AND original receiving warehouse both preserved).
    //    R6: rtoReceivedWarehouseId rides the SAME guarded write, so the
    //    two can never disagree about which attempt won.
    const stamped = await this.prisma.client.shipment.updateMany({
      where: {
        id: shipment.id,
        rtoReceivedAt: null,
      },
      data: {
        rtoReceivedAt: now,
        ...(receivedWarehouseId === undefined
          ? {}
          : { rtoReceivedWarehouseId: receivedWarehouseId }),
      },
    });
    const wonTheStamp = stamped.count === 1;
    const rtoReceivedAt = wonTheStamp ? now : (shipment.rtoReceivedAt ?? now);
    const effectiveWarehouseId = wonTheStamp
      ? (receivedWarehouseId ?? shipment.originWarehouseId)
      : (shipment.rtoReceivedWarehouseId ?? shipment.originWarehouseId);
    const crossWarehouse = effectiveWarehouseId !== shipment.originWarehouseId;

    // 2. AUTHORITATIVE transition LAST. expectedFrom uses the order's
    //    actual current status — RTO_INITIATED or RTO_IN_TRANSIT — so
    //    the matrix accepts either path.
    await this.orderWrite.transitionStatus({
      orderId,
      to: OrderStatus.RTO_RECEIVED,
      actor: { type: ActorType.STAFF, id: staffId },
      expectedFrom: order.status,
      reason: `RTO parcel ${awbNumber} received at warehouse`,
      ...(ctx !== undefined ? { ctx } : {}),
    });

    // R6: a cross-warehouse return is audited at MEDIUM, not LOW — it
    // means stock came back somewhere other than where it left, which
    // blocks RESTOCK finalize and needs an ops decision.
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: crossWarehouse ? 'rto.received_cross_warehouse' : 'rto.received',
      entityType: 'shipment',
      entityId: shipment.id,
      severity: crossWarehouse ? 'MEDIUM' : 'LOW',
      metadata: {
        orderId,
        awbNumber,
        priorStatus: order.status,
        shipmentStatus: shipment.status as ShipmentStatus,
        originWarehouseId: shipment.originWarehouseId,
        rtoReceivedWarehouseId: effectiveWarehouseId,
        crossWarehouse,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    // The money. A returned parcel costs the delivery fee PLUS the flat
    // RTO fee (200 + 30 by default), and BOTH are charged here because
    // this is the moment the return became a fact rather than a scan.
    //
    // Best-effort and post-transition, deliberately: the parcel IS in
    // the building, and a wallet failure must not un-receive it. Both
    // halves are idempotent, so a retry or a re-submitted receive
    // converges rather than double-charging.
    try {
      // The delivery half of that 230 is swept from the order's CHARGE
      // ROWS, so an order that never had any is billed the ₹30 return
      // fee and not the ₹200 carriage — silently, because a zero sum
      // reads as "nothing to charge". Ensure they exist first.
      //
      // Pre-tx: persistForOrderSystem owns its own transaction (the M5
      // saga rule). Idempotent, and best-effort — a pricing failure
      // must not stop the return fee being taken.
      try {
        await this.orderCharges.persistForOrderSystem(orderId);
      } catch (chargeErr) {
        this.logger.warn(
          { orderId, err: chargeErr instanceof Error ? chargeErr.message : String(chargeErr) },
          'Could not compute charges before the RTO fee; the delivery leg may go unbilled',
        );
      }

      await this.prisma.client.$transaction((tx) =>
        this.rtoFees.chargeOnReceive(tx, orderId, order.sellerId),
      );
    } catch (err) {
      this.logger.error(
        { orderId, awbNumber, err: err instanceof Error ? err.message : String(err) },
        'RTO fee charge failed after receive — the parcel is received; the debit is not',
      );
    }

    // R4 — the parcel is physically back: walk its serialized units
    // DISPATCHED → RTO_RECEIVED at the warehouse that actually received
    // them (which may differ from origin — R6). Parcel-grained; the AWB
    // is the scanned thing at the returns bench. Best-effort + guarded on
    // fromStatus: the order transition above is the durable fact, and a
    // unit-ledger failure must not un-receive a parcel that is standing
    // in the building. The discrepancy report surfaces stragglers.
    try {
      await this.prisma.client.$transaction((tx) =>
        this.units.advanceUnitsForShipment(tx, {
          shipmentId: shipment.id,
          fromStatus: StockUnitStatus.DISPATCHED,
          toStatus: StockUnitStatus.RTO_RECEIVED,
          gate: 'RTO_RECEIVE',
          actorType: ActorType.STAFF,
          actorId: staffId,
          warehouseId: effectiveWarehouseId,
        }),
      );
    } catch (err) {
      this.logger.warn(
        { shipmentId: shipment.id, awbNumber, err: (err as Error).message },
        'RTO receive: unit ledger advance failed — parcel IS received; discrepancy report will surface the units',
      );
    }

    return {
      shipmentId: shipment.id,
      orderId,
      awbNumber,
      status: OrderStatus.RTO_RECEIVED,
      rtoReceivedAt,
      rtoReceivedWarehouseId: effectiveWarehouseId,
      crossWarehouse,
      alreadyReceived: false,
    };
  }

  /**
   * Returns sitting on the bench, waiting on somebody.
   *
   * The operator workflow — receive, inspect, finalise — has always
   * existed one shipment at a time, reachable only if you already knew
   * the id. A supervisor had no way to see what was waiting, which is
   * how a carton sits in RTO_HOLD for three weeks: nothing was broken,
   * nobody could see it.
   *
   * Two things qualify. Received but not finalised is the ordinary
   * backlog. Anything still marked INSPECT_LATER is the more
   * interesting one — an operator declined to guess, and until somebody
   * decides those goods are neither sellable nor written off.
   */
  async listOpen(warehouseId?: string): Promise<{
    items: Array<{
      shipmentId: string;
      shipmentNumber: string;
      awbNumber: string | null;
      orderNumber: string | null;
      sellerName: string | null;
      rtoReceivedAt: string | null;
      itemCount: number;
      undecidedCount: number;
      uninspectedCount: number;
    }>;
  }> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        deletedAt: null,
        rtoReceivedAt: { not: null },
        ...(warehouseId === undefined ? {} : { rtoReceivedWarehouseId: warehouseId }),
        // Finalising is what takes a return off this list. The order's
        // status is the authority on that (WMS-9), not a column on the
        // shipment.
        orderShipments: {
          some: {
            order: { status: { notIn: [OrderStatus.RTO_RESTOCKED, OrderStatus.RTO_DAMAGED] } },
          },
        },
      },
      orderBy: { rtoReceivedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        rtoReceivedAt: true,
        items: { select: { rtoDisposition: true, rtoCondition: true } },
        orderShipments: {
          take: 1,
          select: {
            order: {
              select: { orderNumber: true, seller: { select: { companyName: true } } },
            },
          },
        },
      },
    });

    return {
      items: rows.map((r) => ({
        shipmentId: r.id,
        shipmentNumber: r.shipmentNumber,
        awbNumber: r.awbNumber,
        orderNumber: r.orderShipments[0]?.order.orderNumber ?? null,
        sellerName: r.orderShipments[0]?.order.seller?.companyName ?? null,
        rtoReceivedAt: r.rtoReceivedAt?.toISOString() ?? null,
        itemCount: r.items.length,
        undecidedCount: r.items.filter((i) => i.rtoDisposition === RtoDisposition.INSPECT_LATER)
          .length,
        uninspectedCount: r.items.filter(
          (i) => i.rtoCondition === null || i.rtoDisposition === null,
        ).length,
      })),
    };
  }
}
