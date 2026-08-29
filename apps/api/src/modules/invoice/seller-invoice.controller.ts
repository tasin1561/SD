import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InvoiceService } from './services/invoice.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

/**
 * Seller invoice endpoints. The seller sees:
 *   - GET /seller/orders/:id/invoice — returns invoice metadata + PDF
 *     URL if it exists, OR 404 if no invoice (not yet delivered, or
 *     the listener hasn't fired).
 *   - POST /seller/orders/:id/invoice — manual generation trigger
 *     (re-runs InvoiceService.generateForOrder, which is idempotent).
 *
 * Suspended sellers can still read their invoices (historical record).
 */
@ApiTags('seller-invoices')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('charges.view')
@Controller('seller/orders/:id/invoice')
export class SellerInvoiceController {
  constructor(
    private readonly svc: InvoiceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the invoice for an order (if it exists)' })
  async get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ) {
    await this.assertOwned(seller.id, id);
    const inv = await this.svc.getForSellerOrder(seller.id, id);
    if (!inv) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'No invoice yet for this order — invoices are auto-generated on delivery.',
      });
    }
    return inv;
  }

  /**
   * Send the browser to the PDF.
   *
   * ── WHY A REDIRECT RATHER THAN A URL IN THE JSON ─────────────────
   * A presigned URL lives 15 minutes. Handed to the page as a field and
   * rendered into an href, it is correct on load and dead a quarter of
   * an hour later — so a seller who opens an order, reads it, and then
   * clicks Download gets an AccessDenied page from the bucket. Every
   * workaround for that lives in the client: re-fetch on click, mind
   * the popup blocker, hope nobody bookmarks it.
   *
   * A redirect moves the freshness to the only place that can
   * guarantee it. The link is a plain, permanent, same-origin href; the
   * signature is minted at the moment it is followed and is never in
   * the page at all. It survives a bookmark, a refresh and a slow
   * reader, and the seller's own proxy passes the 302 through
   * (`redirect: 'manual'`) so the browser fetches the object directly
   * rather than streaming it back through us.
   */
  @Get('pdf')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'Redirect to a freshly-signed URL for the invoice PDF' })
  async pdf(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertOwned(seller.id, id);
    const inv = await this.svc.getForSellerOrder(seller.id, id);
    if (inv === null || inv.pdfUrl === null) {
      throw new NotFoundException({
        code: 'INVOICE_PDF_NOT_FOUND',
        message: 'No invoice PDF for this order yet.',
      });
    }
    // 302, not 301: the signature is good for minutes, and a permanent
    // redirect is exactly the thing a browser would cache and replay
    // after it has expired.
    res.redirect(HttpStatus.FOUND, inv.pdfUrl);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger invoice generation. Idempotent — returns existing if already issued.',
  })
  async generate(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ) {
    await this.assertOwned(seller.id, id);
    return this.svc.generateForOrder(id);
  }

  private async assertOwned(sellerId: string, orderId: string): Promise<void> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
  }
}
