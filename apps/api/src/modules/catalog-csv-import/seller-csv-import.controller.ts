import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { PresignCsvDto, PreviewCsvDto, ProcessCsvDto } from './dto/csv-import.dto';
import {
  CsvImportService,
  type BulkUploadView,
  type CsvPresignResult,
  type CsvPreviewResult,
} from './services/csv-import.service';
import { SellerUserRole } from '@skydrop/db';
import { SellerRoles } from '../../common/decorators/seller-roles.decorator';

@ApiTags('seller-csv-import')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.INVENTORY)
@Controller('seller/csv-imports')
export class SellerCsvImportController {
  constructor(private readonly svc: CsvImportService) {}

  @Get('template')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="skydrop-product-import-template.csv"')
  @ApiOperation({ summary: 'Download the canonical product/variant CSV template' })
  template(@Res() res: Response): void {
    res.send(this.svc.buildTemplate());
  }

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a presigned PUT URL to upload a CSV (APPROVED only)' })
  presign(
    @Body() body: PresignCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<CsvPresignResult> {
    return this.svc.presign(seller.id, body);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview an uploaded CSV: headers, first 5 rows, detected mapping, gaps',
  })
  preview(
    @Body() body: PreviewCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<CsvPreviewResult> {
    return this.svc.preview(seller.id, body);
  }

  @Post('process')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create the import job + enqueue the worker (APPROVED only)',
  })
  process(
    @Body() body: ProcessCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<BulkUploadView> {
    return this.svc.createAndEnqueue(seller.id, body);
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's CSV import jobs" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ items: BulkUploadView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listUploads(
      seller.id,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a CSV import job status + metrics' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<BulkUploadView> {
    return this.svc.getUpload(seller.id, id);
  }

  @Get(':id/error-report')
  @SellerAuthAllowSuspended()
  @ApiOperation({
    summary: 'Download the error-report CSV for a partially-failed import',
  })
  async errorReport(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.svc.getErrorReport(seller.id, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
