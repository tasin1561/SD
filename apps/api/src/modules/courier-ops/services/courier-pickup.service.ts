import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  PickupRequestStatus,
  Prisma,
  WarehouseStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { DelhiveryPickupService } from '../../courier-delhivery/services/delhivery-pickup.service';

const COURIER_CODE = 'delhivery';
const PICKUP_LOCATION_SETTING = 'courier.delhivery_pickup_location';

export interface PickupRequestView {
  readonly id: string;
  readonly courierCode: string;
  readonly warehouseId: string;
  readonly warehouseName: string | null;
  readonly pickupLocationName: string;
  readonly pickupDate: string;
  readonly pickupTime: string;
  readonly expectedPackageCount: number;
  readonly status: PickupRequestStatus;
  readonly courierPickupId: string | null;
  readonly courierMessage: string | null;
  readonly createdAt: Date;
}

export interface RaisePickupInput {
  readonly warehouseId: string;
  /** YYYY-MM-DD, local to the warehouse. */
  readonly pickupDate: string;
  /** HH:mm:ss. */
  readonly pickupTime: string;
  readonly expectedPackageCount: number;
}

/**
 * Asking the courier to send a van.
 *
 * ── THE GRAIN ────────────────────────────────────────────────────────
 * A pickup is raised against a WAREHOUSE for a DAY, not against a
 * parcel. Twenty shipments leaving the same building need one request;
 * one per parcel would summon a fleet. That is why this does not hang
 * off manifest close, where the natural instinct puts it.
 *
 * ── WHY THERE IS A TABLE AND NOT JUST A CALL ─────────────────────────
 * Delhivery accepts only one OPEN request per location per day. Without
 * a record we cannot tell "already asked" from "never asked", so a retry
 * after a network timeout either books a second van or earns a
 * rejection nobody can interpret later. The UNIQUE on
 * (courier, warehouse, date) makes the courier's rule a database fact:
 * two supervisors clicking at once cannot both succeed.
 *
 * A FAILED attempt still occupies the day, deliberately. When the call
 * failed we do NOT know whether Delhivery registered it — the timeout
 * could have come after they accepted — and quietly freeing the slot is
 * exactly how two vans arrive. Freeing it is a conscious act
 * (`releaseDay`), taken by someone who has checked the One panel.
 *
 * ── ORDERING ─────────────────────────────────────────────────────────
 * The row is claimed BEFORE the courier is called (visible-vs-silent):
 * a crash mid-call leaves a REQUESTED row that overstates what we did,
 * which is the safe direction — it prompts someone to check rather than
 * letting a second request through. The reverse ordering would let a
 * successful call leave no trace.
 */
@Injectable()
export class CourierPickupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly pickup: DelhiveryPickupService,
  ) {}

  async list(query: {
    warehouseId?: string;
    fromDate?: string;
  }): Promise<readonly PickupRequestView[]> {
    const rows = await this.prisma.client.courierPickupRequest.findMany({
      where: {
        ...(query.warehouseId === undefined
          ? {}
          : { warehouseId: query.warehouseId }),
        ...(query.fromDate === undefined
          ? {}
          : { pickupDate: { gte: new Date(query.fromDate) } }),
      },
      orderBy: [{ pickupDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { warehouse: { select: { name: true } } },
    });
    return rows.map((r) => this.toView(r, r.warehouse.name));
  }

  async raise(
    staffId: string,
    input: RaisePickupInput,
    ctx: ClientInfoPayload,
  ): Promise<PickupRequestView> {
    const warehouse = await this.prisma.client.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (warehouse === null) {
      throw new NotFoundException({
        code: 'WAREHOUSE_NOT_FOUND',
        message: `No warehouse ${input.warehouseId}.`,
      });
    }
    if (warehouse.status !== WarehouseStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'WAREHOUSE_NOT_ACTIVE',
        message: 'A van cannot be sent to an inactive warehouse.',
      });
    }
    if (input.expectedPackageCount < 1) {
      throw new BadRequestException({
        code: 'INVALID_PACKAGE_COUNT',
        message: 'Expected package count must be at least 1.',
      });
    }

    const pickupLocationName = await this.pickupLocationName();
    const pickupDate = parseDate(input.pickupDate);

    // Claim the day FIRST. If the courier call then fails we still hold
    // the slot, which is the safe direction — see the class doc.
    let row;
    try {
      row = await this.prisma.client.courierPickupRequest.create({
        data: {
          courierCode: COURIER_CODE,
          warehouseId: warehouse.id,
          pickupLocationName,
          pickupDate,
          pickupTime: input.pickupTime,
          expectedPackageCount: input.expectedPackageCount,
          status: PickupRequestStatus.REQUESTED,
          requestedByStaffId: staffId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'PICKUP_ALREADY_REQUESTED',
          message:
            'A pickup has already been raised for this warehouse on this date. Delhivery accepts only one open request per location per day — close the existing one in their panel first, or release the day here if it was never registered.',
        });
      }
      throw err;
    }

    let result: Awaited<ReturnType<DelhiveryPickupService['requestPickup']>>;
    try {
      result = await this.pickup.requestPickup({
        pickupLocation: pickupLocationName,
        pickupDate: input.pickupDate,
        pickupTime: input.pickupTime,
        expectedPackageCount: input.expectedPackageCount,
      });
    } catch (err) {
      // The row STAYS, marked FAILED. We do not know whether Delhivery
      // registered the request before the failure, so the day stays
      // claimed until a human confirms otherwise.
      const message = err instanceof Error ? err.message : 'pickup request failed';
      await this.prisma.client.courierPickupRequest.update({
        where: { id: row.id },
        data: { status: PickupRequestStatus.FAILED, courierMessage: message },
      });
      await this.auditRaise(staffId, row.id, warehouse.id, false, message, ctx);
      throw new BadRequestException({
        code: 'PICKUP_REQUEST_FAILED',
        message,
      });
    }

    const updated = await this.prisma.client.courierPickupRequest.update({
      where: { id: row.id },
      data: {
        status: result.success
          ? PickupRequestStatus.REQUESTED
          : PickupRequestStatus.FAILED,
        courierPickupId: result.pickupId,
        courierMessage: result.message,
      },
    });
    await this.auditRaise(
      staffId,
      row.id,
      warehouse.id,
      result.success,
      result.message,
      ctx,
    );
    return this.toView(updated, warehouse.name);
  }

  /**
   * Mark a request done, called off, or free the day after confirming
   * with the courier that a failed attempt never landed.
   *
   * `releaseDay` is the escape hatch for the deliberate conservatism
   * above: it deletes the row so the slot is usable again, and it audits
   * at HIGH because getting it wrong books a second van.
   */
  async close(
    staffId: string,
    requestId: string,
    status: PickupRequestStatus,
    ctx: ClientInfoPayload,
  ): Promise<PickupRequestView> {
    const row = await this.prisma.client.courierPickupRequest.findUnique({
      where: { id: requestId },
      include: { warehouse: { select: { name: true } } },
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'PICKUP_REQUEST_NOT_FOUND',
        message: `No pickup request ${requestId}.`,
      });
    }
    const updated = await this.prisma.client.courierPickupRequest.update({
      where: { id: requestId },
      data: { status },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.pickup.status_changed',
      entityType: 'courier_pickup_request',
      entityId: requestId,
      severity: 'LOW',
      metadata: {
        from: row.status,
        to: status,
        warehouseId: row.warehouseId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
    return this.toView(updated, row.warehouse.name);
  }

  async releaseDay(
    staffId: string,
    requestId: string,
    reason: string,
    ctx: ClientInfoPayload,
  ): Promise<{ released: boolean }> {
    const row = await this.prisma.client.courierPickupRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        warehouseId: true,
        pickupDate: true,
        courierPickupId: true,
      },
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'PICKUP_REQUEST_NOT_FOUND',
        message: `No pickup request ${requestId}.`,
      });
    }
    if (row.courierPickupId !== null) {
      throw new ConflictException({
        code: 'PICKUP_REGISTERED_WITH_COURIER',
        message:
          'Delhivery returned an id for this request, so it exists on their side. Cancel it in their panel rather than releasing the day here — otherwise a second van is booked against a live request.',
      });
    }

    await this.prisma.client.courierPickupRequest.delete({
      where: { id: requestId },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.pickup.day_released',
      entityType: 'courier_pickup_request',
      entityId: requestId,
      // HIGH: this re-opens a day the courier's one-per-day rule had
      // closed. Wrong, and two vans arrive.
      severity: 'HIGH',
      metadata: {
        warehouseId: row.warehouseId,
        pickupDate: row.pickupDate.toISOString().slice(0, 10),
        previousStatus: row.status,
        reason,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
    return { released: true };
  }

  // ── internal ────────────────────────────────────────────────────────

  private async pickupLocationName(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: PICKUP_LOCATION_SETTING },
      select: { valueString: true },
    });
    const name = (row?.valueString ?? '').trim();
    if (name === '') {
      throw new BadRequestException({
        code: 'PICKUP_LOCATION_NOT_CONFIGURED',
        message: `No pickup location configured (system setting ${PICKUP_LOCATION_SETTING}). It must match the warehouse name registered with Delhivery exactly.`,
      });
    }
    return name;
  }

  private async auditRaise(
    staffId: string,
    requestId: string,
    warehouseId: string,
    success: boolean,
    message: string | null,
    ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'courier.pickup.requested',
      entityType: 'courier_pickup_request',
      entityId: requestId,
      severity: 'MEDIUM',
      metadata: {
        warehouseId,
        success,
        courierMessage: message,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  }

  private toView(
    row: {
      id: string;
      courierCode: string;
      warehouseId: string;
      pickupLocationName: string;
      pickupDate: Date;
      pickupTime: string;
      expectedPackageCount: number;
      status: PickupRequestStatus;
      courierPickupId: string | null;
      courierMessage: string | null;
      createdAt: Date;
    },
    warehouseName: string | null,
  ): PickupRequestView {
    return {
      id: row.id,
      courierCode: row.courierCode,
      warehouseId: row.warehouseId,
      warehouseName,
      pickupLocationName: row.pickupLocationName,
      pickupDate: row.pickupDate.toISOString().slice(0, 10),
      pickupTime: row.pickupTime,
      expectedPackageCount: row.expectedPackageCount,
      status: row.status,
      courierPickupId: row.courierPickupId,
      courierMessage: row.courierMessage,
      createdAt: row.createdAt,
    };
  }
}

/** YYYY-MM-DD → a UTC midnight Date, which is how @db.Date round-trips. */
function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_PICKUP_DATE',
      message: 'pickupDate must be YYYY-MM-DD.',
    });
  }
  return new Date(`${value}T00:00:00.000Z`);
}
