import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  PresignOverlayImageDto,
  RegisterOverlayImageDto,
  SaveStoreTermsDto,
} from '../dto/reseller-catalogue.dto';
import {
  ResellerCatalogueService,
  type OverlayImagePresign,
  type StoreTermsView,
} from '../services/reseller-catalogue.service';

/**
 * One reseller store's catalogue terms (RS-3): which variants it may
 * sell, at what price, how its stock is shared, and what it calls them.
 *
 * Writes need `stores.pricing`; the read is open to `stores.manage` too
 * (it sits on the store's own page). Every query carries the seller id
 * from the TOKEN, so another seller's store is a 404.
 */
@ApiTags('seller-reseller-catalogue')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('stores.pricing')
@Controller('seller/reseller-stores')
export class SellerResellerStoreCatalogueController {
  constructor(private readonly catalogue: ResellerCatalogueService) {}

  @Get(':storeId/catalogue')
  @RequireSellerPermissions('stores.pricing', 'stores.manage')
  @ApiOperation({
    summary: 'A store’s terms per variant, with real stock beside what the store will see',
  })
  terms(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreTermsView> {
    return this.catalogue.storeTerms(storeId, seller.id);
  }

  @Put(':storeId/catalogue/:variantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save a store’s terms for one variant (MEDIUM audit; SET_ASIDE_EXCEEDS_STOCK)',
  })
  save(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() body: SaveStoreTermsDto,
  ): Promise<StoreTermsView> {
    return this.catalogue.saveStoreTerms(this.actor(seller), storeId, variantId, body);
  }

  @Post(':storeId/catalogue/:variantId/images/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A presigned PUT for a store-specific picture; then POST /images' })
  presign(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() body: PresignOverlayImageDto,
  ): Promise<OverlayImagePresign> {
    return this.catalogue.presignOverlayImage(
      this.actor(seller),
      storeId,
      variantId,
      body.mimeType,
    );
  }

  @Post(':storeId/catalogue/:variantId/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register an uploaded store-specific picture (at most five)' })
  register(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() body: RegisterOverlayImageDto,
  ): Promise<StoreTermsView> {
    return this.catalogue.registerOverlayImage(
      this.actor(seller),
      storeId,
      variantId,
      body.storageKey,
      body.mimeType,
    );
  }

  @Delete(':storeId/catalogue/:variantId/images/:imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a store-specific picture' })
  removeImage(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
  ): Promise<StoreTermsView> {
    return this.catalogue.removeOverlayImage(this.actor(seller), storeId, variantId, imageId);
  }

  private actor(seller: AuthenticatedSeller): { sellerId: string; sellerUserId: string } {
    return { sellerId: seller.id, sellerUserId: seller.userId };
  }
}
