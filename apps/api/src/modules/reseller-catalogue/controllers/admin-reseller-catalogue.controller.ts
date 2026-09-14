import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ResellerCatalogueService,
  type StoreTermsView,
} from '../services/reseller-catalogue.service';

/**
 * A reseller store's catalogue terms, READ-ONLY for Skydrop (RS-3). The
 * terms are the seller's to set; staff see exactly what the seller sees.
 */
@ApiTags('admin-reseller-stores')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('reseller.stores.view')
@Controller('admin/reseller-stores')
export class AdminResellerCatalogueController {
  constructor(private readonly catalogue: ResellerCatalogueService) {}

  @Get(':storeId/catalogue')
  @ApiOperation({ summary: 'One reseller store’s catalogue terms, prices and stock (read-only)' })
  terms(
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreTermsView> {
    return this.catalogue.storeTerms(storeId, null);
  }
}
