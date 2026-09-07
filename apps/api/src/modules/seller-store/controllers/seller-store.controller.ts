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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SellerStoreService, type StoreView } from '../services/seller-store.service';
import { CreateStoreDto, SetStoreActiveDto, UpdateStoreDto } from '../dto/seller-store.dto';

/**
 * A seller's own shopfronts.
 *
 * READS are open to the whole company including VIEWER — the store
 * selector on the order form has to render for anyone who can see an
 * order, and a list of your own brand names carries nothing sensitive.
 * WRITES fall back to `DEFAULT_WRITE_ROLES` under RBAC-1, which is
 * fail-closed: a role has to be widened deliberately.
 */
@ApiTags('seller-stores')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
/*
  READ is `orders.view`, not a settings permission.

  The store selector sits on the order form, so anyone who can create or
  see an order has to be able to list them — gating the list behind
  profile.manage would render a form nobody but an owner could submit. A
  list of your own brand names carries nothing sensitive.

  WRITE is `profile.manage`: adding or closing a shopfront changes where
  every future order is filed, which is a company decision rather than
  an order one.
*/
@RequireSellerPermissions('orders.view')
@SellerViewerReadable()
@Controller('seller/stores')
export class SellerStoreController {
  constructor(private readonly stores: SellerStoreService) {}

  @Get()
  @ApiOperation({ summary: 'Every shopfront, default first' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<readonly StoreView[]> {
    return this.stores.list(seller.id);
  }

  @Post()
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Add a shopfront. Never becomes the default — promoting one is its own act, so adding a store cannot quietly move where new orders are filed.',
  })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateStoreDto,
  ): Promise<StoreView> {
    return this.stores.create(
      seller.id,
      { name: body.name, note: body.note ?? null },
      { sellerUserId: seller.userId },
    );
  }

  @Patch(':storeId')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rename a shopfront. Past orders keep the name they were placed under — renaming must not rewrite what a customer was told.',
  })
  update(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: UpdateStoreDto,
  ): Promise<StoreView> {
    return this.stores.update(seller.id, storeId, body, {
      sellerUserId: seller.userId,
    });
  }

  @Post(':storeId/make-default')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Where new orders are filed when none is chosen' })
  makeDefault(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreView> {
    return this.stores.makeDefault(seller.id, storeId, {
      sellerUserId: seller.userId,
    });
  }

  @Patch(':storeId/active')
  @RequireSellerPermissions('profile.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Open or close a shopfront to NEW orders. The default cannot be closed — order create pre-selects it.',
  })
  setActive(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Body() body: SetStoreActiveDto,
  ): Promise<StoreView> {
    return this.stores.setActive(seller.id, storeId, body.isActive, {
      sellerUserId: seller.userId,
    });
  }
}
