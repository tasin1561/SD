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
      // ── MATCH THE CODE, NOT THE MESSAGE ──────────────────────────
      // The throw is `new ConflictException({ code, message })`, so the
      // code lives in the RESPONSE OBJECT and `e.message` is Nest's own
      // "Conflict Exception" — it never contained the string this used
      // to test for. The documented "clean no-op" therefore never
      // happened: every call on an order that already had charges threw
      // instead of skipping.
      //
      // It hid because the only caller was the post-commit hook at
      // order create, where charges never exist yet. It surfaced the
      // moment anything called this on an existing order.
      if (e instanceof ConflictException) {
        const res: unknown = e.getResponse();
        const code =
          typeof res === 'object' && res !== null ? (res as { code?: unknown }).code : null;
        if (code === 'CHARGES_ALREADY_EXIST') {
          return { skipped: true, reason: 'CHARGES_ALREADY_EXIST' };
        }
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

    // ── Refuse to record a price we could not resolve ────────────────
    //
    // The engine ANSWERS even when the fee behind it is missing — it
    // returns ₹0.00 and a flag. Persisting that writes ₹0 onto the order
    // as its real price, and the seller is billed nothing for a parcel
    // that cost us money to move.
    //
    // Under the old zone/slab engine this was the common case rather
    // than the edge one: an unlisted pincode fell through to a "DEFAULT"
    // zone no rate card item matched. Flat pricing removes that seam,
    // but a deleted or zeroed setting can still get here, so the guard
    // stays — a missing fee is an operator problem and should stop the
    // flow loudly rather than bill nothing.
    const unpriced = compute.unresolved.filter((u) => u.reason === 'NO_FLAT_DELIVERY_FEE');
    if (unpriced.length > 0) {
      throw new ConflictException({
        code: 'PRICING_UNRESOLVED',
        message:
          `Cannot price order ${orderId}: the flat delivery fee resolved to ₹0.00. ` +
          `Set pricing.flat_delivery_fee_inr (or this seller's override of it) and compute ` +
          `again — recording ₹0 would bill the seller nothing for this parcel.`,
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
  /**
   * Give charges to every order that has none.
   *
   * ── WHY THIS IS NEEDED AT ALL ────────────────────────────────────
   * `OrderService.create` computes charges post-commit, which covers
   * orders born through the service. Anything inserted another way — a
   * data fix, an import, a seeding script — arrives with none, and an
   * order with no charge rows is billed NOTHING at delivery, silently:
   * `debitIfNeeded` sums zero and returns false, so the parcel ships,
   * the customer is served, and the seller is never invoiced.
   *
   * Undelivered orders are included deliberately. Their charges are not
   * money yet — the debit happens at delivery or at RTO receive — so
   * writing them now costs nothing and means the fee is already in
   * place when that moment arrives, instead of depending on this having
   * been run again.
   *
   * ── WHAT IT DOES NOT DO ──────────────────────────────────────────
   * It never touches a wallet. Persisting a charge ROW records what an
   * order costs; taking the money is `debitIfNeeded`, which is gated on
   * a prior ORDER_CHARGES entry and runs at delivery. Retro-BILLING an
   * order that has already been delivered is a separate decision about
   * real money against a real seller, and is not something a backfill
   * should do on its own.
   */
  async backfillMissing(opts: { dryRun: boolean; limit: number }): Promise<{
    examined: number;
    persisted: number;
    skipped: number;
    failed: number;
    orders: Array<{ orderNumber: string; status: string; outcome: string }>;
  }> {
    const candidates = await this.prisma.client.order.findMany({
      where: { deletedAt: null, charges: { none: { deletedAt: null } } },
      select: { id: true, orderNumber: true, status: true },
      // Oldest first: the ones most likely to be delivered already, and
      // therefore the ones whose absence has cost the most.
      orderBy: { createdAt: 'asc' },
      take: opts.limit,
    });

    const report = {
      examined: candidates.length,
      persisted: 0,
      skipped: 0,
      failed: 0,
      orders: [] as Array<{ orderNumber: string; status: string; outcome: string }>,
    };

    for (const o of candidates) {
      if (opts.dryRun) {
        report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: 'WOULD_ADD' });
        continue;
      }
      try {
        const res = await this.persistForOrderSystem(o.id);
        if ('skipped' in res) {
          report.skipped += 1;
          report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: res.reason });
        } else {
          report.persisted += 1;
          report.orders.push({ orderNumber: o.orderNumber, status: o.status, outcome: 'ADDED' });
        }
      } catch (err) {
        // One order's pricing failure must not abandon the rest — the
        // same per-item isolation the courier sagas use.
        report.failed += 1;
        report.orders.push({
          orderNumber: o.orderNumber,
          status: o.status,
          outcome: err instanceof Error ? err.message : 'FAILED',
        });
      }
    }
    return report;
  }
}
