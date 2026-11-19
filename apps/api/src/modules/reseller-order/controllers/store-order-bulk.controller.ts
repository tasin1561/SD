import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { sendCsv } from '../../../common/bulk/send-csv';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { BulkOrderExportService } from '../../bulk-order-actions/services/bulk-order-export.service';
import { StoreBulkExportDto } from '../dto/store-bulk-export.dto';
import { ownedBy, StoreOrdersService, viewerFor } from '../services/store-orders.service';

/**
 * Bulk order actions for a member store and its associates (Phase A).
 *
 * Both consoles call this one route, exactly as they share `/store/orders`:
 * the scope is `ownedBy` — the store off the caller's token, and for an
 * associate on OWN scope only the orders they placed — carried in the query
 * that reads the rows. The columns are the ones the store's order list and
 * order page show; the store's cost, the seller's range and the seller's
 * fees are not among them, and cannot be added by naming a column.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders/bulk')
export class StoreOrderBulkController {
  constructor(
    private readonly orders: StoreOrdersService,
    private readonly exporter: BulkOrderExportService,
  ) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Download chosen orders (orderIds) or every order of yours a list filter matches (filter) as a CSV, at most 5000 rows. Only orders you can see on your list; any other id is left out.',
  })
  async export(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: StoreBulkExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const viewer = viewerFor(user);
    const ids = await this.exporter.collectIds(body, (f) =>
      this.orders.list(user.storeId, viewer, f),
    );
    const out = await this.exporter.build({
      audience: 'STORE',
      scope: ownedBy(user.storeId, viewer),
      orderIds: ids,
    });
    sendCsv(res, out);
  }
}
