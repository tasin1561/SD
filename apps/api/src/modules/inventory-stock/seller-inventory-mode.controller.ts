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
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';
import { SetVariantInventoryModeDto } from './dto/inventory-mode.dto';
import {
  SellerInventoryModeService,
  type VariantInventoryModeView,
} from './services/seller-inventory-mode.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * R4 — per-variant inventory mode (NORMAL / STRICT), the only interface
 * that can turn per-unit serial tracking on for a SKU.
 *
 * Sits beside SellerThresholdController and shares its shape: an empty
 * controller prefix with the full path spelled out, because this is
 * inventory config hanging off a catalogue route. Reading is allowed
 * while suspended (a suspended seller still needs to see why a parcel
 * is asking for serials); changing it requires an active seller.
 */
@ApiTags('seller-stock')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('inventory.view')
@Controller()
export class SellerInventoryModeController {
  constructor(private readonly svc: SellerInventoryModeService) {}

  @Get('seller/products/:productId/variants/:variantId/inventory-mode')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get a variant's inventory mode (own value + what the floor gates enforce)",
  })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('productId', uuid()) productId: string,
    @Param('variantId', uuid()) variantId: string,
  ): Promise<VariantInventoryModeView> {
    return this.svc.getVariantMode(seller.id, productId, variantId);
  }

  @Patch('seller/products/:productId/variants/:variantId/inventory-mode')
  @RequireSellerPermissions('catalog.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set/clear a variant's inventory mode; null inherits the seller default",
  })
  set(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('productId', uuid()) productId: string,
    @Param('variantId', uuid()) variantId: string,
    @Body() body: SetVariantInventoryModeDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<VariantInventoryModeView> {
    return this.svc.setVariantMode(seller.id, productId, variantId, body.inventoryMode, ctx);
  }
}
