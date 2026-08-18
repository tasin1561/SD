import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';
import {
  SellerInventoryModeService,
  type VariantInventoryModeView,
} from './services/seller-inventory-mode.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * R4 — per-variant inventory mode, READ ONLY for a seller.
 *
 * The write is gone (2026-08-19). The mode decides whether our staff must
 * scan a serial for every physical unit at pick, pack and RTO, which is
 * our operating procedure rather than a seller preference — a seller
 * flipping it changes what the floor must do with every parcel of theirs,
 * and pins picks to refusal for SKUs nobody serialised. It is set by an
 * admin: per seller through the settings override on the seller's detail
 * page, or globally in system settings.
 *
 * The GET stays because the seller page still SHOWS the mode when it is
 * strict — a seller whose stock is handled that way should be able to see
 * that it is, and why their picks demand serials. Hiding the control
 * without closing the endpoint would have left the old one a request away
 * (FE-2: the UI is cosmetic, the server is the boundary).
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
}
