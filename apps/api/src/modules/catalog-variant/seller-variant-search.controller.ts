import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { SearchVariantsDto } from './dto/search-variants.dto';
import { CatalogVariantService, type VariantSearchHit } from './services/catalog-variant.service';

/**
 * Find a variant by SKU, label or product name.
 *
 * Its own controller because the path has no product in it: the existing
 * one is `seller/products/:productId/variants`, and the whole point here
 * is not knowing the product yet. A seller picking stock for a
 * consignment knows "the green aviators", not a uuid.
 *
 * `catalog.view`, not `catalog.manage` — this is reading the catalogue,
 * and the screens that use it (a consignment line, an order line) are
 * gated on their own permissions for the thing they go on to write.
 */
@ApiTags('seller-catalog')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('catalog.view')
@Controller('seller/variants')
export class SellerVariantSearchController {
  constructor(private readonly svc: CatalogVariantService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search this seller’s active variants by SKU, label or product name' })
  search(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: SearchVariantsDto,
  ): Promise<VariantSearchHit[]> {
    return this.svc.searchForSeller(seller.id, query.search ?? '', query.limit ?? 20);
  }
}
