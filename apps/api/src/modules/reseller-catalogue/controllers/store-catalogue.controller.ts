import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerCatalogueService,
  type StoreCatalogueView,
} from '../services/reseller-catalogue.service';

/**
 * A reseller store's own catalogue (RS-3) — only the variants the seller
 * enabled for it, at its price, with the quantity it is SHOWN. Always the
 * caller's OWN store: the id comes from the token, never the request.
 * Never the seller's cost, real stock, hidden share, set-asides or any
 * other store (StoreJwtGuard refuses a store that is not ACTIVE/PAUSED).
 */
@ApiTags('store-catalogue')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('catalogue.view')
@Controller('store/catalogue')
export class StoreCatalogueController {
  constructor(private readonly catalogue: ResellerCatalogueService) {}

  @Get()
  @ApiOperation({ summary: 'The products this store may sell, their prices and availability' })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreCatalogueView> {
    return this.catalogue.storeCatalogue(user.storeId);
  }
}
