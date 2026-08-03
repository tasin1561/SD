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
  BinCollapseService,
  type CollapseResult,
  type RequestCollapseResult,
  type RestoreResult,
} from '../services/bin-collapse.service';
import {
  BinBulkTransferService,
  type BulkTransferResult,
} from '../services/bin-bulk-transfer.service';
import {
  BulkTransferDto,
  ConfirmBinCollapseDto,
  MoveWholeBinDto,
  RequestBinCollapseDto,
} from '../dto/bin-ops.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Re-shelving and collapsing.
 *
 * The two halves are gated differently on purpose. Moving stock between
 * bins is ordinary warehouse work a supervisor does daily. Collapsing a
 * warehouse to one location destroys the record of where everything was
 * and is SUPER_ADMIN only, behind a code emailed to the actor.
 */
@ApiTags('admin-warehouse-bin-ops')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.view')
@Controller('admin/warehouses/:warehouseId/bin-ops')
export class AdminBinOpsController {
  constructor(
    private readonly collapse: BinCollapseService,
    private readonly bulk: BinBulkTransferService,
  ) {}

  // ── re-shelving ───────────────────────────────────────────────────

  @Post('move-bin/:sourceBinId')
  @RequirePermissions('warehouse.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move everything currently in one bin to another. The common physical act — you pick the box up and carry it.',
  })
  moveWholeBin(
    @Param('warehouseId', uuid()) warehouseId: string,
    @Param('sourceBinId', uuid()) sourceBinId: string,
    @Body() body: MoveWholeBinDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkTransferResult> {
    return this.bulk.moveWholeBin(warehouseId, sourceBinId, body.destBinId, staff.id, ctx);
  }

  @Post('bulk-transfer')
  @RequirePermissions('warehouse.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Apply a list of bin-to-bin moves as ONE transaction — a half-applied re-shelving is worse than none',
  })
  bulkTransfer(
    @Param('warehouseId', uuid()) warehouseId: string,
    @Body() body: BulkTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkTransferResult> {
    return this.bulk.moveLines(warehouseId, body.lines, staff.id, ctx);
  }

  // ── collapse ──────────────────────────────────────────────────────

  @Post('collapse/request')
  @RequirePermissions('warehouse.bins.collapse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Step 1 of 2 — reports how many bins and units would merge, and emails a confirmation code. Nothing moves.',
  })
  requestCollapse(
    @Param('warehouseId', uuid()) warehouseId: string,
    @Body() body: RequestBinCollapseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RequestCollapseResult> {
    return this.collapse.requestCollapse(warehouseId, staff.id, body.reason, ctx);
  }

  @Post('collapse/confirm')
  @RequirePermissions('warehouse.bins.collapse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Step 2 of 2 — snapshot the layout, then merge every bin into FLOOR. Destructive; recoverable only from that snapshot.',
  })
  confirmCollapse(
    @Param('warehouseId', uuid()) warehouseId: string,
    @Body() body: ConfirmBinCollapseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CollapseResult> {
    return this.collapse.confirmCollapse(warehouseId, staff.id, body, ctx);
  }

  // ── the backup ────────────────────────────────────────────────────

  @Get('snapshots')
  @ApiOperation({ summary: 'Bin layout backups for this warehouse, newest first' })
  async listSnapshots(@Param('warehouseId', uuid()) warehouseId: string): Promise<
    Array<{
      id: string;
      reason: string;
      lineCount: number;
      totalQty: number;
      restoredAt: Date | null;
      expiresAt: Date;
      createdAt: Date;
    }>
  > {
    return this.collapse.listSnapshots(warehouseId);
  }

  @Post('snapshots/:snapshotId/restore')
  @RequirePermissions('warehouse.bins.collapse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Put a snapshot back. Best-effort per line — stock sells and moves in the meantime, so what could not be restored is reported rather than forced.',
  })
  restore(
    @Param('snapshotId', uuid()) snapshotId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RestoreResult> {
    return this.collapse.restore(snapshotId, staff.id, ctx);
  }
}
