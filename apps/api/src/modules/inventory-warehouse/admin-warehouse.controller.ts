import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import {
  CreateWarehouseDto,
  ListWarehousesQueryDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';
import { CreateBinDto, ListBinsQueryDto, UpdateBinDto } from './dto/bin.dto';
import {
  InventoryWarehouseService,
  type BinView,
  type WarehouseView,
  type ZoneView,
} from './services/inventory-warehouse.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Admin warehouse topology. Staff JWT required on every route. RBAC
 * scoping lands with the Module 12 roll-out (see phase-1a-debt).
 */
@ApiTags('admin-warehouses')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/warehouses')
export class AdminWarehouseController {
  constructor(private readonly svc: InventoryWarehouseService) {}

  // -------- warehouses --------

  @Get()
  @ApiOperation({ summary: 'List warehouses (optionally filter by status)' })
  listWarehouses(@Query() query: ListWarehousesQueryDto): Promise<WarehouseView[]> {
    return this.svc.listWarehouses(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a warehouse' })
  createWarehouse(
    @Body() body: CreateWarehouseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<WarehouseView> {
    return this.svc.createWarehouse(staff.id, body, ctx);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one warehouse' })
  getWarehouse(@Param('id', uuid()) id: string): Promise<WarehouseView> {
    return this.svc.getWarehouse(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a warehouse (code is immutable)' })
  updateWarehouse(
    @Param('id', uuid()) id: string,
    @Body() body: UpdateWarehouseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<WarehouseView> {
    return this.svc.updateWarehouse(staff.id, id, body, ctx);
  }

  // -------- zones --------

  @Get(':id/zones')
  @ApiOperation({ summary: 'List zones in a warehouse' })
  listZones(@Param('id', uuid()) id: string): Promise<ZoneView[]> {
    return this.svc.listZones(id);
  }

  @Post(':id/zones')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a zone in a warehouse' })
  createZone(
    @Param('id', uuid()) id: string,
    @Body() body: CreateZoneDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ZoneView> {
    return this.svc.createZone(staff.id, id, body, ctx);
  }

  @Patch(':id/zones/:zoneId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a zone' })
  updateZone(
    @Param('id', uuid()) id: string,
    @Param('zoneId', uuid()) zoneId: string,
    @Body() body: UpdateZoneDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ZoneView> {
    return this.svc.updateZone(staff.id, id, zoneId, body, ctx);
  }

  @Delete(':id/zones/:zoneId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a zone (must have no active bins)' })
  async deleteZone(
    @Param('id', uuid()) id: string,
    @Param('zoneId', uuid()) zoneId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.deleteZone(staff.id, id, zoneId, ctx);
  }

  // -------- bins --------

  @Get(':id/bins')
  @ApiOperation({ summary: 'List bins in a warehouse (filter by zone/type)' })
  listBins(
    @Param('id', uuid()) id: string,
    @Query() query: ListBinsQueryDto,
  ): Promise<BinView[]> {
    return this.svc.listBins(id, query);
  }

  @Post(':id/bins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bin in a warehouse' })
  createBin(
    @Param('id', uuid()) id: string,
    @Body() body: CreateBinDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BinView> {
    return this.svc.createBin(staff.id, id, body, ctx);
  }

  @Patch(':id/bins/:binId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a bin (may move it to another zone in the same warehouse)' })
  updateBin(
    @Param('id', uuid()) id: string,
    @Param('binId', uuid()) binId: string,
    @Body() body: UpdateBinDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BinView> {
    return this.svc.updateBin(staff.id, id, binId, body, ctx);
  }

  @Delete(':id/bins/:binId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a bin (must hold no stock or active reservations)' })
  async deleteBin(
    @Param('id', uuid()) id: string,
    @Param('binId', uuid()) binId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.deleteBin(staff.id, id, binId, ctx);
  }
}
