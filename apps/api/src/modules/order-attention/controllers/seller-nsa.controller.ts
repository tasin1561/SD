import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { OrderAttentionService } from '../services/order-attention.service';

/**
 * THE SELLER'S side of the NSA worklist.
 *
 * A separate page from ours on purpose. The seller is deciding whether
 * to chase us about their own parcels; we are working every seller's at
 * once and recording who is already on which. Same underlying flag, two
 * different jobs, and one list serving both would serve neither.
 *
 * Scoped by the guard — no sellerId crosses the wire, so a seller cannot
 * ask about anybody else's stuck parcels.
 *
 * VIEWER-readable: this is a view of the seller's OWN orders, which is
 * exactly the surface RBAC-1 already opens to that role, and a read-only
 * team member noticing a stuck parcel is the point of the page.
 */
@ApiTags('seller-nsa')
@ApiBearerAuth()
@UseGuards(SellerJwtGuard)
@RequireSellerPermissions('orders.view')
@SellerViewerReadable()
@Controller('seller/nsa')
export class SellerNsaController {
  constructor(private readonly attention: OrderAttentionService) {}

  @Get()
  @ApiOperation({
    summary: 'Your orders still out for delivery past the evening cutoff — worst first',
  })
  list(@CurrentSeller() seller: AuthenticatedSeller): ReturnType<OrderAttentionService['list']> {
    return this.attention.list(seller.id);
  }
}
