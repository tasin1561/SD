import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerStoreKind } from '@skydrop/db';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ResellerStoreService,
  type ResellerStoreDetail,
} from '../../reseller-store/services/reseller-store.service';
import { AdminPauseStoreDto } from '../dto/reseller-reports.dto';
import {
  AdminResellerAnalysisService,
  type DisputesOverview,
  type FraudReport,
  type ResellerFloat,
} from '../services/admin-reseller-analysis.service';

/**
 * Skydrop's analysis across reseller stores (RS-9). Reading the fraud
 * flags and disputes needs `reseller.stores.view`; the float is treasury
 * money, `money.treasury.view`; the one ACT — pausing a store on a flag —
 * needs its own dangerous key, `reseller.stores.pause`, and goes through
 * `ResellerStoreService` (the only writer of a store's status). Resuming
 * stays the seller's.
 */
@ApiTags('admin-reseller-analysis')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('reseller.stores.view')
@Controller('admin/reseller-analysis')
export class AdminResellerAnalysisController {
  constructor(
    private readonly analysis: AdminResellerAnalysisService,
    private readonly stores: ResellerStoreService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('fraud-flags')
  @ApiOperation({ summary: 'Reseller stores over a fraud-signal threshold, each with its reason' })
  fraud(): Promise<FraudReport> {
    return this.analysis.fraud();
  }

  @Get('disputes')
  @ApiOperation({ summary: 'Tickets on reseller orders, by status, type and store' })
  disputes(): Promise<DisputesOverview> {
    return this.analysis.disputes();
  }

  @Get('float')
  @RequirePermissions('money.treasury.view')
  @ApiOperation({
    summary: 'Store balances, money fronted and Instant Pay advances, per seller and store',
  })
  float(): Promise<ResellerFloat> {
    return this.analysis.float();
  }

  @Post('stores/:storeId/pause')
  @RequirePermissions('reseller.stores.pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a store placing new orders (only the seller can resume it)' })
  async pause(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: AdminPauseStoreDto,
  ): Promise<ResellerStoreDetail> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, kind: SellerStoreKind.RESELLER },
      select: { sellerId: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return this.stores.pause(
      store.sellerId,
      storeId,
      { kind: 'STAFF', staffId: staff.id },
      body.reason,
    );
  }
}
