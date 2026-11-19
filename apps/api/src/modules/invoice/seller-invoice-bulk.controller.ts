import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';
import { BulkOrderIdsDto } from '../../common/bulk/bulk-order.dto';
import { sendPdf } from '../../common/bulk/send-pdf';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { BulkInvoiceService } from './services/bulk-invoice.service';

/**
 * Bulk invoices for the client portal (Phase A) — one merged PDF. Same key as
 * the single invoice (`charges.view`) and, like it, readable while suspended.
 * Member stores and associates have no invoice to bulk: the single-order
 * invoice does not exist for them either.
 */
@ApiTags('seller-invoices')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('charges.view')
@Controller('seller/orders/bulk/invoices')
export class SellerInvoiceBulkController {
  constructor(private readonly bulk: BulkInvoiceService) {}

  @Post()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One merged PDF of the chosen orders’ issued invoices (at most 200). Orders with no invoice, not yours, or sold by a member store are listed on a final "Not included" page.',
  })
  async invoices(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: BulkOrderIdsDto,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.bulk.merge(seller.id, body.orderIds);
    sendPdf(res, {
      pdf: out.pdf,
      fileName: out.fileName,
      included: out.included,
      skipped: out.notIncluded.length,
    });
  }
}
