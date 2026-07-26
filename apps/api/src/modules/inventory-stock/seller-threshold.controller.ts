import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { SetDefaultThresholdDto, SetVariantThresholdDto } from './dto/threshold.dto';
import {
  SellerThresholdService,
  type AlertConfigView,
  type VariantThresholdView,
} from './services/seller-threshold.service';
import { SellerUserRole } from '@skydrop/db';
import { SellerRoles } from '../../common/decorators/seller-roles.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Seller low-stock threshold config. Empty controller prefix + explicit
 * full paths so the alert-config routes (under /seller/stock) and the
 * per-variant route (under /seller/products) live in one cohesive
 * controller. Mutations require an active (non-suspended) seller; reading
 * the config is allowed while suspended.
 */
@ApiTags('seller-stock')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY)
@Controller()
export class SellerThresholdController {
  constructor(private readonly svc: SellerThresholdService) {}

  @Get('seller/stock/alert-config')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get the seller's default low-stock threshold" })
  getConfig(@CurrentSeller() seller: AuthenticatedSeller): Promise<AlertConfigView> {
    return this.svc.getAlertConfig(seller.id);
  }

  @Patch('seller/stock/alert-config/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set/clear the seller default low-stock threshold' })
  setDefault(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SetDefaultThresholdDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AlertConfigView> {
    return this.svc.setDefaultThreshold(seller.id, body.defaultLowStockThreshold, ctx);
  }

  @Patch('seller/products/:productId/variants/:variantId/threshold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set/clear a variant low-stock threshold (wins over the seller default)' })
  setVariant(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('productId', uuid()) productId: string,
    @Param('variantId', uuid()) variantId: string,
    @Body() body: SetVariantThresholdDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantThresholdView> {
    return this.svc.setVariantThreshold(
      seller.id,
      productId,
      variantId,
      body.lowStockThreshold,
      ctx,
    );
  }
}
