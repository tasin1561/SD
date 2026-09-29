import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerCapability, ShipmentStatus } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import {
  SellerTrackingService,
  type TrackedShipmentDetail,
  type TrackedShipmentRow,
} from '../services/seller-tracking.service';

/**
 * Where a seller's parcels are.
 *
 * Behind `orders.view` because tracking is the same kind of thing as the
 * order list that key already opens — where a parcel is, for orders the
 * caller can already read. It adds no new class of data.
 *
 * Every handler asks the restriction service first (TRACKING_VIEW). The
 * capability existed in the enum before this page did and was
 * deliberately not offered in the admin picker, because a checkbox that
 * ticks and stops nothing tells an operator they have blocked something
 * they have not. It becomes offerable in the same change that adds this
 * guard.
 */
@ApiTags('seller-tracking')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/tracking')
export class SellerTrackingController {
  constructor(
    private readonly svc: SellerTrackingService,
    private readonly restrictions: SellerRestrictionService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Parcels on their way, newest first' })
  async list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: TrackedShipmentRow[] }> {
    await this.restrictions.assertAllowed(seller.id, SellerCapability.TRACKING_VIEW);
    // `@Query('status') status?: ShipmentStatus` is a TYPE, and a query
    // string is whatever the caller sent — so an unknown value went
    // straight into a `where` on an enum column and came back as a 500.
    // The seller's own screen did exactly that for months, sending an
    // ORDER status where a shipment one belongs. A bad query parameter
    // should never be an internal error: it should say which value and
    // what was allowed.
    if (status !== undefined && !(status in ShipmentStatus)) {
      throw new BadRequestException({
        code: 'INVALID_SHIPMENT_STATUS',
        message: `"${status}" is not a shipment status. One of: ${Object.keys(ShipmentStatus).join(', ')}`,
      });
    }
    const items = await this.svc.list(seller.id, {
      ...(status === undefined ? {} : { status: status as ShipmentStatus }),
      ...(search === undefined ? {} : { search }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    return { items };
  }

  @Get(':shipmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One parcel, with every scan and every delivery attempt' })
  async detail(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('shipmentId') shipmentId: string,
  ): Promise<TrackedShipmentDetail> {
    await this.restrictions.assertAllowed(seller.id, SellerCapability.TRACKING_VIEW);
    return this.svc.detail(seller.id, shipmentId);
  }
}
