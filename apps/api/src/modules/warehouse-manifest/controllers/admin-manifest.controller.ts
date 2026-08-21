import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  ManifestService,
  type CloseManifestResult,
  type ManifestDetail,
  type ManifestListRow,
  type AttachShipmentResult,
  type MoveShipmentResult,
} from '../services/manifest.service';
import { ListManifestsQueryDto, MoveShipmentDto } from '../dto/admin-manifest.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Module 8 — supervisor + admin manifest endpoints (commit 13).
 * WAREHOUSE_SUPERVISOR + SUPER_ADMIN (gated inline via
 * permissions). Reading a manifest is `warehouse.view`; closing or
 * moving one is `warehouse.manifest.close` (WMS-6) — sealing the day's
 * parcels triggers AWB generation and cannot be undone.
 */
@ApiTags('admin-warehouse-manifest')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.view')
@Controller('admin/warehouse')
export class AdminManifestController {
  constructor(private readonly svc: ManifestService) {}

  @Get('manifests')
  @ApiOperation({
    summary: 'List manifests (paginated, filter by status/courier/warehouse)',
  })
  list(@Query() query: ListManifestsQueryDto): Promise<{
    items: ManifestListRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.svc.listManifests({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.courierCode !== undefined ? { courierCode: query.courierCode } : {}),
      ...(query.warehouseId !== undefined ? { warehouseId: query.warehouseId } : {}),
    });
  }

  @Get('manifests/:manifestId')
  @ApiOperation({ summary: 'Manifest detail with attached shipments' })
  getById(
    @Param('manifestId', new ParseUUIDPipe({ version: '7' }))
    manifestId: string,
  ): Promise<ManifestDetail> {
    return this.svc.getById(manifestId);
  }

  @Post('manifests/:manifestId/close')
  @RequirePermissions('warehouse.manifest.close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'WMS-6 supervisor close: DRAFT→CLOSED, drive each shipment PACKED→PENDING_DISPATCH (saga), emit M9 AWB enqueue stub. Idempotent on already-CLOSED',
  })
  close(
    @Param('manifestId', new ParseUUIDPipe({ version: '7' }))
    manifestId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CloseManifestResult> {
    return this.svc.close(manifestId, staff.id, ctx);
  }

  @Post('shipments/:shipmentId/attach')
  @RequirePermissions('warehouse.manifest.close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Attach a packed, unmanifested shipment to a DRAFT manifest (find-or-create per courier + warehouse) — the way back for a CUR-7 supersede replacement',
  })
  // WMS-7 already attaches at pack time, and that covered every shipment
  // that reaches a manifest the normal way. It does not cover the one
  // that gets there by SUPERSEDE: the replacement copies the original's
  // pick/pack timestamps, so it is invisible to the pick queue
  // (pick_started_at IS NULL) and the pack queue (pack_completed_at IS
  // NULL) alike, and there was no third door. A courier failure at
  // manifest close therefore stranded the replacement permanently —
  // recoverable only by placing it manually with a different courier, or
  // cancelling. Found during the first live Delhivery write.
  attach(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AttachShipmentResult> {
    return this.svc.attachShipment(shipmentId, { type: ActorType.STAFF, id: staff.id }, ctx);
  }

  @Post('shipments/:shipmentId/move-manifest')
  @RequirePermissions('warehouse.manifest.close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'WMS-7 supervisor move: reassign a packed shipment from its current DRAFT manifest to another DRAFT manifest (same courier + warehouse, pre-close only)',
  })
  move(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: MoveShipmentDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<MoveShipmentResult> {
    return this.svc.moveShipment(
      shipmentId,
      body.targetManifestId,
      { type: ActorType.STAFF, id: staff.id },
      ctx,
    );
  }
}
