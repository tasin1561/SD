import {
  Body,
  Controller,
  Get,
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
  type HandoverScanResult,
} from '../services/dispatch-handoff.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import {
  ScanBlockService,
  type ScanBlockView,
} from '../../system-issues/services/scan-block.service';
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
  constructor(
    private readonly handoff: DispatchHandoffService,
    private readonly scanBlocks: ScanBlockService,
  ) {}

  @Get('scan-block')
  // Whoever can scan ANYWHERE can read their own stop. A packer stopped
  // at the pack bench has `warehouse.pack` and no dispatch permission,
  // and a stop they cannot see the reason for is just a broken scanner.
  @RequirePermissions('warehouse.pack', 'courier.dispatch.handoff')
  @ApiOperation({
    summary:
      'Is the caller currently stopped by a duplicate scan? Returns the open incident, or null. Read on load by both benches so a stopped operator sees WHY before scanning again rather than after',
  })
  scanBlock(@CurrentStaff() staff: AuthenticatedStaff): Promise<ScanBlockView | null> {
    return this.scanBlocks.currentBlock(staff.id);
  }

  @Post('handover-scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Scan a parcel at the handover bench, by AWB — this is what hands it to the courier: the order goes DISPATCHED and the manifest closes itself once its last parcel is scanned (ops.handover_scan_dispatches, ON by default). With the switch off it only records the scan, and confirm-handoff stays the dispatch step',
  })
  handoverScan(
    @Body() body: HandoverScanDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<HandoverScanResult> {
    return this.handoff.recordHandoverScan(body.awbNumber, staff.id, ctx);
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
