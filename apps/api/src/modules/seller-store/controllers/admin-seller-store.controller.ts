import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  SellerStoreService,
  type SellerStoresGroup,
  type StoreView,
} from '../services/seller-store.service';
import { CreateStoreDto, SetStoreActiveDto, UpdateStoreDto } from '../dto/seller-store.dto';

/**
 * Every seller's shopfronts, and the ability to fix one.
 *
 * ── WHY STAFF CAN WRITE HERE AT ALL ──────────────────────────────────
 * The seller can manage their own, so this is not the primary path. It
 * is the support path: somebody rings up because orders are landing
 * under the wrong brand, or they closed the store they meant to keep,
 * and the alternative is talking them through a screen while they are
 * already frustrated.
 *
 * Every write is audited as STAFF against that seller — "we renamed
 * their store" and "they renamed it" are different facts, and only one
 * of them is ours to answer for when they ask why it changed.
 */
@ApiTags('admin-seller-stores')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('sellers.view')
@Controller('admin/seller-stores')
export class AdminSellerStoreController {
  constructor(private readonly stores: SellerStoreService) {}

  @Get()
  @ApiOperation({ summary: 'Every seller and the shopfronts they sell under' })
  all(@Query('sellerId') sellerId?: string): Promise<readonly SellerStoresGroup[]> {
    return this.stores.allBySeller(sellerId === undefined || sellerId === '' ? null : sellerId);
  }

  @Post('sellers/:sellerId')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a shopfront for a seller' })
  create(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Body() body: CreateStoreDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreView> {
    return this.stores.create(
      sellerId,
      { name: body.name, note: body.note ?? null },
      { kind: 'STAFF', staffId: staff.id },
    );
  }

  @Patch('sellers/:sellerId/:storeId')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rename a seller’s shopfront' })
  update(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: UpdateStoreDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreView> {
    return this.stores.update(sellerId, storeId, body, { kind: 'STAFF', staffId: staff.id });
  }

  @Post('sellers/:sellerId/:storeId/make-default')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Where this seller’s new orders are filed' })
  makeDefault(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreView> {
    return this.stores.makeDefault(sellerId, storeId, { kind: 'STAFF', staffId: staff.id });
  }

  @Patch('sellers/:sellerId/:storeId/active')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open or close a seller’s shopfront to NEW orders' })
  setActive(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SetStoreActiveDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StoreView> {
    return this.stores.setActive(sellerId, storeId, body.isActive, {
      kind: 'STAFF',
      staffId: staff.id,
    });
  }
}
