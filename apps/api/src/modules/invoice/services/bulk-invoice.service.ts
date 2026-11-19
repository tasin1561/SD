import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

import { appendNotIncludedPages, type NotIncluded } from '../../../common/bulk/not-included-page';
import { isResellerOrder } from '../../../common/brand/customer-facing-brand';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { InvoiceService } from './invoice.service';

export interface BulkInvoiceResult {
  readonly pdf: Buffer;
  readonly fileName: string;
  /** Orders whose invoice is in the file. */
  readonly included: number;
  readonly notIncluded: readonly NotIncluded[];
}

/**
 * ONE merged PDF of the chosen orders' invoices.
 *
 * Reads exactly what the single `GET /seller/orders/:id/invoice/pdf` reads —
 * the issued invoice row and its stored PDF, rebuilt from the issued
 * snapshot if the object is gone (`ensurePdfObject`). That single read never
 * ISSUES an invoice (issuing is the delivered listener's, or the seller's
 * explicit POST), so neither does this: an order with no invoice yet is
 * listed on the last page, not generated behind the seller's back.
 *
 * The seller is part of every query, so an id that is not theirs is listed as
 * NOT_FOUND and nothing about it is read.
 */
@Injectable()
export class BulkInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly invoices: InvoiceService,
  ) {}

  async merge(
    sellerId: string,
    orderIds: readonly string[],
    now: Date = new Date(),
  ): Promise<BulkInvoiceResult> {
    const ids = [...new Set(orderIds)];
    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: ids }, sellerId, deletedAt: null },
      select: { id: true, orderNumber: true, store: { select: { kind: true } } },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const invoiceRows = await this.prisma.client.invoice.findMany({
      where: { sellerId, orderId: { in: orders.map((o) => o.id) } },
      select: { id: true, orderId: true, invoiceNumber: true, pdfStorageKey: true },
    });
    const invoiceByOrder = new Map(invoiceRows.map((i) => [i.orderId, i]));

    const out = await PDFDocument.create();
    out.setTitle('Invoices');
    out.setProducer('Skydrop');
    const notIncluded: NotIncluded[] = [];
    let included = 0;

    for (const id of ids) {
      const order = byId.get(id);
      if (order === undefined) {
        notIncluded.push({ label: `Order ${id.slice(0, 8)}`, reason: 'NOT_FOUND' });
        continue;
      }
      const label = order.orderNumber;
      if (isResellerOrder(order)) {
        notIncluded.push({
          label,
          reason: 'INVOICE_NOT_FOR_RESELLER_ORDER - member-store orders get no tax invoice',
        });
        continue;
      }
      const inv = invoiceByOrder.get(id);
      if (inv === undefined || inv.pdfStorageKey === null) {
        notIncluded.push({ label, reason: 'INVOICE_NOT_FOUND - no invoice issued yet' });
        continue;
      }
      try {
        if (!(await this.invoices.ensurePdfObject(inv.id))) {
          notIncluded.push({ label, reason: 'INVOICE_PDF_UNAVAILABLE' });
          continue;
        }
        const bytes = await this.spaces.getObject(inv.pdfStorageKey);
        if (bytes === null) {
          notIncluded.push({ label, reason: 'INVOICE_PDF_UNAVAILABLE' });
          continue;
        }
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        for (const p of pages) out.addPage(p);
        included += 1;
      } catch {
        notIncluded.push({ label, reason: 'INVOICE_PDF_UNREADABLE' });
      }
    }

    await appendNotIncludedPages(out, notIncluded);
    const day = now.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
    return {
      pdf: Buffer.from(await out.save()),
      fileName: `skydrop-invoices-${day}.pdf`,
      included,
      notIncluded,
    };
  }
}
