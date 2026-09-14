import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { ResellerPriceDto } from '../dto/reseller-catalogue.dto';
import {
  ResellerCatalogueService,
  type PriceListView,
  type PriceTermsView,
} from '../services/reseller-catalogue.service';

/**
 * A seller's DEFAULT reseller price list (RS-3) — what every reseller
 * store pays for a variant, and the retail range it may sell at, unless
 * a store has a price of its own.
 *
 * Writes need `stores.pricing`. The READ is open to `stores.manage` as
 * well, because the store screens (behind `stores.manage`) show the
 * default beside each store's terms. Deliberately NOT viewer-readable.
 */
@ApiTags('seller-reseller-catalogue')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.pricing')
@Controller('seller/reseller-price-list')
export class SellerResellerPriceListController {
  constructor(private readonly catalogue: ResellerCatalogueService) {}

  @Get()
  @RequireSellerPermissions('stores.pricing', 'stores.manage')
  @ApiOperation({ summary: 'Every resellable variant with its default reseller price and stock' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<PriceListView> {
    return this.catalogue.sellerPriceList(seller.id);
  }

  @Put(':variantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a variant’s default reseller price (MEDIUM audit)' })
  set(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() body: ResellerPriceDto,
  ): Promise<PriceTermsView> {
    return this.catalogue.setDefaultPrice(
      { sellerId: seller.id, sellerUserId: seller.userId },
      variantId,
      body,
    );
  }

  @Delete(':variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a default price — refused while a store sells it at the default',
  })
  async remove(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
  ): Promise<void> {
    await this.catalogue.removeDefaultPrice(
      { sellerId: seller.id, sellerUserId: seller.userId },
      variantId,
    );
  }
}
