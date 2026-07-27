import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import {
  DispatchHandoffService,
  type DispatchHandoffResult,
} from '../services/dispatch-handoff.service';

/**
 * Module 9 — supervisor dispatch endpoints (commit 13, CUR-4).
 *
 * The HTTP layer over DispatchHandoffService. A WAREHOUSE_SUPERVISOR (or
 * SUPER_ADMIN) confirms a manifest's parcels were physically handed to
 * the courier — every AWB-ready shipment's order transitions
 * PENDING_DISPATCH → DISPATCHED (the DISPATCH_STOCK side-effect fires the
 * bug-1 qtyOnHand decrement, commit 12), the shipment is marked
 * HANDED_TO_COURIER, the manifest flips CONFIRMED → DISPATCHED.
 *
 * RBAC: gated inline via `requireStaffRoles` (Phase-1A posture, mirrors
 * AdminManifestController). Dispatch is operations-staff concern.
 */
@ApiTags('admin-courier-dispatch')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/courier')
export class DispatchController {
  constructor(private readonly handoff: DispatchHandoffService) {}

  @Post('manifests/:manifestId/confirm-handoff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'CUR-4 supervisor handoff: drive every AWB-ready shipment PENDING_DISPATCH→DISPATCHED (DISPATCH_STOCK saga), mark HANDED_TO_COURIER, flip manifest CONFIRMED→DISPATCHED. Per-shipment failure-isolated; idempotent on already-DISPATCHED',
  })
  confirmHandoff(
    @Param('manifestId', new ParseUUIDPipe({ version: '7' }))
    manifestId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DispatchHandoffResult> {
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
    return this.handoff.confirmHandoff(manifestId, staff.id, ctx);
  }
}
