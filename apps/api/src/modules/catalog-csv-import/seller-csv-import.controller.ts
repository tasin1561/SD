import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
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
import { PresignCsvDto, PreviewCsvDto } from './dto/csv-import.dto';
import {
  CsvImportService,
  type CsvPresignResult,
  type CsvPreviewResult,
} from './services/csv-import.service';

@ApiTags('seller-csv-import')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
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
}
