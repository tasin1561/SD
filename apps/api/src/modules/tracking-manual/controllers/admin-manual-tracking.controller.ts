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
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ManualTrackingService, type ManualScanOutcome } from '../services/manual-tracking.service';
import { RecordManualScanDto } from '../dto/record-manual-scan.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Module 10 (TRK-9) — manual scan recording for manual-courier
 * shipments (the operator is the source of truth; no webhook). RBAC
 * mirrors CUR-8 (MANUAL_PLACEMENT_ADMIN / SUPER_ADMIN) — typically
 * the same operator who placed the manual AWB is the one logging its
 * scans. WAREHOUSE_SUPERVISOR is included so on-site supervisors can
 * record handoff confirmations without bouncing to a separate role.
 *
 * Endpoint: POST /admin/tracking/shipments/:shipmentId/manual-scan.
 * RBAC: `orders.tracking.manual_scan` (TRK-9). ThrottleKey('auth-user')
 * so the rate limit applies per staff user.
 */
@ApiTags('admin-tracking-manual')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.tracking.manual_scan')
@Controller('admin/tracking')
export class AdminManualTrackingController {
  constructor(private readonly svc: ManualTrackingService) {}

  @Post('shipments/:shipmentId/manual-scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'TRK-9 record a manual tracking scan (source=MANUAL_ENTRY, actorType=STAFF) on a shipment. Operator supplies eventAt explicitly (TRK-3 — scan time, not receive time). Drives the same order-lifecycle transitions as a webhook scan via the shared TrackingStatusMappingService + monotonic-forward guard.',
  })
  recordScan(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: RecordManualScanDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ManualScanOutcome> {
    return this.svc.recordScan(
      shipmentId,
      {
        status: body.status,
        eventAtIso: body.eventAtIso,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.locationName !== undefined ? { locationName: body.locationName } : {}),
        ...(body.locationCity !== undefined ? { locationCity: body.locationCity } : {}),
        ...(body.locationPincode !== undefined ? { locationPincode: body.locationPincode } : {}),
        ...(body.failureReason !== undefined ? { failureReason: body.failureReason } : {}),
        ...(body.isVisibleToCustomer !== undefined
          ? { isVisibleToCustomer: body.isVisibleToCustomer }
          : {}),
      },
      staff.id,
    );
  }
}
