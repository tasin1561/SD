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
import { ActorType, StaffRole } from '@skydrop/db';
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
  ManifestService,
  type CloseManifestResult,
  type ManifestDetail,
  type ManifestListRow,
  type MoveShipmentResult,
} from '../services/manifest.service';
import { ListManifestsQueryDto, MoveShipmentDto } from '../dto/admin-manifest.dto';

/**
 * Module 8 — supervisor + admin manifest endpoints (commit 13).
 * WAREHOUSE_SUPERVISOR + SUPER_ADMIN (gated inline via
 * `requireStaffRoles`; Phase-1A RBAC posture). The role gate covers
 * BOTH read (list/detail) and write (close/move): manifests are
 * operations-staff concern.
 */
@ApiTags('admin-warehouse-manifest')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/warehouse')
export class AdminManifestController {
  constructor(private readonly svc: ManifestService) {}

  @Get('manifests')
  @ApiOperation({
    summary: 'List manifests (paginated, filter by status/courier/warehouse)',
  })
  list(
    @Query() query: ListManifestsQueryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{
    items: ManifestListRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
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
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ManifestDetail> {
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
    return this.svc.getById(manifestId);
  }

  @Post('manifests/:manifestId/close')
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
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
    return this.svc.close(manifestId, staff.id, ctx);
  }

  @Post('shipments/:shipmentId/move-manifest')
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
    requireStaffRoles(staff, [StaffRole.WAREHOUSE_SUPERVISOR, StaffRole.SUPER_ADMIN]);
    return this.svc.moveShipment(
      shipmentId,
      body.targetManifestId,
      { type: ActorType.STAFF, id: staff.id },
      ctx,
    );
  }
}
