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
  DispatchHandoffService,
  type DispatchHandoffResult,
} from '../services/dispatch-handoff.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { HandoverScanDto } from '../dto/handover-scan.dto';

/**
 * Module 9 — supervisor dispatch endpoints (commit 13, CUR-4).
 *
 * The HTTP layer over DispatchHandoffService. A WAREHOUSE_SUPERVISOR (or
 * SUPER_ADMIN) confirms a manifest's parcels were physically handed to
 * the courier — every AWB-ready shipment's order transitions
 * PENDING_DISPATCH → DISPATCHED. Under Model C (2026-09-03) this edge is
 * stock-neutral: the DISPATCH_STOCK qtyOnHand decrement already fired at
 * PICKED → PACKED. The shipment is marked HANDED_TO_COURIER, the
 * manifest flips CONFIRMED → DISPATCHED.
 *
 * RBAC: `courier.dispatch.handoff`, declared on the controller. That
 * permission is what CUR-4 now means — the guarantee survives an admin
 * inventing a role, which a check against a role NAME would not.
 */
@ApiTags('admin-courier-dispatch')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.dispatch.handoff')
@Controller('admin/courier')
export class DispatchController {
  constructor(private readonly handoff: DispatchHandoffService) {}

  @Post('handover-scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record that a parcel was scanned at the handover bench, by AWB. When ops.handover_scan_required is on, confirm-handoff REFUSES any parcel without this',
  })
  handoverScan(
    @Body() body: HandoverScanDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ shipmentNumber: string; alreadyScanned: boolean }> {
    return this.handoff.recordHandoverScan(body.awbNumber, staff.id);
  }

  @Post('manifests/:manifestId/confirm-handoff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'CUR-4 supervisor handoff: drive every AWB-ready shipment PENDING_DISPATCH→DISPATCHED (stock-neutral under Model C — DISPATCH_STOCK already fired at pack), mark HANDED_TO_COURIER, flip manifest CONFIRMED→DISPATCHED. Per-shipment failure-isolated; idempotent on already-DISPATCHED',
  })
  confirmHandoff(
    @Param('manifestId', new ParseUUIDPipe({ version: '7' }))
    manifestId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DispatchHandoffResult> {
    return this.handoff.confirmHandoff(manifestId, staff.id, ctx);
  }
}
