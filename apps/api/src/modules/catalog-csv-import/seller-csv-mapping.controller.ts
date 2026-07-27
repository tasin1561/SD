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
import { CsvImportType } from '@skydrop/db';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateCsvMappingDto, UpdateCsvMappingDto } from './dto/csv-mapping.dto';
import { CsvMappingService, type CsvMappingView } from './services/csv-mapping.service';
import { SellerUserRole } from '@skydrop/db';
import { SellerRoles } from '../../common/decorators/seller-roles.decorator';

@ApiTags('seller-csv-mappings')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY)
@Controller('seller/csv-mappings')
export class SellerCsvMappingController {
  constructor(private readonly svc: CsvMappingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a reusable CSV column mapping (APPROVED only)' })
  create(
    @Body() body: CreateCsvMappingDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CsvMappingView> {
    return this.svc.create(seller.id, body, ctx);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's saved CSV mappings" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('importType') importType?: CsvImportType,
  ): Promise<CsvMappingView[]> {
    return this.svc.list(seller.id, importType);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one saved CSV mapping' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<CsvMappingView> {
    return this.svc.getById(seller.id, id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a saved CSV mapping (APPROVED only)' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: UpdateCsvMappingDto,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CsvMappingView> {
    return this.svc.update(seller.id, id, body, ctx);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a saved CSV mapping (APPROVED only)' })
  async remove(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.softDelete(seller.id, id, ctx);
  }
}
