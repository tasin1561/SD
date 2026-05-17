import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  Prisma,
  ReservationReleaseReason,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StockReservationService } from '../../inventory-stock/services/stock-reservation.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { OrderEventWriterService } from './order-event-writer.service';
import type { ForceMutationFieldsDto } from '../dto/force-mutation.dto';

const DEFAULT_WAREHOUSE_SETTING_KEY = 'ops.default_warehouse_id';
const MIN_REASON_LEN = 30;

/** The ONLY god-mode-mutable scalar columns. Identity / system-managed
 *  fields are absent by construction (see ForceMutationFieldsDto). */
const DECIMAL_FIELDS = new Set(['codAmountInr', 'declaredValueInr']);

const CANCEL_FAMILY: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
]);

export interface ForceMutateInput {
  orderId: string;
  fieldChanges?: ForceMutationFieldsDto;
  targetStatus?: OrderStatus;
  reason: string;
  acknowledgeDataIntegrityRisk: boolean;
  actorStaffId: string;
  ctx?: ClientContext;
}

export interface ReserveAttemptOutcome {
  orderItemId: string;
  ok: boolean;
  reservationId?: string;
  error?: string;
}

export interface ForceMutateResult {
  orderId: string;
  fromStatus: OrderStatus;
  status: OrderStatus;
  hasAdminOverride: true;
  fieldChangesApplied: string[];
  reserveOutcomes: ReserveAttemptOutcome[] | null;
}

export interface ReleaseReservationsInput {
  orderId: string;
  reason?: string;
  actorStaffId: string;
  ctx?: ClientContext;
}

export interface ReleaseReservationsResult {
  orderId: string;
  releasedCount: number;
  released: Array<{ reservationId: string; qtyReleased: number; alreadyInactive: boolean }>;
}

/**
 * ORD-2 — GOD MODE. A deliberate, audited bypass of the order state
 * machine and edit rules. This is the ONE sanctioned escape hatch from
 * OrderWriteService; it explicitly opts OUT of the saga's compensation
 * guarantee (the admin acknowledged the data-integrity risk).
 *
 * Guardrails (NON-NEGOTIABLE):
 *  - reason ≥ 30 chars; acknowledgeDataIntegrityRisk must be literal
 *    `true`; at least one of fieldChanges / targetStatus.
 *  - DB changes + event + audit commit in ONE tx.
 *  - Side-effects are ATTEMPTED but NEVER block: → CONFIRMED tries
 *    reserve() per line and records each outcome but does not fail or
 *    compensate on shortfall. Transitioning AWAY from CONFIRMED leaves
 *    reservations intact — cleanup is the separate
 *    /admin/orders/:id/release-reservations endpoint (commit 16).
 *  - hasAdminOverride is set true and is NEVER cleared by any path.
 *  - audit_logs severity = CRITICAL; order_events records the reason +
 *    every side-effect attempt outcome.
 */
@Injectable()
export class OrderAdminOverrideService {
  private readonly logger = new Logger(OrderAdminOverrideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderEventWriterService,
    private readonly audit: AuditLogService,
    private readonly reservations: StockReservationService,
  ) {}

  async forceMutate(input: ForceMutateInput): Promise<ForceMutateResult> {
    // ── Guardrails (defense in depth — the DTO validates these too) ────
    if (!input.reason || input.reason.trim().length < MIN_REASON_LEN) {
      throw new BadRequestException({
        code: 'FORCE_MUTATION_REASON_TOO_SHORT',
        message: `reason must be at least ${MIN_REASON_LEN} characters`,
      });
    }
    if (input.acknowledgeDataIntegrityRisk !== true) {
      throw new BadRequestException({
        code: 'FORCE_MUTATION_RISK_NOT_ACKNOWLEDGED',
        message: 'acknowledgeDataIntegrityRisk must be the literal boolean true',
      });
    }
    const hasFieldChanges =
      input.fieldChanges !== undefined &&
      Object.keys(input.fieldChanges).length > 0;
    if (!hasFieldChanges && input.targetStatus === undefined) {
      throw new BadRequestException({
        code: 'FORCE_MUTATION_NOOP',
        message: 'Provide at least one of fieldChanges or targetStatus',
      });
    }

    const order = await this.prisma.client.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        orderNumber: true,
        status: true,
        items: { select: { id: true, variantId: true, quantity: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }

    const from = order.status;
    const to = input.targetStatus ?? from;

    // ── Side-effects ATTEMPTED, never blocking ─────────────────────────
    // Done BEFORE the tx so outcomes can be recorded in the in-tx
    // order_event. No compensation: god mode owns the risk.
    let reserveOutcomes: ReserveAttemptOutcome[] | null = null;
    if (input.targetStatus === OrderStatus.CONFIRMED && from !== OrderStatus.CONFIRMED) {
      reserveOutcomes = await this.attemptReservations(order);
    }

    const { data, applied } = this.buildUpdate(input.fieldChanges, input.targetStatus);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data });

      await this.events.adminAction(tx, {
        orderId: order.id,
        action: 'admin_force_mutation',
        reason: input.reason.trim(),
        from,
        to,
        actorId: input.actorStaffId,
        data: {
          fieldChangesApplied: applied,
          targetStatus: input.targetStatus ?? null,
          reserveOutcomes,
          ipAddress: input.ctx?.ipAddress ?? null,
          userAgent: input.ctx?.userAgent ?? null,
          requestId: input.ctx?.requestId ?? null,
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: input.actorStaffId,
          staffUserId: input.actorStaffId,
          sellerId: order.sellerId,
          action: 'order.force_mutation',
          entityType: 'order',
          entityId: order.id,
          severity: 'CRITICAL',
          changes: { fieldChangesApplied: applied, fromStatus: from, toStatus: to },
          metadata: {
            orderNumber: order.orderNumber,
            reason: input.reason.trim(),
            reserveOutcomes,
            ipAddress: input.ctx?.ipAddress ?? null,
            userAgent: input.ctx?.userAgent ?? null,
            requestId: input.ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    return {
      orderId: order.id,
      fromStatus: from,
      status: to,
      hasAdminOverride: true,
      fieldChangesApplied: applied,
      reserveOutcomes,
    };
  }

  /**
   * God-mode cleanup companion (commit 16). Manually release every
   * ACTIVE reservation on an order — the sanctioned way to clean up
   * after a forceMutate() that moved an order away from CONFIRMED but
   * deliberately left its holds intact. Idempotent: release() is
   * no-op-safe and only ACTIVE rows are targeted, so a re-run releases
   * nothing extra. Audited HIGH; an order_event records the outcome.
   * Does NOT change order status.
   */
  async releaseReservations(
    input: ReleaseReservationsInput,
  ): Promise<ReleaseReservationsResult> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: { id: true, sellerId: true, orderNumber: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${input.orderId} not found`);
    }

    const active = await this.reservations.listActiveForOrder(order.id);
    const released: ReleaseReservationsResult['released'] = [];
    for (const r of active) {
      const res = await this.reservations.release(
        r.id,
        ReservationReleaseReason.MANUAL_RELEASE,
        { type: ActorType.STAFF, id: input.actorStaffId },
      );
      released.push({
        reservationId: res.reservationId,
        qtyReleased: res.qtyReleased,
        alreadyInactive: res.alreadyInactive,
      });
    }

    const reason = input.reason?.trim() || 'Admin manual reservation release';
    await this.prisma.client.$transaction(async (tx) => {
      await this.events.adminAction(tx, {
        orderId: order.id,
        action: 'admin_release_reservations',
        reason,
        actorId: input.actorStaffId,
        data: {
          releasedCount: released.length,
          released,
          ipAddress: input.ctx?.ipAddress ?? null,
          userAgent: input.ctx?.userAgent ?? null,
          requestId: input.ctx?.requestId ?? null,
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          actorId: input.actorStaffId,
          staffUserId: input.actorStaffId,
          sellerId: order.sellerId,
          action: 'order.release_reservations',
          entityType: 'order',
          entityId: order.id,
          severity: 'HIGH',
          metadata: {
            orderNumber: order.orderNumber,
            status: order.status,
            reason,
            releasedCount: released.length,
            ipAddress: input.ctx?.ipAddress ?? null,
            userAgent: input.ctx?.userAgent ?? null,
            requestId: input.ctx?.requestId ?? null,
          },
        },
        tx,
      );
    });

    return { orderId: order.id, releasedCount: released.length, released };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async attemptReservations(order: {
    id: string;
    sellerId: string;
    items: Array<{ id: string; variantId: string; quantity: number }>;
  }): Promise<ReserveAttemptOutcome[]> {
    const warehouseId = await this.resolveDefaultWarehouseId();
    const outcomes: ReserveAttemptOutcome[] = [];
    for (const item of order.items) {
      try {
        const r = await this.reservations.reserve({
          sellerId: order.sellerId,
          variantId: item.variantId,
          warehouseId,
          qtyToReserve: item.quantity,
          orderId: order.id,
          orderItemId: item.id,
        });
        outcomes.push({ orderItemId: item.id, ok: true, reservationId: r.id });
      } catch (e) {
        // NEVER block — record and continue (god mode owns the risk).
        outcomes.push({
          orderItemId: item.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        this.logger.warn(
          { orderItemId: item.id, err: (e as Error).message },
          'God-mode reserve attempt failed (not blocking)',
        );
      }
    }
    return outcomes;
  }

  private buildUpdate(
    fieldChanges: ForceMutationFieldsDto | undefined,
    targetStatus: OrderStatus | undefined,
  ): { data: Prisma.OrderUpdateInput; applied: string[] } {
    const data: Prisma.OrderUpdateInput = {};
    const applied: string[] = [];

    if (fieldChanges) {
      for (const [key, value] of Object.entries(fieldChanges)) {
        if (value === undefined) continue;
        if (DECIMAL_FIELDS.has(key)) {
          (data as Record<string, unknown>)[key] = new Prisma.Decimal(value as number);
        } else {
          (data as Record<string, unknown>)[key] = value;
        }
        applied.push(key);
      }
    }

    if (targetStatus !== undefined) {
      data.status = targetStatus;
      applied.push('status');
      const now = new Date();
      // Keep canonical timestamps coherent for downstream modules even
      // on a forced transition (data sanity, not a guardrail).
      if (targetStatus === OrderStatus.CONFIRMED) {
        data.confirmedAt = now;
      } else if (CANCEL_FAMILY.has(targetStatus)) {
        data.cancelledAt = now;
      }
    }

    // INVARIANT: set true, NEVER cleared (no path writes false).
    data.hasAdminOverride = true;
    return { data, applied };
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    // Config read (system_settings is shared infra, not an inventory
    // domain table) — same pattern as OrderWriteService. Phase 1A is
    // single-warehouse.
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: DEFAULT_WAREHOUSE_SETTING_KEY },
      select: { valueString: true },
    });
    const id = row?.valueString?.trim();
    if (!id) {
      throw new InternalServerErrorException({
        code: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED',
        message: `${DEFAULT_WAREHOUSE_SETTING_KEY} is not set`,
      });
    }
    return id;
  }
}
