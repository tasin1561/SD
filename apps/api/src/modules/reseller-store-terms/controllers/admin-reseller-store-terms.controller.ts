import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  ResellerStoreTermsService,
  type StoreTermsView,
} from '../services/reseller-store-terms.service';

/**
 * A reseller store's terms, read-only for staff (RS-4). Terms are the
 * seller's to publish and the store's to accept; Skydrop reads them —
 * including who accepted each version and from where — and does not
 * write them.
 */
@ApiTags('admin-reseller-store-terms')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('reseller.stores.view')
@Controller('admin/reseller-stores/:storeId/terms')
export class AdminResellerStoreTermsController {
  constructor(private readonly terms: ResellerStoreTermsService) {}

  @Get()
  @ApiOperation({ summary: 'The store’s terms: the version in force, acceptances, every version' })
  view(
    @Param('storeId', new ParseUUIDPipe({ version: '7' })) storeId: string,
  ): Promise<StoreTermsView> {
    return this.terms.viewForAdmin(storeId);
  }
}
