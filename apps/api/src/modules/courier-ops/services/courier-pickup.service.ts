import { CourierOpsDispatchService } from './courier-ops-dispatch.service';
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
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

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
  /**
   * Which courier is being asked to collect. Defaults to Delhivery so
   * every existing caller is unchanged; the one-open-request-per-
   * (courier, warehouse, day) unique already had the courier in it, so
   * a Delhivery van and a Shiprocket van on the same day at the same
   * warehouse were always two separate rows — which is correct, because
   * they are two separate vans.
   */
  readonly courierCode?: string;
  /** Which of that courier's accounts. Delhivery ignores it. */
  readonly courierAccountId?: string | null;
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
 * rejection nobody can interpret later. A PARTIAL unique on
 * (courier, warehouse, date) WHERE status IN ('requested','failed')
 * makes the courier's rule a database fact: two supervisors clicking at
 * once cannot both succeed.
 *
 * The partial matters. Delhivery permits a second request "only when the
 * existing pickup request is closed", so a CLOSED morning collection must
 * NOT block an afternoon van — a warehouse that gets more parcels ready
 * after the first van leaves is an ordinary day, not an edge case. An
 * unconditional unique enforced something stricter than the courier
 * does, which is its own kind of wrong.
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
    private readonly opsDispatch: CourierOpsDispatchService,
  ) {}

  /**
   * Ask for today's van the moment a parcel is ready for one — IF an
   * operator has explicitly enabled it for this courier.
   *
   * ── WHY THIS EXISTS BEHIND A SWITCH, NOT ON BY DEFAULT ──────────────
   * CUR-10 keeps a physical-world courier call operator-triggered unless
   * a runner's write channel has been explicitly turned on — the same
   * carve-out already used for the nightly NDR batch. Packing a box
   * completing is not a lifecycle transition on the ORDER in the sense
   * CUR-10 forbids (that half of the rule is about firing a courier
   * write FROM an order-status change with nobody having decided to);
   * it is closer to the NDR runner's shape — a recurring operational
   * fact the warehouse already produces, gated behind its own switch,
   * its own kill switch (the live-write guard underneath `raise` is
   * untouched), and its own audit trail naming it a runner action.
   *
   * `courier.<code>_auto_pickup_enabled`, default OFF. Until an operator
   * turns it on, packing a box changes nothing here and the Pickups
   * screen is the only way a van gets asked for — today's behaviour,
   * unchanged.
   *
   * ── THE GRAIN STAYS PER WAREHOUSE PER DAY ───────────────────────────
   * One box closing does not mean one van: if a request already exists
   * for (courier, warehouse, today) this is a no-op, because that
   * request already covers this parcel along with everything else
   * packed today. Only the FIRST box of the day for a given courier at
   * a given warehouse actually calls the courier — every later one
   * finds the day already claimed.
   *
   * A FAILED day is left for a human. Retrying automatically on every
   * subsequent box close would turn one bad response from the courier
   * into a call fired on every parcel packed for the rest of the day —
   * the Pickups screen's release-day / retry flow is where that gets
   * resolved.
   *
   * Best-effort by construction: this is called from `PackService`'s
   * post-commit hook and must never be allowed to fail a pack. Any
   * throw here is the CALLER's problem to swallow, not this method's —
   * kept a real throw rather than a caught result so a genuine bug does
   * not silently disappear in two places.
   */
  async raiseIfDue(input: {
    warehouseId: string;
    courierCode: string;
    courierAccountId: string | null;
    /** Named for the audit trail — WHICH parcel prompted the check. */
    triggeredByShipmentId: string;
  }): Promise<{ fired: boolean; reason: string; requestId: string | null }> {
    // Only a courier with an adapter can be asked for a van at all —
    // matches CourierOpsDispatchService.requestPickup's own switch.
    if (input.courierCode !== 'delhivery' && input.courierCode !== 'shiprocket') {
      return { fired: false, reason: 'NO_ADAPTER', requestId: null };
    }
    if (!(await this.autoPickupEnabled(input.courierCode))) {
      return { fired: false, reason: 'AUTO_PICKUP_DISABLED', requestId: null };
    }

    const pickupDate = todayInKolkata();
    const existing = await this.prisma.client.courierPickupRequest.findFirst({
      where: {
        courierCode: input.courierCode,
        warehouseId: input.warehouseId,
        pickupDate: parseDate(pickupDate),
        status: PickupRequestStatus.REQUESTED,
      },
      select: { id: true },
    });
    if (existing !== null) {
      return { fired: false, reason: 'ALREADY_REQUESTED_TODAY', requestId: existing.id };
    }

    // How many parcels a van should expect — the same query the manual
    // Shiprocket path already uses to decide who it schedules, reused
    // here as a headcount rather than as a scheduling list. At least 1:
    // the parcel that triggered this call is itself one of them, even
    // in the unlikely case it has already moved on by the time this
    // query runs.
    const waiting = await this.awaitingPickup(input.warehouseId, input.courierCode);
    const expectedPackageCount = Math.max(1, waiting.length);
    const pickupTime = await this.defaultPickupTime();

    const view = await this.raise(
      null,
      {
        warehouseId: input.warehouseId,
        courierCode: input.courierCode,
        courierAccountId: input.courierAccountId,
        pickupDate,
        pickupTime,
        expectedPackageCount,
      },
      { ipAddress: null, userAgent: null, requestId: null },
    );
    return { fired: true, reason: 'REQUESTED', requestId: view.id };
  }

  /** The switch: default OFF, fails closed on an unreadable row. */
  private async autoPickupEnabled(courierCode: string): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: `courier.${courierCode}_auto_pickup_enabled` },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  private async defaultPickupTime(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.default_pickup_time' },
      select: { valueString: true },
    });
    const v = (row?.valueString ?? '').trim();
    return v === '' ? '18:00:00' : v;
  }

  async list(query: {
    warehouseId?: string;
    fromDate?: string;
  }): Promise<readonly PickupRequestView[]> {
    const rows = await this.prisma.client.courierPickupRequest.findMany({
      where: {
        ...(query.warehouseId === undefined ? {} : { warehouseId: query.warehouseId }),
        ...(query.fromDate === undefined ? {} : { pickupDate: { gte: new Date(query.fromDate) } }),
      },
      orderBy: [{ pickupDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { warehouse: { select: { name: true } } },
    });
    return rows.map((r) => this.toView(r, r.warehouse.name));
  }

  async raise(
    /** null when a RUNNER fired this rather than an operator — see
     *  `raiseIfDue`. The row and the audit both record that honestly:
     *  crediting a packer with a courier decision they did not make is
     *  a false record of who acted. */
    staffId: string | null,
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

    const courierCode = input.courierCode ?? COURIER_CODE;
    const pickupLocationName = await this.pickupLocationName();
    const pickupDate = parseDate(input.pickupDate);

    // Claim the day FIRST. If the courier call then fails we still hold
    // the slot, which is the safe direction — see the class doc.
    let row;
    try {
      row = await this.prisma.client.courierPickupRequest.create({
        data: {
          courierCode,
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'PICKUP_ALREADY_REQUESTED',
          message:
            'An OPEN pickup already exists for this warehouse on this date. Delhivery accepts only one at a time — mark the existing one collected or called off once it is resolved, and a second can then be raised for the same day. If it failed and was never registered with them, release the day instead.',
        });
      }
      throw err;
    }

    let result: Awaited<ReturnType<CourierOpsDispatchService['requestPickup']>>;
    try {
      result = await this.opsDispatch.requestPickup(
        {
          courierCode,
          courierAccountId: input.courierAccountId ?? null,
          pickupLocation: pickupLocationName,
          pickupDate: input.pickupDate,
          pickupTime: input.pickupTime,
          expectedPackageCount: input.expectedPackageCount,
          // Shiprocket schedules per PARCEL rather than per location and
          // day, so it needs the day's parcels. Resolved here rather
          // than in the dispatcher: which parcels are waiting at this
          // warehouse is our question, not the courier adapter's.
          courierShipmentIds:
            courierCode === COURIER_CODE
              ? []
              : await this.awaitingPickup(warehouse.id, courierCode),
        },
        staffId === null
          ? courierActor.runner('pack-auto-pickup', row.id)
          : courierActor.operator(staffId),
      );
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
        status: result.success ? PickupRequestStatus.REQUESTED : PickupRequestStatus.FAILED,
        courierPickupId: result.pickupId,
        courierMessage: result.message,
      },
    });
    await this.auditRaise(staffId, row.id, warehouse.id, result.success, result.message, ctx);
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

  /**
   * The parcels standing at this warehouse that the courier has not
   * collected: an AWB issued, and not yet handed over.
   *
   * Only Shiprocket needs this — Delhivery's request covers the whole
   * location — and it is answered from OUR records rather than theirs
   * because a parcel we have not handed over is our fact, not a
   * question about their system.
   */
  private async awaitingPickup(warehouseId: string, courierCode: string): Promise<string[]> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        courierCode,
        originWarehouseId: warehouseId,
        deletedAt: null,
        awbNumber: { not: null },
        courierShipmentId: { not: null },
        // Not yet with the courier. Once handed over, a second pickup
        // request for the same parcel is a van sent for nothing.
        status: { in: [ShipmentStatus.CREATED, ShipmentStatus.AWB_GENERATED] },
      },
      select: { courierShipmentId: true },
      // A day's collection, not a backlog sweep: an unbounded list here
      // would be one HTTP call per parcel to their API.
      take: 200,
    });
    const out: string[] = [];
    for (const r of rows) if (r.courierShipmentId !== null) out.push(r.courierShipmentId);
    return out;
  }

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
    staffId: string | null,
    requestId: string,
    warehouseId: string,
    success: boolean,
    message: string | null,
    ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.audit.log({
      // A NULL staffId means the runner fired this, not a person — the
      // same distinction the handover-scan gate and the dispatch handoff
      // already draw for an unattended action.
      actorType: staffId === null ? ActorType.SYSTEM : ActorType.STAFF,
      staffUserId: staffId,
      action: staffId === null ? 'courier.pickup.auto_requested' : 'courier.pickup.requested',
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
/** Today's date at the warehouse's own clock (India-only, per ORD-3
 *  and every other calendar-day boundary in this codebase). */
function todayInKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_PICKUP_DATE',
      message: 'pickupDate must be YYYY-MM-DD.',
    });
  }
  return new Date(`${value}T00:00:00.000Z`);
}
