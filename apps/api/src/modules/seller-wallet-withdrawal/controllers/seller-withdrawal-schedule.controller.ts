import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * The two withdrawal-schedule keys, hardcoded.
 *
 * `sellerOverridable` means a key SUPPORTS a per-seller value — usually
 * one an admin negotiates. It does NOT mean the seller may set it: the
 * same flag is on `pricing.flat_delivery_fee_inr` and
 * `wallet.minimum_balance_inr`. An endpoint that took a key NAME would
 * let a seller set their own delivery fee to zero.
 *
 * So the keys are constants here, exactly as the customer-delivery-fee
 * controller does it. The narrow surface is the security property.
 */
const ENABLED_KEY = 'wallet.auto_withdraw_enabled';
const HOUR_KEY = 'wallet.auto_withdraw_hour_local';

class SetWithdrawalScheduleDto {
  @IsOptional()
  @IsBoolean()
  autoEnabled?: boolean;

  /** Clamped again by the resolver against overrideMin/MaxInt (SET-1). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hourLocal?: number;
}

interface WithdrawalScheduleView {
  readonly autoEnabled: boolean;
  readonly hourLocal: number;
  /** IANA zone the hour is interpreted in — never a stored offset. */
  readonly timezone: string;
  /** True when this seller set it, rather than inheriting our default. */
  readonly isOwnValue: boolean;
}

/**
 * Whether we raise withdrawal requests on a schedule, and at what hour.
 *
 * Safe for a seller to own because an automatic request goes through the
 * IDENTICAL guard chain as a manual one (WAL-3) — the minimum balance,
 * the smallest withdrawal, the per-day and per-month caps all still apply.
 * Turning it on cannot take money a manual request could not.
 *
 * The remaining wallet terms stay read-only: they are what Skydrop
 * charges and allows, and a seller who could raise their own withdrawal
 * cap would not have one.
 */
@ApiTags('seller-wallet')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@RequireSellerPermissions('wallet.view')
@Controller('seller/wallet/withdrawal-schedule')
export class SellerWithdrawalScheduleController {
  constructor(
    private readonly settings: SettingsResolverService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Whether automatic withdrawals are on, and the hour they run' })
  async get(@CurrentSeller() seller: AuthenticatedSeller): Promise<WithdrawalScheduleView> {
    const [enabled, hour, row] = await Promise.all([
      this.settings.resolve(seller.id, ENABLED_KEY),
      this.settings.resolve(seller.id, HOUR_KEY),
      this.prisma.client.seller.findUnique({
        where: { id: seller.id },
        select: { timezone: true },
      }),
    ]);
    return {
      autoEnabled: enabled.value === true,
      hourLocal: Number(hour.value ?? 10),
      // The hour means nothing without the zone it is read in, and the
      // sweep uses the seller's own (WAL-3).
      timezone: row?.timezone ?? 'Asia/Dhaka',
      isOwnValue: enabled.source === 'SELLER_OVERRIDE' || hour.source === 'SELLER_OVERRIDE',
    };
  }

  @Patch()
  // Changing WHEN money leaves is the same kind of act as asking for it,
  // so it needs the same permission — not the read one the page uses.
  @RequireSellerPermissions('wallet.withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Turn automatic withdrawals on or off, and set the hour they run',
    description:
      'An automatic request passes exactly the same guards as one you make by hand — minimum balance, smallest withdrawal, and the per-day and per-month caps.',
  })
  async set(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SetWithdrawalScheduleDto,
  ): Promise<WithdrawalScheduleView> {
    if (body.autoEnabled !== undefined) {
      await this.settings.setOverride(
        seller.id,
        ENABLED_KEY,
        // The real boolean, not String(...): the resolver's BOOLEAN branch
        // accepts nothing else, unlike INT and DECIMAL which both take a
        // numeric string. Stringifying here is what produced
        // INVALID_VALUE "expected a boolean".
        { valueType: 'BOOLEAN', value: body.autoEnabled },
        { sellerActor: true },
      );
    }
    if (body.hourLocal !== undefined) {
      await this.settings.setOverride(
        seller.id,
        HOUR_KEY,
        { valueType: 'INT', value: body.hourLocal },
        { sellerActor: true },
      );
    }
    return this.get(seller);
  }
}
