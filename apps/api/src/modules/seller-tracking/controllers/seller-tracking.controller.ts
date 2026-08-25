import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerCapability, ShipmentStatus } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { SellerViewerReadable } from '../../../common/decorators/seller-viewer-readable.decorator';
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
 * `@SellerViewerReadable` because tracking is the same kind of thing as
 * the order list a VIEWER already sees — where a parcel is, for orders
 * they can already read. It adds no new class of data to that role.
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
@SellerViewerReadable()
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
    @Query('status') status?: ShipmentStatus,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: TrackedShipmentRow[] }> {
    await this.restrictions.assertAllowed(seller.id, SellerCapability.TRACKING_VIEW);
    const items = await this.svc.list(seller.id, {
      ...(status === undefined ? {} : { status }),
      ...(search === undefined ? {} : { search }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    return { items };
  }

  /**
   * By ORDER, so the seller never has to know an AWB.
   *
   * Declared before `:shipmentId` — Nest matches routes in declaration
   * order, and `order/...` would otherwise be read as a shipment id.
   */
  @Get('order/:orderId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Every parcel on one order, with each one's timeline" })
  async forOrder(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('orderId') orderId: string,
  ): Promise<{ items: TrackedShipmentDetail[] }> {
    await this.restrictions.assertAllowed(seller.id, SellerCapability.TRACKING_VIEW);
    const items = await this.svc.forOrder(seller.id, orderId);
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
