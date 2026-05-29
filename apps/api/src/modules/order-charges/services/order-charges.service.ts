import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  ChargeType,
  OrderChargeStatus,
  PaymentMode,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  PricingEngineService,
  type PricingComputeOutput,
} from '../../pricing/services/pricing-engine.service';

/**
 * Module 17 — Order Charges read service + the admin "compute &
 * persist" action that closes the M15 fast-follow at the order
 * level. Two read paths (one is a seller-scoped variant), one write
 * path (admin-only — computes via PricingEngineService, persists one
 * OrderCharge row per line, status=ESTIMATED).
 *
 * Idempotency: `persistForOrder` is GATED on "no non-deleted
 * OrderCharge rows for this order" — a second call short-circuits
 * with 409 CHARGES_ALREADY_EXIST. To re-compute, the admin must
 * first soft-delete the existing rows (a separate admin action;
 * out of M17 scope).
 */

export interface OrderChargeView {
  readonly id: string;
  readonly orderId: string;
  readonly shipmentId: string | null;
  readonly type: ChargeType;
  readonly amountInr: string;
  readonly taxRate: string | null;
  readonly taxAmountInr: string | null;
  readonly totalAmountInr: string;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly isVisibleToSeller: boolean;
  readonly status: OrderChargeStatus;
  readonly createdAt: string;
}

export interface PersistChargesResult {
  readonly orderId: string;
  readonly persistedCount: number;
  readonly compute: PricingComputeOutput;
}

@Injectable()
export class OrderChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly pricing: PricingEngineService,
  ) {}

  /** Admin read — returns ALL non-deleted charges, including
   *  isVisibleToSeller=false rows. */
  async listForOrderAdmin(orderId: string): Promise<readonly OrderChargeView[]> {
    const rows = await this.prisma.client.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  /** Seller read — same shape, but filtered to isVisibleToSeller=true
   *  AND ownership-guarded against the seller. Throws NOT_FOUND if
   *  the order doesn't belong to the seller (matches the existing
   *  seller-orders 404 shape). */
  async listForOrderSeller(
    sellerId: string,
    orderId: string,
  ): Promise<readonly OrderChargeView[]> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    const rows = await this.prisma.client.orderCharge.findMany({
      where: { orderId, isVisibleToSeller: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Admin "Compute & persist charges" — calls PricingEngineService
   * with the order's snapshot, persists each line as an OrderCharge.
   * This is the M15 integration at the order level; the future M6
   * order-create hook can call the same method post-commit.
   */
  async persistForOrder(orderId: string, staffId: string): Promise<PersistChargesResult> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        paymentMode: true,
        codAmountInr: true,
        declaredValueInr: true,
        totalWeightGrams: true,
        recipientPostalCode: true,
        recipientCountryCode: true,
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }

    // Idempotency gate — any non-deleted charge means we don't recompute.
    const existing = await this.prisma.client.orderCharge.count({
      where: { orderId, deletedAt: null },
    });
    if (existing > 0) {
      throw new ConflictException({
        code: 'CHARGES_ALREADY_EXIST',
        message: `Order ${orderId} already has ${existing} persisted charges; soft-delete first to recompute`,
      });
    }

    const compute = await this.pricing.compute({
      sellerId: order.sellerId,
      recipientPostalCode: order.recipientPostalCode,
      recipientCountryCode: order.recipientCountryCode,
      paymentMode: order.paymentMode as PaymentMode,
      codAmountInr: Number(order.codAmountInr ?? 0),
      declaredValueInr: Number(order.declaredValueInr ?? 0),
      totalWeightGrams: order.totalWeightGrams ?? 0,
    });

    return this.prisma.client.$transaction(async (tx) => {
      let displayOrder = 0;
      let persistedCount = 0;

      // Base shipping line (always written, even at 0 — explicitness).
      await tx.orderCharge.create({
        data: {
          orderId,
          type: ChargeType.BASE_SHIPPING,
          amountInr: new Prisma.Decimal(compute.baseShippingInr),
          isTaxable: false,
          totalAmountInr: new Prisma.Decimal(compute.baseShippingInr),
          description: 'Base shipping',
          displayOrder: displayOrder++,
          isVisibleToSeller: true,
          rateCardId: compute.rateCardId,
          computationContext: compute.computationContext as unknown as Prisma.InputJsonValue,
          status: OrderChargeStatus.ESTIMATED,
        },
      });
      persistedCount++;

      for (const line of compute.surcharges) {
        await tx.orderCharge.create({
          data: {
            orderId,
            type: line.type,
            amountInr: new Prisma.Decimal(line.amountInr),
            isTaxable: false,
            totalAmountInr: new Prisma.Decimal(line.amountInr),
            description: line.description,
            displayOrder: displayOrder++,
            isVisibleToSeller: true,
            rateCardId: compute.rateCardId,
            surchargeRuleId: line.surchargeRuleId,
            status: OrderChargeStatus.ESTIMATED,
          },
        });
        persistedCount++;
      }

      // GST line — taxRate set so the seller-side UI can label it.
      await tx.orderCharge.create({
        data: {
          orderId,
          type: ChargeType.GST,
          amountInr: new Prisma.Decimal(compute.gstAmountInr),
          isTaxable: false,
          taxRate: new Prisma.Decimal(compute.gstRatePercent),
          totalAmountInr: new Prisma.Decimal(compute.gstAmountInr),
          description: `GST @ ${compute.gstRatePercent}%`,
          displayOrder: displayOrder++,
          isVisibleToSeller: true,
          rateCardId: compute.rateCardId,
          status: OrderChargeStatus.ESTIMATED,
        },
      });
      persistedCount++;

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.order_charges.persisted',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            persistedCount,
            totalInr: compute.totalInr,
            rateCardId: compute.rateCardId,
            unresolved: compute.unresolved,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      return { orderId, persistedCount, compute };
    });
  }

  private toView(row: Prisma.OrderChargeGetPayload<object>): OrderChargeView {
    return {
      id: row.id,
      orderId: row.orderId,
      shipmentId: row.shipmentId,
      type: row.type,
      amountInr: row.amountInr.toFixed(2),
      taxRate: row.taxRate?.toFixed(2) ?? null,
      taxAmountInr: row.taxAmountInr?.toFixed(2) ?? null,
      totalAmountInr: row.totalAmountInr.toFixed(2),
      description: row.description,
      displayOrder: row.displayOrder,
      isVisibleToSeller: row.isVisibleToSeller,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
