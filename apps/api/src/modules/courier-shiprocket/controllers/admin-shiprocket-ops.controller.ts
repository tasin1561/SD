import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierEnablementService } from '../../courier-shared/services/courier-enablement.service';
import { CourierWriteGuardService } from '../../courier-shared/services/courier-write-guard.service';
import { ShiprocketClientService } from '../services/shiprocket-client.service';
import { ShiprocketHttpService } from '../services/shiprocket-http.service';

const COURIER = 'shiprocket';

/**
 * The nightly jobs' own audit actions, RESTATED rather than imported:
 * the portal worker is a separate root module and the API must not reach
 * into it (`shiprocket-portal.spec.ts` pins these names, as it already
 * does for the cost panel that reads the same rows).
 */
const ACTION_WALLET_OK = 'courier.shiprocket_wallet.synced';
const ACTION_WALLET_FAILED = 'courier.shiprocket_wallet.sync_failed';
const ACTION_INVOICES_OK = 'courier.shiprocket_invoices.checked';
const ACTION_INVOICES_FAILED = 'courier.shiprocket_invoices.check_failed';

export interface ShiprocketAccountView {
  readonly courierAccountId: string;
  readonly label: string;
  readonly isActive: boolean;
  /** Matched byte-for-byte on every booking. Empty ⇒ bookings refuse. */
  readonly pickupLocationName: string | null;
  readonly walletBalanceInr: string | null;
  readonly walletBalanceAt: string | null;
}

export interface ShiprocketJobRunView {
  readonly at: string;
  readonly ok: boolean;
}

export interface ShiprocketBookingView {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  /** WHICH carrier their ranking gave us, when we recorded it. */
  readonly carrierName: string | null;
  readonly status: string;
  readonly bookedAt: string | null;
  readonly createdAt: string;
}

export interface ShiprocketOpsStatusView {
  /**
   * THE SINGLE MOST IMPORTANT FIELD ON THIS PAGE (CUR-15).
   *
   * A stub returns a FABRICATED success — a waybill derived from the
   * shipment id — which is right in dev and catastrophic beside a live
   * courier: a parcel Delhivery refuses fails over here, comes back
   * "booked" with a waybill nobody issued, and is dispatched. Stock has
   * already left at pack, the customer has been told, and no van is
   * coming. The failover guard refuses that case, but an operator still
   * has to be able to SEE which mode this courier is in, and until now
   * the only place that said so was a line inside the cost-sync page.
   */
  readonly liveMode: boolean;
  /** The default-OFF gate on writes with a physical or billable effect. */
  readonly liveWritesEnabled: boolean;
  /** `Courier.isActive` (CUR-16). OFF means no NEW parcels — in-flight
   *  ones are still tracked, cancelled and costed. */
  readonly intakeEnabled: boolean;
  /** Set ⇒ a return collection can be booked (their return create spells
   *  out both ends). Empty ⇒ refused by name. */
  readonly returnAddressConfigured: boolean;
  readonly accounts: readonly ShiprocketAccountView[];
  readonly lastWalletSync: ShiprocketJobRunView | null;
  readonly lastInvoiceCheck: ShiprocketJobRunView | null;
  /** Newest first. A booking that FAILED has no AWB. */
  readonly recentBookings: readonly ShiprocketBookingView[];
}

export interface ShiprocketConnectivityView {
  /** The ONLY field that means "we talked to Shiprocket". */
  readonly reachedLiveApi: boolean;
  readonly stubMode: boolean;
  readonly pickupPincode: string | null;
  readonly deliveryPincode: string | null;
  /** How many carriers they quoted for the lane. */
  readonly optionCount: number | null;
  readonly cheapestInr: string | null;
  /** Present when the call failed. The failure IS the result here. */
  readonly error: string | null;
}

/**
 * The Shiprocket operations console (read-only).
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────
 * `/delhivery` has been a full console for months — stub-vs-live, the
 * live-write guard, pool depth, rate budget — and Shiprocket had
 * nothing. Production carries BOTH couriers live, and failover reaches
 * Shiprocket without anybody choosing it per parcel (CUR-14), so the
 * courier that can silently take our volume was the one with no page.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────
 * No waybill pool and no rate budget: Shiprocket issues the AWB at
 * assign (there is no pool to run dry) and publishes no per-endpoint
 * budget, so inventing gauges for either would be a page that looks
 * informative and reports nothing. The wallet DETAIL — every run, every
 * parcel reading, the invoice findings — stays on `/cost-sync`, which
 * already owns it; duplicating it here would be a second copy of the
 * same numbers to keep in step (the M14 argument).
 *
 * Same permission as its Delhivery sibling (`courier.waybills.manage`),
 * because it answers the same question about the same kind of thing.
 */
@ApiTags('admin-shiprocket')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.waybills.manage')
@Controller('admin/shiprocket')
export class AdminShiprocketOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ShiprocketHttpService,
    private readonly client: ShiprocketClientService,
    private readonly writeGuard: CourierWriteGuardService,
    private readonly enablement: CourierEnablementService,
  ) {}

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stub-or-live, the live-write guard, the intake switch, each account with its wallet balance, and the last nightly runs.',
  })
  async status(): Promise<ShiprocketOpsStatusView> {
    const [stubMode, liveWritesEnabled, intakeEnabled, accountRows, returnAddress] =
      await Promise.all([
        this.http.isStubMode(),
        this.writeGuard.liveWritesEnabled(COURIER),
        this.enablement.canTakeNewParcels(COURIER),
        this.prisma.client.courierAccount.findMany({
          where: { courier: { code: COURIER }, deletedAt: null },
          select: { id: true, label: true, isActive: true, pickupLocationName: true },
          orderBy: { label: 'asc' },
        }),
        this.prisma.client.systemSetting.findUnique({
          where: { key: 'courier.shiprocket_return_address' },
          select: { valueJson: true },
        }),
      ]);

    const accounts: ShiprocketAccountView[] = [];
    for (const a of accountRows) {
      // The balance the nightly panel read last. Per account, because a
      // second account's float says nothing about the first's.
      const b = await this.prisma.client.courierWalletBalance.findFirst({
        where: { courierAccountId: a.id },
        orderBy: { capturedAt: 'desc' },
        select: { balanceInr: true, capturedAt: true },
      });
      accounts.push({
        courierAccountId: a.id,
        label: a.label,
        isActive: a.isActive,
        pickupLocationName:
          a.pickupLocationName === null || a.pickupLocationName.trim() === ''
            ? null
            : a.pickupLocationName,
        walletBalanceInr: b === null ? null : b.balanceInr.toFixed(2),
        walletBalanceAt: b === null ? null : b.capturedAt.toISOString(),
      });
    }

    const [lastWalletSync, lastInvoiceCheck, bookings] = await Promise.all([
      this.lastRun(ACTION_WALLET_OK, ACTION_WALLET_FAILED),
      this.lastRun(ACTION_INVOICES_OK, ACTION_INVOICES_FAILED),
      this.prisma.client.shipment.findMany({
        where: { courierCode: COURIER, deletedAt: null },
        select: {
          id: true,
          shipmentNumber: true,
          awbNumber: true,
          carrierName: true,
          status: true,
          awbGeneratedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const returnJson: unknown = returnAddress?.valueJson ?? null;

    return {
      liveMode: !stubMode,
      liveWritesEnabled,
      intakeEnabled,
      returnAddressConfigured:
        returnJson !== null &&
        typeof returnJson === 'object' &&
        !Array.isArray(returnJson) &&
        Object.keys(returnJson as Record<string, unknown>).length > 0,
      accounts,
      lastWalletSync,
      lastInvoiceCheck,
      recentBookings: bookings.map((s) => ({
        shipmentId: s.id,
        shipmentNumber: s.shipmentNumber,
        awbNumber: s.awbNumber,
        carrierName: s.carrierName,
        status: s.status,
        bookedAt: s.awbGeneratedAt === null ? null : s.awbGeneratedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    };
  }

  /**
   * The most recent run of one nightly job, from its OWN audit rows.
   *
   * `audit_logs` is the history (the M14 call): the jobs already write
   * their whole summary there, and a second copy would eventually
   * disagree with it. Success and failure are separate actions, so the
   * newest of the two is the last thing that actually happened —
   * reading only the success row would report a job that has been
   * failing for a week as having last run a week ago and fine.
   */
  private async lastRun(
    okAction: string,
    failedAction: string,
  ): Promise<ShiprocketJobRunView | null> {
    const row = await this.prisma.client.auditLog.findFirst({
      where: { action: { in: [okAction, failedAction] } },
      orderBy: { createdAt: 'desc' },
      select: { action: true, createdAt: true },
    });
    if (row === null) return null;
    return { at: row.createdAt.toISOString(), ok: row.action === okAction };
  }

  /**
   * Prove the integration can actually talk to Shiprocket — WITHOUT
   * creating anything.
   *
   * The same reasoning as `/admin/delhivery/connectivity`: `status`
   * above reads only our own database, so it stays green while the
   * stored credential is expired, revoked or was never valid, and every
   * path that DOES exercise the credential needs a parcel that already
   * has an AWB. That is a circle, and it puts the first real test of
   * authentication inside the first real booking.
   *
   * A serviceability lookup breaks it: free, idempotent, creates
   * nothing, and it travels the whole chain that matters — decrypt the
   * credential (CUR-1, which writes its own audit row), exchange it for
   * a token, survive their rate limiting, parse a real response.
   *
   * `reachedLiveApi` is the field to read. In stub mode it is FALSE and
   * nothing left the process; reporting a stub's answer as reachability
   * would look exactly like proof.
   */
  @Get('connectivity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Read-only reachability check: one live serviceability lookup on a lane. Creates nothing.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Pickup pincode.' })
  @ApiQuery({ name: 'to', required: false, description: 'Delivery pincode.' })
  @ApiQuery({ name: 'courierAccountId', required: false })
  async connectivity(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('courierAccountId') courierAccountId?: string,
  ): Promise<ShiprocketConnectivityView> {
    const stubMode = await this.http.isStubMode();
    const pickupPincode = (from ?? '').trim();
    const deliveryPincode = (to ?? '').trim();
    if (pickupPincode === '' || deliveryPincode === '') {
      // No default lane is invented. Delhivery's check can fall back to
      // `courier.delhivery_origin_pincode` because that key IS our
      // dispatch origin; there is no Shiprocket equivalent, and picking
      // a pincode would make the check pass or fail for a lane nobody
      // asked about.
      return {
        reachedLiveApi: false,
        stubMode,
        pickupPincode: pickupPincode === '' ? null : pickupPincode,
        deliveryPincode: deliveryPincode === '' ? null : deliveryPincode,
        optionCount: null,
        cheapestInr: null,
        error: 'Give both a pickup and a delivery pincode — there is no default lane to check.',
      };
    }

    const account =
      courierAccountId ??
      (
        await this.prisma.client.courierAccount.findFirst({
          where: { courier: { code: COURIER }, isActive: true, deletedAt: null },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        })
      )?.id;
    if (account === undefined) {
      return {
        reachedLiveApi: false,
        stubMode,
        pickupPincode,
        deliveryPincode,
        optionCount: null,
        cheapestInr: null,
        error: 'No active Shiprocket account is configured, so there is no credential to test.',
      };
    }

    try {
      const { options, fromLiveApi } = await this.client.listCourierOptions(
        { pickupPincode, deliveryPincode, weightGrams: 500, isCod: false },
        account,
      );
      const cheapest = options.reduce<number | null>(
        (min, o) => (min === null || o.rateInr < min ? o.rateInr : min),
        null,
      );
      return {
        // THEIR OWN word for it, not ours. Stub mode answers from a
        // table inside this process and reports `fromLiveApi: false`;
        // reading "we got options back" as reachability would look
        // exactly like proof while proving nothing.
        reachedLiveApi: fromLiveApi,
        stubMode,
        pickupPincode,
        deliveryPincode,
        optionCount: options.length,
        cheapestInr: cheapest === null ? null : cheapest.toFixed(2),
        error: null,
      };
    } catch (err) {
      // Surfaced, not thrown: the failure IS the answer here and an
      // operator has to read it. Their token never appears in an error
      // (the http service keeps it out) and the logger redacts it.
      return {
        reachedLiveApi: false,
        stubMode,
        pickupPincode,
        deliveryPincode,
        optionCount: null,
        cheapestInr: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
