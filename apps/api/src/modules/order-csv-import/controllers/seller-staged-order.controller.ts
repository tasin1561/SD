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
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { StagedOrderRowService, type StagedRowView } from '../services/staged-order-row.service';
import {
  StagedOrderBulkFixService,
  type BulkFixGroup,
  type BulkFixRowResult,
  type SelectionResult,
  type StagedCompactRow,
} from '../services/staged-order-bulk-fix.service';
import {
  BulkFixApplyDto,
  PendingBulkIdsDto,
  PendingBulkSetFieldDto,
  ListStagedRowsQueryDto,
  PatchStagedRowDto,
} from '../dto/staged-order-row.dto';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

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
@RequireSellerPermissions('orders.pending.manage')
@Controller('seller/orders-pending')
export class SellerStagedOrderController {
  constructor(
    private readonly svc: StagedOrderRowService,
    private readonly bulkFix: StagedOrderBulkFixService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Rows waiting on you — oldest upload first' })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListStagedRowsQueryDto,
  ): Promise<StagedRowView[]> {
    return this.svc.list(seller.id, query.uploadId);
  }

  @Get('compact')
  @ApiOperation({ summary: 'One compact line per pending row, for the list-first table' })
  compact(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query() query: ListStagedRowsQueryDto,
  ): Promise<StagedCompactRow[]> {
    return this.bulkFix.compactList(seller.id, query.uploadId);
  }

  @Post('bulk/set-field')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set one field on up to 500 selected pending rows; each is re-validated. One result per row.',
  })
  bulkSetField(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: PendingBulkSetFieldDto,
  ): Promise<SelectionResult> {
    return this.bulkFix.setFieldMany(seller, body);
  }

  @Post('bulk/import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Import the selected pending rows, each as "Import as order" would. One result per row.',
  })
  bulkImport(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: PendingBulkIdsDto,
  ): Promise<SelectionResult> {
    return this.bulkFix.importMany(seller, body);
  }

  @Post('bulk/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discard the selected pending rows. One result per row.' })
  bulkDiscard(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: PendingBulkIdsDto,
  ): Promise<SelectionResult> {
    return this.bulkFix.discardMany(seller, body);
  }

  @Get('bulk-fix')
  @ApiOperation({
    summary: 'Groups of the same problem with the same bad value, with suggested fixes',
  })
  bulkFixSummary(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<{ groups: BulkFixGroup[] }> {
    return this.bulkFix.summary(seller.id);
  }

  @Post('bulk-fix/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set one field on every matching pending row of yours, re-validate each, optionally import the clean ones. Repeating it is a no-op.',
  })
  bulkFixApply(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkFixApplyDto,
  ): Promise<{ matched: number; results: BulkFixRowResult[] }> {
    return this.bulkFix.apply(seller.id, body);
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
