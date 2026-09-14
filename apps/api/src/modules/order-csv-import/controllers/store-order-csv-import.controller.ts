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
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ListOrderCsvUploadsQueryDto,
  PresignOrderCsvDto,
  PreviewOrderCsvDto,
  ProcessOrderCsvDto,
} from '../dto/order-csv-import.dto';
import type {
  BulkOrderUploadView,
  CsvPresignResult,
  OrderCsvPreviewResult,
} from '../services/order-csv-import.service';
import { StoreOrderCsvImportService } from '../services/store-order-csv-import.service';

/**
 * RS-5 — a reseller store's order CSV: template, upload, preview, process,
 * status, error report. Each row becomes one of THIS store's orders; the
 * upload and its report are visible to this store only.
 */
@ApiTags('store-order-imports')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.create')
@Controller('store/order-imports')
export class StoreOrderCsvImportController {
  constructor(private readonly svc: StoreOrderCsvImportService) {}

  @Get('template')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="skydrop-store-order-template.csv"')
  @ApiOperation({ summary: 'The store order CSV template (with Retail Price)' })
  template(@Res() res: Response): void {
    res.send(this.svc.buildTemplate());
  }

  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A presigned PUT URL to upload an order CSV' })
  presign(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: PresignOrderCsvDto,
  ): Promise<CsvPresignResult> {
    return this.svc.presign(user, body);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview an uploaded CSV: headers, sample rows, mapping, gaps' })
  preview(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: PreviewOrderCsvDto,
  ): Promise<OrderCsvPreviewResult> {
    return this.svc.preview(user, body);
  }

  @Post('process')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Import it — each row becomes one of this store’s orders' })
  process(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: ProcessOrderCsvDto,
  ): Promise<BulkOrderUploadView> {
    return this.svc.createAndEnqueue(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'This store’s CSV imports' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() query: ListOrderCsvUploadsQueryDto,
  ): Promise<{ items: BulkOrderUploadView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listUploads(user.storeId, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One import’s status and counts' })
  get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<BulkOrderUploadView> {
    return this.svc.getUpload(user.storeId, id);
  }

  @Get(':id/error-report')
  @ApiOperation({ summary: 'The rows that did not import, and why' })
  async errorReport(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.svc.getErrorReport(user.storeId, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
