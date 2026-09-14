import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResellerStoreStatus } from '@skydrop/db';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AdminCreateResellerStoreDto } from '../dto/reseller-store.dto';
import {
  ResellerStoreService,
  type ResellerStoreDetail,
  type ResellerStoreView,
} from '../services/reseller-store.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every seller's reseller stores (RS-1), and opening one FOR a seller.
 *
 * A store Skydrop opens lands PENDING_SELLER_APPROVAL and the seller is
 * told: nothing about it is live until they agree. The lifecycle after
 * that is the SELLER's (approve / reject / pause / resume / close) —
 * staff read it here and do not drive it.
 */
@ApiTags('admin-reseller-stores')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('reseller.stores.view')
@Controller('admin/reseller-stores')
export class AdminResellerStoreController {
  constructor(private readonly stores: ResellerStoreService) {}

  @Get()
  @ApiOperation({ summary: 'Reseller stores across sellers (filter by seller and status)' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('status') status?: string,
  ): Promise<readonly ResellerStoreView[]> {
    if (sellerId !== undefined && sellerId !== '' && !UUID.test(sellerId)) {
      throw new BadRequestException({
        code: 'INVALID_SELLER_ID',
        message: 'sellerId must be a uuid',
      });
    }
    const statuses = Object.values(ResellerStoreStatus) as string[];
    if (status !== undefined && status !== '' && !statuses.includes(status)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `status must be one of ${statuses.join(', ')}`,
      });
    }
    return this.stores.listForAdmin({
      ...(sellerId === undefined || sellerId === '' ? {} : { sellerId }),
      ...(status === undefined || status === '' ? {} : { status: status as ResellerStoreStatus }),
    });
  }

  @Get(':storeId')
  @ApiOperation({ summary: 'One reseller store, its status history and its team' })
  detail(
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<ResellerStoreDetail> {
    return this.stores.detail(storeId, null);
  }

  @Post()
  @RequirePermissions('reseller.stores.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a reseller store for a seller — PENDING_SELLER_APPROVAL; the seller is notified',
  })
  create(
    @Body() body: AdminCreateResellerStoreDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ResellerStoreDetail> {
    const { sellerId, ...input } = body;
    return this.stores.create(sellerId, input, { kind: 'STAFF', staffId: staff.id });
  }
}
