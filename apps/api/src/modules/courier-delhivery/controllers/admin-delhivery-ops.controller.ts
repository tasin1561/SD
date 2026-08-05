import { Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { DelhiveryHttpService } from '../services/delhivery-http.service';
import {
  DelhiveryServiceabilityService,
  type DelhiveryPinDetail,
} from '../services/delhivery-serviceability.service';
import {
  DelhiveryRateLimitService,
  type DelhiveryEndpoint,
} from '../services/delhivery-rate-limit.service';
import {
  DelhiveryWaybillPoolService,
  type PoolStats,
} from '../services/delhivery-waybill-pool.service';
import { DelhiveryWriteGuardService } from '../services/delhivery-write-guard.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { courierActor } from '../../courier-shared/services/courier-credential.service';

/** The endpoints worth surfacing. `waybill_bulk` is first because its
 *  budget is FIVE per five minutes — the one that actually bites. */
const WATCHED_ENDPOINTS: readonly DelhiveryEndpoint[] = [
  'waybill_bulk',
  'tracking',
  'create',
  'serviceability',
  'label',
  'edit',
  'ewaybill',
];

export interface DelhiveryConnectivityView {
  /** The ONLY field that means "we talked to Delhivery". A serviceability
   *  answer can come from a local ServiceArea row, and a cached yes is
   *  indistinguishable from a successful call unless this is read. */
  readonly reachedLiveApi: boolean;
  readonly stubMode: boolean;
  readonly pincode: string | null;
  readonly detail: DelhiveryPinDetail | null;
  /** Present when the call failed. The failure IS the result here, so it
   *  is returned rather than thrown — an operator has to read it. */
  readonly error: string | null;
}

export interface DelhiveryRateBudgetView {
  readonly endpoint: string;
  readonly budget: number;
  readonly remaining: number;
}

export interface DelhiveryOpsStatusView {
  /** True when the adapter is running against the real Delhivery API. */
  readonly liveMode: boolean;
  /** The default-OFF gate on physical-world writes. */
  readonly liveWritesEnabled: boolean;
  readonly waybillPool: PoolStats;
  readonly rateBudgets: readonly DelhiveryRateBudgetView[];
}

/**
 * The Delhivery operations console (read-mostly).
 *
 * Three facts an operator cannot currently see anywhere, each of which
 * fails in a way that is silent until it is expensive:
 *
 *  - **Pool depth.** AWBs are pooled because the bulk endpoint allows
 *    five requests per five minutes. A pool that runs dry stops
 *    manifests, and nothing on the floor would say why.
 *  - **The write guard.** Left off, physical writes are refused (which
 *    is correct, and looks like a bug to whoever is standing there).
 *    Left on unattended, a runaway job spends real money.
 *  - **Rate budget.** Delhivery's WAF answers 403 and blocks the whole
 *    egress IP, so exhausting a budget takes live traffic down with it.
 *
 * The refill action is the only write here, and it is the same
 * `refillIfNeeded` the scheduled worker calls — it no-ops above the low
 * watermark and is itself gated by the write guard in live mode.
 */
@ApiTags('admin-delhivery')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.waybills.manage')
@Controller('admin/delhivery')
export class AdminDelhiveryOpsController {
  constructor(
    private readonly pool: DelhiveryWaybillPoolService,
    private readonly writeGuard: DelhiveryWriteGuardService,
    private readonly rateLimit: DelhiveryRateLimitService,
    private readonly http: DelhiveryHttpService,
    private readonly serviceability: DelhiveryServiceabilityService,
  ) {}

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Waybill pool depth, live-write guard state, and remaining rate budget per endpoint.',
  })
  async status(): Promise<DelhiveryOpsStatusView> {
    const [stubMode, liveWritesEnabled, waybillPool, rateBudgets] = await Promise.all([
      this.http.isStubMode(),
      this.writeGuard.liveWritesEnabled(),
      this.pool.stats(),
      Promise.all(
        WATCHED_ENDPOINTS.map(async (endpoint) => ({
          endpoint,
          budget: this.rateLimit.budgetFor(endpoint),
          remaining: await this.rateLimit.remaining(endpoint),
        })),
      ),
    ]);

    return {
      liveMode: !stubMode,
      liveWritesEnabled,
      waybillPool,
      rateBudgets,
    };
  }

  @Post('waybill-pool/refill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Top the AWB pool up to its low watermark. No-ops when already above it; blocked by the write guard in live mode.',
  })
  async refill(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ fetched: number; poolAfter: number }> {
    // Narrower than the read: this one can spend the account's real AWB
    // allocation.
    return this.pool.refillIfNeeded(courierActor.operator(staff.id));
  }

  /**
   * Prove the courier integration can actually talk to Delhivery —
   * WITHOUT creating anything.
   *
   * This exists because there was no way to answer "does our stored
   * token work?" short of manifesting a parcel. `status` above reads
   * only our own database, so it stays green while the credential is
   * expired, revoked, or was never valid; and every path that does
   * exercise the credential needs a shipment that already has an AWB —
   * which you cannot have before the first successful write. That is a
   * circle, and it puts the first real test of authentication inside the
   * first real write, where a failure is expensive and ambiguous.
   *
   * A serviceability lookup breaks it. It is free, idempotent, creates
   * nothing, and travels the whole chain that matters: decrypt the
   * credential (CUR-1, which writes its own audit row), authenticate,
   * survive the rate limiter, and parse a real response. If this is
   * green, the only thing left unproven about a write is our payload
   * shape — which is exactly what the go-live test is for.
   *
   * `fromLiveApi` is the field to read. A serviceability answer can be
   * served from a local ServiceArea row, and a cached "yes" would look
   * identical to a successful call while proving nothing at all.
   */
  @Get('connectivity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Read-only reachability check: decrypt the credential and make one live serviceability call. Creates nothing.',
  })
  @ApiQuery({
    name: 'pincode',
    required: false,
    description: 'Pincode to look up. Defaults to courier.delhivery_origin_pincode.',
  })
  async connectivity(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query('pincode') pincode?: string,
  ): Promise<DelhiveryConnectivityView> {
    const stubMode = await this.http.isStubMode();
    // Default to our own dispatch origin: it is the pincode whose
    // serviceability we most need to be true, and it needs no argument.
    const target = (pincode ?? '').trim() || (await this.http.originPincode());

    if (target.length === 0) {
      return {
        reachedLiveApi: false,
        stubMode,
        pincode: null,
        detail: null,
        error:
          'No pincode supplied and courier.delhivery_origin_pincode is unset — nothing to look up.',
      };
    }

    try {
      const detail = await this.serviceability.describePin(target, courierActor.operator(staff.id));
      return {
        // In stub mode this is false and the call never left the box —
        // reporting it as reachability would be the worst outcome here,
        // because it looks exactly like proof.
        reachedLiveApi: detail.fromLiveApi,
        stubMode,
        pincode: target,
        detail,
        error: null,
      };
    } catch (err) {
      // Deliberately surfaced rather than thrown: the failure IS the
      // answer, and an operator needs to read it. The message carries no
      // credential material — DelhiveryHttpService never puts the token
      // in an error, and the token is redacted by the logger regardless.
      return {
        reachedLiveApi: false,
        stubMode,
        pincode: target,
        detail: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
