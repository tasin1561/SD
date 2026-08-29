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
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { OrderJourneyService, type OrderJourney } from '../services/order-journey.service';

/** uuidv7, as every other order route validates it. */
const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The seller's view of everything that has happened to an order.
 *
 * `@SellerViewerReadable` because this is a READ of the seller's own
 * order — the same surface `SellerOrderController` already opens to the
 * VIEWER role (RBAC-1), and a journey that VIEWER could not see would
 * make the order page render half-empty for them rather than
 * read-only.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
// The same gate the order itself is behind — a journey readable by
// someone who may not read the order would be a way around it.
@RequireSellerPermissions('orders.view')
@SellerViewerReadable()
@Controller('seller/orders')
export class SellerOrderJourneyController {
  constructor(private readonly journey: OrderJourneyService) {}

  @Get(':id/journey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Milestones, parcel facts and the merged Skydrop + courier timeline' })
  forOrder(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<OrderJourney> {
    // The seller id is passed INTO the query rather than checked after,
    // so another seller's order is a 404 rather than a 403 that
    // confirms it exists (the tenant-isolation discipline).
    return this.journey.forOrder(id, seller.id);
  }
}
