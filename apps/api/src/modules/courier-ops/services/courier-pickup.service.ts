import { CourierOpsDispatchService } from './courier-ops-dispatch.service';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  PickupRequestStatus,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
  WarehouseStatus,
  ShipmentStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

const COURIER_CODE = 'delhivery';
const PICKUP_LOCATION_SETTING = 'courier.delhivery_pickup_location';

/**
 * What a packed box's pickup check came to. Every value that is not
 * REQUESTED or ALREADY_REQUESTED_TODAY means NO van was asked for, and
 * each of those is recorded somewhere a person will see it — see
 * `raiseIfDue`.
 */
export type AutoPickupReason =
  /** Manual courier — nobody to ask. Skipped before this is reached. */
  | 'NO_ADAPTER'
  /** `courier.<code>_auto_pickup_enabled` is off — an operator's choice. */
  | 'AUTO_PICKUP_DISABLED'
  /** A van is already booked for this (courier, warehouse, day). */
  | 'ALREADY_REQUESTED_TODAY'
  /** The day's request FAILED earlier; left for a human, never retried. */
  | 'DAY_FAILED'
  /** The courier did not accept the request (row kept, marked FAILED). */
  | 'COURIER_FAILED'
  /** We could not even ask — configuration, warehouse, or a fault. */
  | 'NOT_RAISED'
  | 'REQUESTED';

export interface AutoPickupOutcome {
  readonly fired: boolean;
  readonly reason: AutoPickupReason;
  readonly requestId: string | null;
  /** The code behind a NOT_RAISED / COURIER_FAILED, for the log line. */
  readonly detail?: string;
}

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
    private readonly issues: SystemIssueService,
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
   * ── NOTHING HERE FAILS QUIETLY (2026-09-12) ─────────────────────────
   * The first version returned a reason nobody read and let every
   * pre-claim refusal (no pickup location, an inactive warehouse) escape
   * as a throw the caller turned into one warn line. A packed box that
   * summons no van is exactly the failure nobody notices until the
   * parcel is still on the bench tomorrow, so every "no van was asked
   * for" outcome other than the operator's own switch now raises a HIGH
   * INTEGRATION issue keyed on (courier, warehouse) — the same problem
   * on the next box bumps it rather than opening another — and a
   * successful request clears it. A pre-claim refusal also writes its own
   * audit row, because no request row exists to carry one.
   *
   * Best-effort by construction: this is called from `PackService`'s
   * post-commit hook and must never be allowed to fail a pack, so it
   * NEVER throws — a fault anywhere inside becomes a NOT_RAISED outcome
   * with an issue behind it, rather than a throw that the caller can
   * only log.
   */
  async raiseIfDue(input: {
    warehouseId: string;
    courierCode: string;
    courierAccountId: string | null;
    /** Named for the audit trail — WHICH parcel prompted the check. */
    triggeredByShipmentId: string;
  }): Promise<AutoPickupOutcome> {
    // Only a courier with an adapter can be asked for a van at all —
    // matches CourierOpsDispatchService.requestPickup's own switch.
    if (input.courierCode !== 'delhivery' && input.courierCode !== 'shiprocket') {
      return { fired: false, reason: 'NO_ADAPTER', requestId: null };
    }
    try {
      return await this.raiseIfDueInner(input);
    } catch (err) {
      // Anything that escaped the inner method is a fault we did not
      // anticipate (the database blinked mid-check). Still a box with
      // no van behind it, so it is said out loud like the rest.
      const code = errorCode(err) ?? 'AUTO_PICKUP_FAULT';
      await this.reportNotRaised(input, null, code, errorMessage(err));
      return { fired: false, reason: 'NOT_RAISED', requestId: null, detail: code };
    }
  }

  private async raiseIfDueInner(input: {
    warehouseId: string;
    courierCode: string;
    courierAccountId: string | null;
    triggeredByShipmentId: string;
  }): Promise<AutoPickupOutcome> {
    // The switch is an operator's deliberate choice, recorded where it
    // was made (the settings audit), so a box packed while it is off is
    // not a problem to announce — and auditing every box would bury the
    // table under rows that all say the same thing.
    if (!(await this.autoPickupEnabled(input.courierCode))) {
      return { fired: false, reason: 'AUTO_PICKUP_DISABLED', requestId: null };
    }

    const pickupTime = await this.defaultPickupTime();
    // A box closed after today's van time is asking for TOMORROW's van:
    // a request for 18:00 today sent at 19:30 is a request for the past,
    // which the courier refuses, and a refused day is not retried.
    const pickupDate = pickupDateFor(pickupTime, new Date());

    // BOTH open states: a FAILED day is still claimed (see the class
    // doc). It used to be looked up as REQUESTED only, so every later
    // box re-tried the insert and was stopped by the partial unique —
    // correct by accident, and invisible.
    const existing = await this.prisma.client.courierPickupRequest.findFirst({
      where: {
        courierCode: input.courierCode,
        warehouseId: input.warehouseId,
        pickupDate: parseDate(pickupDate),
        status: { in: [PickupRequestStatus.REQUESTED, PickupRequestStatus.FAILED] },
      },
      select: { id: true, status: true, courierMessage: true },
    });
    if (existing !== null && existing.status === PickupRequestStatus.FAILED) {
      // Never retried automatically (CUR-10 #3) — but the parcel that
      // just got packed is one more with no van, so the issue is
      // re-stated (a bump, not a second row) in case somebody closed it
      // without releasing the day.
      await this.reportCourierFailed(input, existing.id, pickupDate, existing.courierMessage);
      return { fired: false, reason: 'DAY_FAILED', requestId: existing.id };
    }
    if (existing !== null) {
      // A van IS booked for this building today, so an earlier "no van"
      // issue is no longer true — say so rather than leave it open.
      await this.clearAutoPickupIssue(
        input.courierCode,
        input.warehouseId,
        `A pickup is already requested for ${pickupDate}.`,
      );
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

    let view: PickupRequestView;
    try {
      view = await this.raise(
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
    } catch (err) {
      const code = errorCode(err);
      if (code === 'PICKUP_ALREADY_REQUESTED') {
        // Two boxes closed at once and the other one claimed the day —
        // the partial unique doing its job. One van, as intended.
        await this.clearAutoPickupIssue(
          input.courierCode,
          input.warehouseId,
          `A pickup is already requested for ${pickupDate}.`,
        );
        return { fired: false, reason: 'ALREADY_REQUESTED_TODAY', requestId: null };
      }
      if (code === 'PICKUP_REQUEST_FAILED') {
        // The row exists, marked FAILED, and `raise` audited it.
        await this.reportCourierFailed(input, null, pickupDate, errorMessage(err));
        return { fired: false, reason: 'COURIER_FAILED', requestId: null, detail: code };
      }
      // Refused before any row was claimed: no pickup location, an
      // inactive warehouse. Nothing else will ever record this.
      await this.reportNotRaised(input, pickupDate, code ?? 'AUTO_PICKUP_FAULT', errorMessage(err));
      return {
        fired: false,
        reason: 'NOT_RAISED',
        requestId: null,
        detail: code ?? 'AUTO_PICKUP_FAULT',
      };
    }

    if (view.status === PickupRequestStatus.FAILED) {
      await this.reportCourierFailed(input, view.id, pickupDate, view.courierMessage);
      return { fired: false, reason: 'COURIER_FAILED', requestId: view.id };
    }
    // `raise` has already cleared the issue on its success.
    return { fired: true, reason: 'REQUESTED', requestId: view.id };
  }

  /** The "no van" issue for this courier and building is no longer true. */
  private async clearAutoPickupIssue(
    courierCode: string,
    warehouseId: string,
    note: string,
  ): Promise<void> {
    try {
      await this.issues.resolveByKey(autoPickupIssueKey(courierCode, warehouseId), note);
    } catch {
      // resolveByKey swallows its own failures; a stale open issue is
      // cleared by the next success.
    }
  }

  /** Could not ask at all. Audit (no request row exists) + issue. */
  private async reportNotRaised(
    input: { warehouseId: string; courierCode: string; triggeredByShipmentId: string },
    pickupDate: string | null,
    code: string,
    message: string,
  ): Promise<void> {
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'courier.pickup.auto_not_raised',
      entityType: 'shipment',
      entityId: input.triggeredByShipmentId,
      severity: 'MEDIUM',
      metadata: {
        courierCode: input.courierCode,
        warehouseId: input.warehouseId,
        pickupDate,
        code,
        message,
      },
    });
    const where = await this.warehouseLabel(input.warehouseId);
    await this.issues.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.HIGH,
      title: `No ${input.courierCode} pickup was requested for ${where}`,
      detail:
        code === 'PICKUP_LOCATION_NOT_CONFIGURED'
          ? `A parcel was packed and no van was asked for, because no pickup location is configured. Set the courier account's pickup location name on /courier-accounts (or the system setting ${PICKUP_LOCATION_SETTING}) to the warehouse name registered with ${input.courierCode}, byte for byte, then raise today's pickup on /warehouse/pickups. Every box packed until then will say the same.`
          : `A parcel was packed and no van was asked for: [${code}] ${message}. Fix the cause, then raise today's pickup by hand on /warehouse/pickups.`,
      source: 'courier-pickup.auto',
      dedupeKey: autoPickupIssueKey(input.courierCode, input.warehouseId),
      metadata: {
        courierCode: input.courierCode,
        warehouseId: input.warehouseId,
        pickupDate,
        code,
        triggeredByShipmentId: input.triggeredByShipmentId,
      },
    });
  }

  /** The courier was asked and said no (or failed). The row carries the
   *  audit; this makes sure a PERSON hears about it. */
  private async reportCourierFailed(
    input: { warehouseId: string; courierCode: string; triggeredByShipmentId: string },
    requestId: string | null,
    pickupDate: string,
    courierMessage: string | null,
  ): Promise<void> {
    const where = await this.warehouseLabel(input.warehouseId);
    await this.issues.raise({
      kind: SystemIssueKind.INTEGRATION,
      severity: SystemIssueSeverity.HIGH,
      title: `${input.courierCode} did not accept the ${pickupDate} pickup for ${where}`,
      detail: `The automatic pickup request failed${courierMessage === null ? '' : `: ${courierMessage}`}. The day stays claimed and is NOT retried automatically, because we cannot tell whether ${input.courierCode} registered it. Check their panel: if a pickup exists, mark it collected on /warehouse/pickups when the van comes; if not, release the day there and raise it again.`,
      source: 'courier-pickup.auto',
      dedupeKey: autoPickupIssueKey(input.courierCode, input.warehouseId),
      metadata: {
        courierCode: input.courierCode,
        warehouseId: input.warehouseId,
        pickupDate,
        requestId,
        triggeredByShipmentId: input.triggeredByShipmentId,
      },
    });
  }

  private async warehouseLabel(warehouseId: string): Promise<string> {
    try {
      const w = await this.prisma.client.warehouse.findFirst({
        where: { id: warehouseId },
        select: { name: true },
      });
      return w?.name ?? `warehouse ${warehouseId}`;
    } catch {
      return `warehouse ${warehouseId}`;
    }
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
    const pickupLocationName = await this.pickupLocationName(input.courierAccountId ?? null);
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
    if (result.success) {
      // A van is booked — manually or automatically — so an open "no van
      // for this building" issue is resolved here, whoever raised it.
      await this.clearAutoPickupIssue(
        courierCode,
        warehouse.id,
        `A pickup was requested for ${input.pickupDate}${staffId === null ? ' automatically' : ''}.`,
      );
    }
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

  /**
   * The registered pickup-location name, resolved EXACTLY as the AWB
   * booking resolves it (`DelhiveryAwbService.resolvePickupLocationName`):
   * the account's own name wins, the global setting is the fallback. It
   * read the global setting only, so an account with its own
   * registration would book parcels at one location and summon the van
   * to another.
   */
  private async pickupLocationName(courierAccountId: string | null): Promise<string> {
    if (courierAccountId !== null) {
      const account = await this.prisma.client.courierAccount.findUnique({
        where: { id: courierAccountId },
        select: { pickupLocationName: true },
      });
      const perAccount = (account?.pickupLocationName ?? '').trim();
      if (perAccount !== '') return perAccount;
    }
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: PICKUP_LOCATION_SETTING },
      select: { valueString: true },
    });
    const name = (row?.valueString ?? '').trim();
    if (name === '') {
      throw new BadRequestException({
        code: 'PICKUP_LOCATION_NOT_CONFIGURED',
        message: `No pickup location configured: the courier account has no pickup location name and system setting ${PICKUP_LOCATION_SETTING} is empty. It must match the warehouse name registered with the courier exactly.`,
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

/** One issue per (courier, warehouse) — NOT per day: a location that is
 *  still unconfigured tomorrow is the same problem, not a new one. */
export function autoPickupIssueKey(courierCode: string, warehouseId: string): string {
  return `auto-pickup:${courierCode}:${warehouseId}`;
}

/**
 * The day whose van a box packed at `now` should ask for, at the
 * warehouse's own clock (India-only, like every other calendar-day
 * boundary in this codebase): today while today's van time is still
 * ahead, otherwise tomorrow.
 */
export function pickupDateFor(pickupTime: string, now: Date): string {
  const tz = 'Asia/Kolkata';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  // Compared as NUMBERS, so the setting may be `9:30` as well as `09:30`
  // (a string compare put "9:30" after "17:00" and asked for tomorrow's
  // van all morning).
  const van = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(pickupTime.trim());
  const [h, m, s] = clock.split(':').map(Number);
  const nowSeconds = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  const vanSeconds =
    van === null
      ? null
      : Number(van[1] ?? 0) * 3600 + Number(van[2] ?? 0) * 60 + Number(van[3] ?? 0);
  if (vanSeconds === null ? clock < pickupTime : nowSeconds < vanSeconds) return today;
  const next = new Date(`${today}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function errorCode(err: unknown): string | null {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      const code = (body as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
