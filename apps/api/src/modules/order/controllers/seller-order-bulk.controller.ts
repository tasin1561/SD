import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import type { Response } from 'express';

import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { BulkOrderIdsDto } from '../../../common/bulk/bulk-order.dto';
import type { BulkOrderResponse } from '../../../common/bulk/bulk-result';
import { sendCsv } from '../../../common/bulk/send-csv';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { BulkOrderExportService } from '../../bulk-order-actions/services/bulk-order-export.service';
import { SellerBulkExportDto } from '../dto/bulk-order-export.dto';
import { BulkOrderConfirmationService } from '../services/bulk-order-confirmation.service';
import { OrderService } from '../services/order.service';

/**
 * Bulk order actions for the client portal (Phase A: no money moves here).
 *
 * Every route is the single-order action's own permission and own scope:
 * the seller is the caller's token's, an id that is not theirs reads
 * SKIPPED / NOT_FOUND, and nothing here is reachable by naming a seller.
 * `bulk/...` sits two segments deep, so it can never be read as `:id`.
 */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/orders/bulk')
export class SellerOrderBulkController {
  constructor(
    private readonly confirmations: BulkOrderConfirmationService,
    private readonly exporter: BulkOrderExportService,
    private readonly orders: OrderService,
  ) {}

  @Post('confirmation-calls')
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send chosen orders to our call centre — the bulk shape of POST /seller/orders/confirmation-calls. Per-order DONE / SKIPPED / FAILED; an order that is not yours is SKIPPED NOT_FOUND.',
  })
  sendConfirmationCalls(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkOrderIdsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkOrderResponse> {
    return this.confirmations.sendCalls(body.orderIds, { scopeSellerId: seller.id, ctx });
  }

  @Post('confirm-without-call')
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm chosen orders now with no call — the bulk shape of POST /seller/orders/confirm-without-call. Runs the same reserve saga; an order with nothing in stock is SKIPPED OUT_OF_STOCK.',
  })
  confirmWithoutCall(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkOrderIdsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkOrderResponse> {
    return this.confirmations.confirmWithoutCall(body.orderIds, {
      scopeSellerId: seller.id,
      actor: { type: ActorType.SELLER, id: seller.id },
      ctx,
    });
  }

  @Post('export')
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Download chosen orders (orderIds) or every order a list filter matches (filter) as a CSV, at most 5000 rows. Only your own orders; any other id is left out.',
  })
  async export(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SellerBulkExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const ids = await this.exporter.collectIds(body, (f) => this.orders.list(seller.id, f));
    const out = await this.exporter.build({
      audience: 'CLIENT',
      scope: { sellerId: seller.id },
      orderIds: ids,
    });
    sendCsv(res, out);
  }
}
