import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, ChargeType, OrderChargeStatus, PaymentMode, Prisma } from '@skydrop/db';
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
  async listForOrderSeller(sellerId: string, orderId: string): Promise<readonly OrderChargeView[]> {
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
  /**
   * System-actor variant for the auto-compute-on-order-create hook
   * (M15→M6 wire). Delegates to the same write path but audits as
   * ActorType.SYSTEM and treats `CHARGES_ALREADY_EXIST` as a clean
   * no-op (the admin "compute" button surfaces it as 409 to the
   * operator; the post-commit hook should never noisily error
   * because of a benign duplicate).
   */
  async persistForOrderSystem(
    orderId: string,
  ): Promise<PersistChargesResult | { skipped: true; reason: string }> {
    try {
      return await this.persistForOrderInternal(orderId, { kind: 'system' });
    } catch (e) {
      if (e instanceof Error && e.message.includes('CHARGES_ALREADY_EXIST')) {
        return { skipped: true, reason: 'CHARGES_ALREADY_EXIST' };
      }
      throw e;
    }
  }

  async persistForOrder(orderId: string, staffId: string): Promise<PersistChargesResult> {
    return this.persistForOrderInternal(orderId, { kind: 'staff', staffId });
  }

  private async persistForOrderInternal(
    orderId: string,
    actor: { kind: 'staff'; staffId: string } | { kind: 'system' },
  ): Promise<PersistChargesResult> {
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

    // ── Refuse to record a price we could not compute ────────────────
    //
    // The engine ANSWERS even when the data behind it is missing: an
    // unresolved destination falls back to the DEFAULT zone, no rate
    // card item matches DEFAULT, and base shipping comes out ₹0. GST is
    // a percentage of that, so the whole order prices at ₹0.00 — free
    // shipping, silently, with only a flag in `unresolved` to say so.
    //
    // Persisting that writes ₹0 onto the order as its real price, and
    // the seller is billed nothing for a parcel that cost us money to
    // move. With 27 pincodes loaded against roughly 19,000 in India,
    // that was the outcome for most real destinations.
    //
    // These two reasons specifically mean "no rate was found", as
    // distinct from the softer flags (a GST-rate fallback is fine; a
    // DEFAULT zone that DID match a rate card item is fine). A missing
    // rate is an operator problem — load the pincode, or add the slab —
    // and it should stop the flow loudly rather than bill nothing.
    const unpriced = compute.unresolved.filter(
      (u) => u.reason === 'NO_RATE_CARD' || u.reason === 'NO_RATE_CARD_ITEM',
    );
    if (unpriced.length > 0) {
      throw new ConflictException({
        code: 'PRICING_UNRESOLVED',
        message:
          `Cannot price order ${orderId}: ${unpriced.map((u) => u.reason).join(', ')}. ` +
          `Destination ${order.recipientPostalCode} resolved to zone "${compute.zone}" and no ` +
          `rate card item matched. Load the pincode or add the rate for that zone and weight ` +
          `slab, then compute again — recording ₹0 would bill the seller nothing for this parcel.`,
      });
    }

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
          actorType: actor.kind === 'staff' ? ActorType.STAFF : ActorType.SYSTEM,
          staffUserId: actor.kind === 'staff' ? actor.staffId : null,
          action:
            actor.kind === 'staff'
              ? 'staff.order_charges.persisted'
              : 'system.order_charges.persisted',
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
