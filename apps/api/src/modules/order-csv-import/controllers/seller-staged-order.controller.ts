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
import { SellerUserRole } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerRoles } from '../../../common/decorators/seller-roles.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { StagedOrderRowService, type StagedRowView } from '../services/staged-order-row.service';
import { ListStagedRowsQueryDto, PatchStagedRowDto } from '../dto/staged-order-row.dto';

/**
 * Pending orders — the CSV rows that could not import on their own.
 *
 * A queue, not a report: the seller fills the gaps here and each row
 * becomes an order individually, rather than editing the spreadsheet and
 * re-uploading the whole file.
 */
@ApiTags('seller-staged-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.OPS)
@Controller('seller/orders-pending')
export class SellerStagedOrderController {
  constructor(private readonly svc: StagedOrderRowService) {}

  @Get()
  @ApiOperation({ summary: 'Rows waiting on you — oldest upload first' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListStagedRowsQueryDto,
  ): Promise<StagedRowView[]> {
    return this.svc.list(seller.id, query.uploadId);
  }

  @Post(':rowId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fill in or correct values. Re-validates the whole row, not just what changed.',
  })
  patch(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('rowId', new ParseUUIDPipe({ version: '7' })) rowId: string,
    @Body() body: PatchStagedRowDto,
  ): Promise<StagedRowView> {
    return this.svc.patch(seller.id, rowId, body.data);
  }

  @Post(':rowId/import')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Turn the row into an order. Refuses while values are still missing rather than importing a half-formed order.',
  })
  importRow(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('rowId', new ParseUUIDPipe({ version: '7' })) rowId: string,
  ): Promise<{ orderId: string }> {
    return this.svc.importRow(seller.id, rowId);
  }

  @Post(':rowId/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Throw the row away. Kept for the record, not deleted.' })
  discard(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('rowId', new ParseUUIDPipe({ version: '7' })) rowId: string,
  ): Promise<StagedRowView> {
    return this.svc.discard(seller.id, rowId);
  }
}
