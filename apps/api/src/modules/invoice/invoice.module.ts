import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SpacesModule } from '../../infrastructure/spaces/spaces.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { SellerInvoiceController } from './seller-invoice.controller';
import { InvoiceNumberingService } from './services/invoice-numbering.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceService } from './services/invoice.service';
import { OrderDeliveredInvoiceListener } from './services/order-delivered-invoice-listener.service';

/**
 * Phase 1B — GST tax invoices.
 *
 * Auto-generates on DELIVERED via the OrderDeliveredInvoiceListener
 * (4th lifecycle-bus subscriber). Sellers download via:
 *   GET /seller/orders/:id/invoice → { pdfUrl, invoiceNumber, ... }
 */
@Module({
  imports: [LifecycleEventsModule, SpacesModule],
  controllers: [SellerInvoiceController],
  providers: [
    InvoiceService,
    InvoiceNumberingService,
    InvoicePdfService,
    OrderDeliveredInvoiceListener,
    SellerJwtGuard,
  ],
})
export class InvoiceModule {}
