import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ChargeType,
  NotificationRecipientType,
  OrderStatus,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { InvoicePdfService, type InvoicePayload } from './invoice-pdf.service';

/**
 * Phase 1B — Invoice generation orchestrator.
 *
 *   1. Idempotency: at most one invoice per orderId (unique index).
 *      A re-run on an already-invoiced order is a clean no-op + returns
 *      the existing row.
 *   2. Render: fetches order + items + charges + seller + system
 *      settings (Skydrop GSTIN etc.), composes the InvoicePayload,
 *      renders to a PDF buffer.
 *   3. Upload: PUTs the buffer to Spaces under
 *      `invoices/<sellerId>/<invoiceNumber>.pdf` and stores the
 *      payload snapshot + public URL.
 *
 * Eligibility: only DELIVERED orders. The bus listener fires on
 * the DELIVERED transition; manual regeneration via the seller
 * endpoint is also DELIVERED-gated.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly numbering: InvoiceNumberingService,
    private readonly pdf: InvoicePdfService,
    private readonly email: EmailQueue,
  ) {}

  private async sendInvoiceEmail(
    to: string,
    sellerName: string,
    payload: {
      invoiceNumber: string;
      orderNumber: string;
      totalInr: string;
      pdfUrl: string;
    },
  ): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'seller.invoice.delivered.email',
        recipient: { type: NotificationRecipientType.SELLER, email: to },
        variables: {
          contact_name: sellerName,
          invoice_number: payload.invoiceNumber,
          order_number: payload.orderNumber,
          total_inr: payload.totalInr,
          pdf_url: payload.pdfUrl,
        },
        triggerEvent: 'invoice.issued',
      });
    } catch {
      // Best-effort: a queue failure must not block the invoice flow.
    }
  }

  /**
   * Generate (or return existing) invoice for an order. Caller is the
   * bus listener (post-DELIVERED) OR the seller's "Download invoice"
   * button (manual trigger).
   */
  async generateForOrder(
    orderId: string,
  ): Promise<{
    id: string;
    invoiceNumber: string;
    pdfUrl: string;
    alreadyExisted: boolean;
  }> {
    // Idempotency gate.
    const existing = await this.prisma.client.invoice.findUnique({
      where: { orderId },
      select: { id: true, invoiceNumber: true, pdfUrl: true },
    });
    if (existing && existing.pdfUrl) {
      return {
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        pdfUrl: existing.pdfUrl,
        alreadyExisted: true,
      };
    }

    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        status: true,
        recipientName: true,
        recipientPhoneE164: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientCity: true,
        recipientStateProvince: true,
        recipientPostalCode: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            productName: true,
            variantLabel: true,
            skuCode: true,
            hsCode: true,
            quantity: true,
            unitPriceInr: true,
          },
        },
        charges: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
          select: { type: true, amountInr: true, taxRate: true, description: true },
        },
        seller: {
          select: {
            id: true,
            companyName: true,
            email: true,
            phone: true,
            countryCode: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_ELIGIBLE',
        message: `Invoices are only generated for DELIVERED orders (current: ${order.status})`,
      });
    }

    // Resolve Skydrop billing entity from system settings (read-only).
    const skydropSettings = await this.loadSkydropSettings();

    // Compute totals from charges.
    const itemSubtotal = order.items.reduce((sum, it) => {
      const price = it.unitPriceInr
        ? new Prisma.Decimal(it.unitPriceInr)
        : new Prisma.Decimal(0);
      return sum.add(price.mul(it.quantity));
    }, new Prisma.Decimal(0));

    let gstInr = new Prisma.Decimal(0);
    let gstRate = new Prisma.Decimal(0);
    const shippingCharges: Array<{ label: string; amountInr: string }> = [];
    for (const c of order.charges) {
      if (c.type === ChargeType.GST) {
        gstInr = gstInr.add(c.amountInr);
        if (c.taxRate) gstRate = c.taxRate;
      } else if (c.type === ChargeType.REFUND) {
        continue;
      } else {
        shippingCharges.push({
          label:
            c.description ??
            c.type
              .toString()
              .replace(/_/g, ' ')
              .toLowerCase()
              .replace(/\b\w/g, (m) => m.toUpperCase()),
          amountInr: c.amountInr.toFixed(2),
        });
      }
    }

    const shippingSubtotal = shippingCharges.reduce(
      (s, c) => s.add(new Prisma.Decimal(c.amountInr)),
      new Prisma.Decimal(0),
    );
    const taxableValue = itemSubtotal.add(shippingSubtotal);
    const totalInr = taxableValue.add(gstInr);

    // Allocate number + write the row + upload PDF in one tx where
    // possible (the PDF upload to Spaces is outside the tx by
    // necessity — Spaces is a separate service. We tolerate the
    // tiny window where row exists with pdfUrl=null; the listener's
    // BullMQ retry, or the seller's manual generate, completes it).
    const now = new Date();
    const { invoiceNumber, fiscalYear } = await this.numbering.nextInvoiceNumber(
      undefined,
      now,
    );

    const payload: InvoicePayload = {
      invoiceNumber,
      invoiceDate: now.toISOString(),
      seller: {
        companyName: skydropSettings.companyName,
        gstin: skydropSettings.gstin,
        address: skydropSettings.address,
        state: skydropSettings.state,
        email: 'support@skydrop.online',
      },
      buyer: {
        name: order.recipientName,
        addressLine1: order.recipientAddressLine1,
        addressLine2: order.recipientAddressLine2,
        city: order.recipientCity,
        state: order.recipientStateProvince,
        postalCode: order.recipientPostalCode,
        phone: order.recipientPhoneE164,
        gstin: null, // Phase 1B B2C only
      },
      orderNumber: order.orderNumber,
      placeOfSupplyState: order.recipientStateProvince,
      items: order.items.map((it) => ({
        description: it.variantLabel
          ? `${it.productName} (${it.variantLabel}) [${it.skuCode}]`
          : `${it.productName} [${it.skuCode}]`,
        hsnCode: it.hsCode ?? null,
        quantity: it.quantity,
        unitPriceInr: it.unitPriceInr ? new Prisma.Decimal(it.unitPriceInr).toFixed(2) : '0.00',
        lineTotalInr: it.unitPriceInr
          ? new Prisma.Decimal(it.unitPriceInr).mul(it.quantity).toFixed(2)
          : '0.00',
      })),
      shippingCharges,
      subtotalInr: itemSubtotal.toFixed(2),
      gstRate: gstRate.toString(),
      gstInr: gstInr.toFixed(2),
      totalInr: totalInr.toFixed(2),
    };

    const pdfBuffer = await this.pdf.render(payload);
    const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9.-]+/g, '_');
    const storageKey = `invoices/${order.sellerId}/${safeNumber}.pdf`;
    await this.spaces.putObject(storageKey, pdfBuffer, 'application/pdf');
    const pdfUrl = this.spaces.publicUrl(storageKey);

    const created = await this.prisma.client.invoice.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        sellerId: order.sellerId,
        invoiceNumber,
        invoiceDate: now,
        fiscalYear,
        subtotalInr: taxableValue,
        gstInr,
        totalInr,
        payloadSnapshot: payload as unknown as Prisma.InputJsonValue,
        pdfStorageKey: storageKey,
        pdfUrl,
        pdfMimeType: 'application/pdf',
        pdfSizeBytes: pdfBuffer.length,
        status: 'ISSUED',
      },
      update: {
        pdfStorageKey: storageKey,
        pdfUrl,
        pdfSizeBytes: pdfBuffer.length,
        status: 'ISSUED',
      },
      select: { id: true, invoiceNumber: true, pdfUrl: true },
    });

    // Best-effort email to the seller. Failure logged + swallowed
    // (mirrors notification listener discipline).
    await this.sendInvoiceEmail(order.seller.email, order.seller.companyName, {
      invoiceNumber: created.invoiceNumber,
      orderNumber: order.orderNumber,
      totalInr: totalInr.toFixed(2),
      pdfUrl: created.pdfUrl ?? pdfUrl,
    });

    return {
      id: created.id,
      invoiceNumber: created.invoiceNumber,
      pdfUrl: created.pdfUrl ?? pdfUrl,
      alreadyExisted: false,
    };
  }

  async getForSellerOrder(
    sellerId: string,
    orderId: string,
  ): Promise<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    pdfUrl: string | null;
    totalInr: string;
  } | null> {
    const row = await this.prisma.client.invoice.findFirst({
      where: { orderId, sellerId },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        pdfUrl: true,
        totalInr: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate.toISOString(),
      pdfUrl: row.pdfUrl,
      totalInr: row.totalInr.toFixed(2),
    };
  }

  /** Read Skydrop billing entity from system settings (with defaults). */
  private async loadSkydropSettings(): Promise<{
    companyName: string;
    gstin: string | null;
    address: string;
    state: string;
  }> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: {
        category: 'invoice',
      },
      select: { key: true, valueString: true },
    });
    const map = new Map<string, string | null>();
    for (const r of rows) map.set(r.key, r.valueString);
    return {
      companyName: map.get('invoice.company_name') ?? 'Skydrop Logistics Pvt Ltd',
      gstin: map.get('invoice.gstin') ?? null,
      address:
        map.get('invoice.address') ??
        'Bengaluru, Karnataka, India',
      state: map.get('invoice.state') ?? 'Karnataka',
    };
  }
}
