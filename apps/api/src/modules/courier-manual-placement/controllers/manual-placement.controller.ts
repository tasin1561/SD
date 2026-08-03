import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  ManualPlacementService,
  type ManualCancelResult,
  type ManualPlacementResult,
} from '../services/manual-placement.service';
import { CancelUnfulfillableDto, PlaceManualAwbDto } from '../dto/manual-placement.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Module 9 — manual courier placement endpoints (commit 14, CUR-8).
 *
 * For shipments Delhivery could not carry (auto-superseded → order in
 * PENDING_MANUAL_PLACEMENT). A MANUAL_PLACEMENT_ADMIN (or SUPER_ADMIN)
 * records the manually-arranged courier AWB, or cancels an order no
 * courier can fulfil. RBAC: `courier.manual_placement` (CUR-8).
 */
@ApiTags('admin-courier-manual-placement')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.manual_placement')
@Controller('admin/courier/manual-placement')
export class ManualPlacementController {
  constructor(private readonly svc: ManualPlacementService) {}

  @Post('shipments/:shipmentId/place-awb')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'CUR-8 record a manually-arranged courier AWB on a PENDING_MANUAL_PLACEMENT shipment, mark it isManualCourier, and dispatch the order (PENDING_MANUAL_PLACEMENT→DISPATCHED, Model-A qtyOnHand decrement). Conservation-guarded; idempotent',
  })
  placeAwb(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: PlaceManualAwbDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ManualPlacementResult> {
    return this.svc.placeAwb(
      shipmentId,
      {
        awbNumber: body.awbNumber,
        ...(body.courierName !== undefined ? { courierName: body.courierName } : {}),
        ...(body.serviceType !== undefined ? { serviceType: body.serviceType } : {}),
      },
      staff.id,
      ctx,
    );
  }

  @Post('shipments/:shipmentId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'CUR-8 cancel an order no courier can fulfil — PENDING_MANUAL_PLACEMENT→CANCELLED_BY_ADMIN (releases reservations, voids the shipment). Idempotent on an already-cancelled order',
  })
  cancel(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: CancelUnfulfillableDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ManualCancelResult> {
    return this.svc.cancelUnfulfillable(shipmentId, body.reason, staff.id, ctx);
  }
}
