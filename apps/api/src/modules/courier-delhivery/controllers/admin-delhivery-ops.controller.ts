import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { DelhiveryHttpService } from '../services/delhivery-http.service';
import {
  DelhiveryRateLimitService,
  type DelhiveryEndpoint,
} from '../services/delhivery-rate-limit.service';
import {
  DelhiveryWaybillPoolService,
  type PoolStats,
} from '../services/delhivery-waybill-pool.service';
import { DelhiveryWriteGuardService } from '../services/delhivery-write-guard.service';

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
@Controller('admin/delhivery')
export class AdminDelhiveryOpsController {
  constructor(
    private readonly pool: DelhiveryWaybillPoolService,
    private readonly writeGuard: DelhiveryWriteGuardService,
    private readonly rateLimit: DelhiveryRateLimitService,
    private readonly http: DelhiveryHttpService,
  ) {}

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Waybill pool depth, live-write guard state, and remaining rate budget per endpoint.',
  })
  async status(@CurrentStaff() staff: AuthenticatedStaff): Promise<DelhiveryOpsStatusView> {
    requireStaffRoles(staff, [
      StaffRole.WAREHOUSE_SUPERVISOR,
      StaffRole.MANUAL_PLACEMENT_ADMIN,
      StaffRole.SUPER_ADMIN,
    ]);

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
    requireStaffRoles(staff, [StaffRole.MANUAL_PLACEMENT_ADMIN, StaffRole.SUPER_ADMIN]);
    return this.pool.refillIfNeeded();
  }
}
