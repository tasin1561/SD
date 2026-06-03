import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerAuthAllowSuspended } from '../../common/decorators/seller-auth-allow-suspended.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InvoiceService } from './services/invoice.service';

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
        message:
          'No invoice yet for this order — invoices are auto-generated on delivery.',
      });
    }
    return inv;
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
