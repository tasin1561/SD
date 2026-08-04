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
import { ActorType } from '@skydrop/db';
import type { Response } from 'express';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import {
  ListOrderCsvUploadsQueryDto,
  PresignOrderCsvDto,
  PreviewOrderCsvDto,
  ProcessOrderCsvDto,
} from './dto/order-csv-import.dto';
import {
  OrderCsvImportService,
  type BulkOrderUploadView,
  type CsvPresignResult,
  type OrderCsvPreviewResult,
} from './services/order-csv-import.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

@ApiTags('seller-order-csv-import')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.import')
@Controller('seller/order-imports')
export class SellerOrderCsvImportController {
  constructor(private readonly svc: OrderCsvImportService) {}

  @Get('template')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="skydrop-order-import-template.csv"')
  @ApiOperation({ summary: 'Download the canonical order CSV template' })
  template(@Res() res: Response): void {
    res.send(this.svc.buildTemplate());
  }

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a presigned PUT URL to upload an order CSV' })
  presign(
    @Body() body: PresignOrderCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<CsvPresignResult> {
    return this.svc.presign(seller.id, body);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview an uploaded order CSV: headers, sample rows, mapping, gaps' })
  preview(
    @Body() body: PreviewOrderCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<OrderCsvPreviewResult> {
    return this.svc.preview(seller.id, body);
  }

  @Post('process')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create the import job + enqueue the worker' })
  process(
    @Body() body: ProcessOrderCsvDto,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<BulkOrderUploadView> {
    return this.svc.createAndEnqueue(seller.id, body, {
      type: ActorType.SELLER,
      sellerId: seller.id,
    });
  }

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List the seller's order CSV import jobs" })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListOrderCsvUploadsQueryDto,
  ): Promise<{ items: BulkOrderUploadView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listUploads(seller.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(':id')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get an order CSV import job status + metrics' })
  getById(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<BulkOrderUploadView> {
    return this.svc.getUpload(seller.id, id);
  }

  @Get(':id/error-report')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'Download the error-report CSV for a partially-failed import' })
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
