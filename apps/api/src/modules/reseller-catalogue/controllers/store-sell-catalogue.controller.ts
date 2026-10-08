import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerCatalogueService,
  type StoreSellCatalogueView,
} from '../services/reseller-catalogue.service';

/**
 * ASSOC-1 — what ONE ASSOCIATE may sell, at THEIR price.
 *
 * ── A SEPARATE CONTROLLER, NOT A HANDLER ON THE STORE CATALOGUE ──────
 * `store-catalogue.controller.ts` is gated at the CLASS by
 * `catalogue.view`, which carries the store's cost. Putting this handler
 * there would mean one controller holding two different audiences, with
 * a handler-level override as the only thing keeping them apart — and an
 * override is a line somebody can delete while the file still reads
 * sensibly. A separate controller behind `catalogue.sell` means an
 * associate cannot reach the endpoint that carries the cost at all,
 * which is the point of the permission being a second key rather than a
 * filter inside the first (docs/associates.md, boundary 2).
 *
 * Both ids come from the TOKEN: the store, as every store route does
 * (RS-2), and the PERSON, because the price returned is their own
 * commercial terms and an id in the request would let anybody read
 * anybody's.
 */
@ApiTags('store-catalogue')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('catalogue.sell')
@Controller('store/catalogue')
export class StoreSellCatalogueController {
  constructor(private readonly catalogue: ResellerCatalogueService) {}

  @Get('sell')
  @ApiOperation({
    summary: 'The products this person may sell, at their own price, with what is available',
  })
  sell(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreSellCatalogueView> {
    return this.catalogue.sellCatalogue({ storeId: user.storeId, storeUserId: user.id });
  }
}
