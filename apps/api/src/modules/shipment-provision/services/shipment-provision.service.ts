import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ActorType, Prisma, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { ShipmentNumberingService } from './shipment-numbering.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { parcelBox } from './parcel-box';

const SETTING_DEFAULT_WAREHOUSE = 'ops.default_warehouse_id';

type DecimalIn = Prisma.Decimal | string | number;

export interface ProvisionShipmentItemInput {
  orderItemId: string;
  quantity: number;
  skuCode: string;
  productName: string;
  variantLabel?: string | null;
  unitWeightGrams?: number | null;
  /** The box as sold, snapshotted on the order line (ORD-6). */
  unitLengthCm?: number | null;
  unitWidthCm?: number | null;
  unitHeightCm?: number | null;
  unitDeclaredValueInr?: DecimalIn | null;
  unitPriceInr?: DecimalIn | null;
}

/**
 * Order-derived snapshot the CALLER (M6's post-commit hook on
 * →CONFIRMED) marshals and passes. The primitive intentionally takes a
 * DTO — NOT an orderId to resolve — so it carries NO Order dependency
 * (the R3 variant: shared primitives are dependency-free; if the op
 * needs upstream data the caller marshals it).
 */
export interface ProvisionShipmentInput {
  orderId: string;
  /**
   * The courier this parcel is provisioned with — resolved by the CALLER,
   * per seller, through SettingsResolverService (`ops.default_courier_code`
   * is seller-overridable, 2026-09-12). Required, and deliberately not
   * re-read here: this primitive has no seller context and must stay
   * dependency-free (R3), and a global fallback in here would be a second
   * reader of the key that silently ignores a seller pinned to `manual`
   * — i.e. a live waybill booked for a seller who asked for none.
   */
  courierCode: string;
  recipient: {
    name: string;
    phoneE164: string;
    addressLine1: string;
    addressLine2?: string | null;
    landmark?: string | null;
    city: string;
    stateProvince: string;
    postalCode: string;
    countryCode?: string | null;
  };
  declaredValueInr: DecimalIn;
  codAmountInr?: DecimalIn | null;
  totalWeightGrams?: number | null;
  items: ProvisionShipmentItemInput[];
}

export interface ProvisionResult {
  shipmentId: string;
  /** false ⇒ an open shipment already existed (idempotent no-op). */
  created: boolean;
}

/**
 * What an order LIST row shows about its parcel. A display read, not the
 * shipment: raw `courierCode` is a routing fact (CUR-8, 'manual' is not a
 * name), so both the registry name and the manual name travel and the
 * client resolves them with `courierLabel`.
 */
export interface OrderShipmentSummary {
  awbNumber: string | null;
  courierCode: string;
  courierDisplayName: string | null;
  manualCourierName: string | null;
  /** Actual, else declared, else the booked total. */
  weightGrams: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

/**
 * Module 8 — the R3 SHARED PRIMITIVE (standalone `shipment-provision`
 * module). Creates the dispatch parcel (`Shipment` + `OrderShipment` +
 * `ShipmentItem`s, status CREATED) on order CONFIRMED, and voids it on a
 * pre-pick cancellation. Imported by BOTH `order` (M6's CC-6 hook) and
 * the `warehouse-*` modules; it imports NEITHER — that one-way fan-in
 * removes the would-be order ↔ warehouse-pick cycle WITHOUT forwardRef
 * (same R3 spirit as M7's `call-queue`, but DTO-in rather than
 * orderId-in because shipment construction needs full order data).
 *
 * originWarehouseId is resolved from system_settings here (shared
 * infra, not an Order dependency). courierCode is NOT — it is
 * per-seller (SET-1) and arrives in the DTO, marshalled by the caller.
 * Both mutators are idempotent + best-effort-safe (CC-6 dual-path).
 */
@Injectable()
export class ShipmentProvisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: ShipmentNumberingService,
  ) {}

  /** Create the parcel for a freshly-CONFIRMED order. Idempotent: an
   *  existing non-CANCELLED shipment for the order is returned unchanged
   *  (CC-6 dual-path — safe to call from a retried post-commit hook). */
  async provisionFromSnapshot(
    input: ProvisionShipmentInput,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    ctx?: ClientContext,
  ): Promise<ProvisionResult> {
    const existing = await this.findLive(this.prisma.client, input.orderId);
    if (existing) {
      return { shipmentId: existing.shipmentId, created: false };
    }

    const courierCode = input.courierCode.trim();
    if (!courierCode) {
      throw new InternalServerErrorException({
        code: 'SHIPMENT_PROVISION_COURIER_MISSING',
        message: 'provisionFromSnapshot requires the caller to resolve a courier code',
      });
    }
    const originWarehouseId = await this.resolveSetting(SETTING_DEFAULT_WAREHOUSE);

    const totalWeightGrams =
      input.totalWeightGrams ??
      input.items.reduce((s, i) => s + (i.unitWeightGrams ?? 0) * i.quantity, 0);

    const parcel = parcelBox(input.items);

    const outcome = await this.prisma.client.$transaction(async (tx) => {
      // Read-then-create is not a guard under READ COMMITTED: two writers
      // of CONFIRMED (a transition and a god-mode force, or the AWB-less
      // sweep re-provisioning) both see "none" above and both create. The
      // per-order lock serialises them and the re-check inside it sees the
      // winner's committed row.
      await takeAdvisoryLock(tx, AdvisoryLock.SHIPMENT_PROVISION, input.orderId);
      const raced = await this.findLive(tx, input.orderId);
      if (raced) return { shipmentId: raced.shipmentId, created: false };

      const shipmentNumber = await this.numbering.nextShipmentNumber(tx);
      const shipment = await tx.shipment.create({
        data: {
          shipmentNumber,
          courierCode,
          originWarehouseId,
          destRecipientName: input.recipient.name,
          destRecipientPhoneE164: input.recipient.phoneE164,
          destAddressLine1: input.recipient.addressLine1,
          destAddressLine2: input.recipient.addressLine2 ?? null,
          destLandmark: input.recipient.landmark ?? null,
          destCity: input.recipient.city,
          destStateProvince: input.recipient.stateProvince,
          destPostalCode: input.recipient.postalCode,
          destCountryCode: input.recipient.countryCode ?? 'IN',
          totalWeightGrams,
          lengthCm: parcel === null ? null : new Prisma.Decimal(parcel.lengthCm),
          widthCm: parcel === null ? null : new Prisma.Decimal(parcel.widthCm),
          heightCm: parcel === null ? null : new Prisma.Decimal(parcel.heightCm),
          declaredValueInr: new Prisma.Decimal(input.declaredValueInr),
          codAmountInr: input.codAmountInr == null ? null : new Prisma.Decimal(input.codAmountInr),
          status: ShipmentStatus.CREATED,
          orderShipments: {
            create: {
              orderId: input.orderId,
              isFullOrder: true,
              shipmentSequence: 1,
            },
          },
          items: {
            create: input.items.map((i) => ({
              orderItemId: i.orderItemId,
              quantity: i.quantity,
              skuCode: i.skuCode,
              productName: i.productName,
              variantLabel: i.variantLabel ?? null,
              unitWeightGrams: i.unitWeightGrams ?? null,
              unitDeclaredValueInr:
                i.unitDeclaredValueInr == null ? null : new Prisma.Decimal(i.unitDeclaredValueInr),
              unitPriceInr: i.unitPriceInr == null ? null : new Prisma.Decimal(i.unitPriceInr),
            })),
          },
        },
        select: { id: true, shipmentNumber: true },
      });

      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'shipment.provisioned',
          entityType: 'shipment',
          entityId: shipment.id,
          metadata: {
            orderId: input.orderId,
            shipmentNumber: shipment.shipmentNumber,
            courierCode,
            originWarehouseId,
            itemCount: input.items.length,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
      return { shipmentId: shipment.id, created: true };
    });

    return outcome;
  }

  private findLive(
    db: Pick<Prisma.TransactionClient, 'orderShipment'>,
    orderId: string,
  ): Promise<{ shipmentId: string } | null> {
    return db.orderShipment.findFirst({
      where: {
        orderId,
        shipment: { status: { not: ShipmentStatus.CANCELLED }, deletedAt: null },
      },
      select: { shipmentId: true },
    });
  }

  /** Void the order's open (pre-pick, status CREATED) shipment(s) on a
   *  cancellation. Idempotent: no open shipment ⇒ `{ voided: 0 }`. No M5
   *  side-effect — reservation release is M6's transitionStatus concern. */
  async voidForOrder(
    orderId: string,
    reason: string,
    actor: { type: ActorType; id?: string | null } = { type: ActorType.SYSTEM },
    ctx?: ClientContext,
  ): Promise<{ voided: number }> {
    const open = await this.prisma.client.orderShipment.findMany({
      where: {
        orderId,
        shipment: { status: ShipmentStatus.CREATED, deletedAt: null },
      },
      select: { shipmentId: true },
    });
    if (open.length === 0) return { voided: 0 };

    const ids = open.map((o) => o.shipmentId);
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.shipment.updateMany({
        where: { id: { in: ids }, status: ShipmentStatus.CREATED },
        data: { status: ShipmentStatus.CANCELLED, deletedAt: now },
      });
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          action: 'shipment.voided',
          entityType: 'shipment',
          entityId: ids[0] ?? orderId,
          severity: 'MEDIUM',
          metadata: {
            orderId,
            reason,
            shipmentIds: ids,
            count: ids.length,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });
    return { voided: ids.length };
  }

  /**
   * The current parcel of each order, for a page of the order list.
   *
   * ONE query for the whole page (WMS-1: the order module reads shipments
   * only through here). The newest live shipment wins when an order has
   * more than one (supersede / split); an order with none is simply
   * absent from the map.
   */
  async summariesForOrders(orderIds: string[]): Promise<Map<string, OrderShipmentSummary>> {
    const out = new Map<string, OrderShipmentSummary>();
    if (orderIds.length === 0) return out;
    const rows = await this.prisma.client.orderShipment.findMany({
      where: {
        orderId: { in: orderIds },
        shipment: { deletedAt: null, status: { not: ShipmentStatus.CANCELLED } },
      },
      orderBy: [{ shipmentSequence: 'asc' }, { createdAt: 'asc' }],
      select: {
        orderId: true,
        shipment: {
          select: {
            awbNumber: true,
            courierCode: true,
            manualCourierName: true,
            courier: { select: { displayName: true } },
            totalWeightGrams: true,
            declaredWeightGrams: true,
            actualWeightGrams: true,
            lengthCm: true,
            widthCm: true,
            heightCm: true,
          },
        },
      },
    });
    // Ascending, so the last row for an order is its newest.
    for (const r of rows) {
      const s = r.shipment;
      out.set(r.orderId, {
        awbNumber: s.awbNumber,
        courierCode: s.courierCode,
        courierDisplayName: s.courier?.displayName ?? null,
        manualCourierName: s.manualCourierName,
        weightGrams: s.actualWeightGrams ?? s.declaredWeightGrams ?? s.totalWeightGrams,
        lengthCm: s.lengthCm === null ? null : s.lengthCm.toNumber(),
        widthCm: s.widthCm === null ? null : s.widthCm.toNumber(),
        heightCm: s.heightCm === null ? null : s.heightCm.toNumber(),
      });
    }
    return out;
  }

  // ── internal ──────────────────────────────────────────────────────

  private async resolveSetting(key: string): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueString: true },
    });
    const value = row?.valueString?.trim();
    if (!value) {
      throw new InternalServerErrorException({
        code: 'SHIPMENT_PROVISION_SETTING_MISSING',
        message: `${key} is not set`,
      });
    }
    return value;
  }
}
