import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isResellerOrder } from '../../../common/brand/customer-facing-brand';

/** RS-10 — the refusal code for a tax invoice on a reseller-store order. */
export const RESELLER_ORDER_NO_INVOICE = 'INVOICE_NOT_FOR_RESELLER_ORDER';
import {
  ChargeType,
  NotificationCategory,
  NotificationChannel,
  NotificationRecipientType,
  OrderStatus,
  Prisma,
} from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { stripSellerPrefix } from '../../../common/text/recipient-name';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';

/**
 * The in-app topic the invoice notice is carried on since 2026-09-20,
 * when its email leg was retired (`RETIRED_EMAIL_TEMPLATES`).
 */
export const INVOICE_DELIVERED_TOPIC = 'seller.invoice.delivered';
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
 *      `invoices/<sellerId>/<invoiceNumber>.pdf` — PRIVATE — and stores
 *      the payload snapshot + the object's canonical location. The
 *      `pdfUrl` handed back to a caller is presigned per request and
 *      short-lived; it is never the stored value.
 *
 * Eligibility: only DELIVERED orders. The bus listener fires on
 * the DELIVERED transition; manual regeneration via the seller
 * endpoint is also DELIVERED-gated.
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly numbering: InvoiceNumberingService,
    private readonly pdf: InvoicePdfService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
    // The invoice notice's inbox leg (NOTIF-14).
    private readonly dispatch: NotificationDispatchService,
  ) {}

  private async sendInvoiceEmail(
    to: string,
    sellerName: string,
    sellerId: string,
    orderId: string,
    payload: {
      invoiceNumber: string;
      orderNumber: string;
      totalInr: string;
      pdfUrl: string;
    },
  ): Promise<void> {
    // The inbox leg — the channel this notice arrives on since
    // 2026-09-20 (`RETIRED_EMAIL_TEMPLATES`). Addressed by `orders.view`
    // because the invoice is read from the order's own page, which is
    // also where the link below points.
    try {
      await this.dispatch.dispatch({
        topic: INVOICE_DELIVERED_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Invoice ${payload.invoiceNumber}`,
        body: `Order ${payload.orderNumber} was delivered. Its invoice is ₹${payload.totalInr}.`,
        channels: [NotificationChannel.IN_APP],
        audience: [{ kind: 'SELLER_PERMISSION', sellerId, permission: 'orders.view' }],
        triggerEvent: 'invoice.issued',
        orderId,
        eventId: `invoice:${payload.invoiceNumber}`,
      });
    } catch {
      // Best-effort: the invoice itself is the durable fact.
    }
    try {
      await this.email.enqueue({
        templateCode: 'seller.invoice.delivered.email',
        // The seller's OWN id, so the retired-email gate can tell an
        // account (which has an inbox) from an ad-hoc address (which
        // does not) — and so the ledger row says who it was for.
        recipient: { type: NotificationRecipientType.SELLER, id: sellerId, email: to },
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
   * RS-10 / owner decision 8 — "no tax invoices for reseller orders".
   *
   * An order sold by a reseller store (`seller_stores.kind = RESELLER`)
   * is sold by a business we do not invoice for, so none is generated,
   * offered or served for it. Refused BY NAME (409) rather than a 404,
   * so the seller's screen can say why instead of offering a "Generate
   * now" that would never work (FE-2: the UI hides the button; this is
   * the refusal behind it). Every other order is unaffected — this reads
   * one column and returns.
   */
  async isResellerOrder(orderId: string): Promise<boolean> {
    const row = await this.prisma.client.order.findFirst({
      where: { id: orderId },
      select: { store: { select: { kind: true } } },
    });
    return row !== null && isResellerOrder(row);
  }

  async assertInvoiceable(orderId: string): Promise<void> {
    if (await this.isResellerOrder(orderId)) {
      throw new ConflictException({
        code: RESELLER_ORDER_NO_INVOICE,
        message:
          'This order was sold by a reseller store. Reseller-store orders do not get a tax invoice.',
      });
    }
  }

  /**
   * Generate (or return existing) invoice for an order. Caller is the
   * bus listener (post-DELIVERED) OR the seller's "Download invoice"
   * button (manual trigger).
   */
  async generateForOrder(orderId: string): Promise<{
    id: string;
    invoiceNumber: string;
    pdfUrl: string;
    alreadyExisted: boolean;
  }> {
    // RS-10 / decision 8: a reseller-store order gets no tax invoice.
    // Before the idempotency gate, so no path through here can hand one
    // out — whoever asks (the seller's button, the DELIVERED listener).
    await this.assertInvoiceable(orderId);

    // Idempotency gate.
    const existing = await this.prisma.client.invoice.findUnique({
      where: { orderId },
      select: { id: true, invoiceNumber: true, pdfUrl: true, pdfStorageKey: true },
    });
    if (existing && existing.pdfUrl) {
      return {
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        // Freshly minted every call — never the stored pointer.
        pdfUrl: await this.spaces.presignGetUrl(existing.pdfStorageKey),
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
            initials: true,
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
      const price = it.unitPriceInr ? new Prisma.Decimal(it.unitPriceInr) : new Prisma.Decimal(0);
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
    const { invoiceNumber, fiscalYear } = await this.numbering.nextInvoiceNumber(undefined, now);

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
        // Without the seller's code: the buyer on a tax document is a
        // person, not a person plus our internal routing prefix.
        name: stripSellerPrefix(order.seller.initials, order.recipientName),
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
    // The stored value is a POINTER, not a link — the object is private.
    // A GST invoice carries the seller's GSTIN and the buyer's name and
    // address, and the key is `invoices/<sellerId>/<sequential number>`,
    // so a durable anonymous URL would have been enumerable per seller.
    // Callers get a short-lived presigned URL instead; see `presignedPdfUrl`.
    const pdfUrl = this.spaces.canonicalObjectUrl(storageKey);

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
    //
    // The link goes to the DASHBOARD, not to the object. A presigned URL
    // would expire long before most people open the mail, and a durable
    // anonymous one would put the buyer's name and address behind a link
    // that outlives the inbox it was sent to — forwarded, archived,
    // indexed by whatever scans the mailbox. The dashboard page mints a
    // fresh URL for whoever is actually signed in.
    await this.sendInvoiceEmail(
      order.seller.email,
      order.seller.companyName,
      order.seller.id,
      order.id,
      {
        invoiceNumber: created.invoiceNumber,
        orderNumber: order.orderNumber,
        totalInr: totalInr.toFixed(2),
        pdfUrl: `${this.env.sellerAppUrl.replace(/\/$/, '')}/orders/${order.id}`,
      },
    );

    return {
      id: created.id,
      invoiceNumber: created.invoiceNumber,
      pdfUrl: await this.spaces.presignGetUrl(storageKey),
      alreadyExisted: false,
    };
  }

  /**
   * Make sure the invoice's PDF object actually exists, re-rendering it
   * from the stored snapshot if it does not.
   *
   * A presigned URL signs a KEY; it says nothing about whether anything
   * is at that key. Production carried an invoice row claiming 2604
   * bytes whose object was absent, so the permanent link resolved to a
   * NoSuchKey XML page — the same shape of failure as the AccessDenied
   * it replaced, and just as invisible until a seller clicked it.
   *
   * The PDF is DERIVED data: `payloadSnapshot` is the invoice as it was
   * issued, so re-rendering reproduces the same document rather than
   * re-deriving one from live rows that may have moved since. That is
   * what makes healing safe here and would not be safe from the order.
   *
   * Best-effort by construction: if the re-render or the upload fails,
   * the caller still gets its redirect and the seller still sees the
   * courier's error rather than ours. Returns whether an object is
   * present at the end.
   */
  async ensurePdfObject(invoiceId: string): Promise<boolean> {
    const row = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, pdfStorageKey: true, payloadSnapshot: true },
    });
    if (row === null || row.pdfStorageKey === null) return false;

    const head = await this.spaces.headObject(row.pdfStorageKey);
    if (head !== null) return true;

    if (row.payloadSnapshot === null) {
      this.logger.error(
        `invoice ${invoiceId}: PDF object ${row.pdfStorageKey} is missing and there is ` +
          'no snapshot to rebuild it from',
      );
      return false;
    }

    try {
      const buffer = await this.pdf.render(row.payloadSnapshot as unknown as InvoicePayload);
      await this.spaces.putObject(row.pdfStorageKey, buffer, 'application/pdf');
      await this.prisma.client.invoice.update({
        where: { id: row.id },
        data: { pdfSizeBytes: buffer.length },
      });
      this.logger.warn(
        `invoice ${invoiceId}: PDF object ${row.pdfStorageKey} was missing and has been ` +
          `rebuilt from its snapshot (${buffer.length} bytes)`,
      );
      return true;
    } catch (e) {
      this.logger.error(
        `invoice ${invoiceId}: PDF rebuild failed for ${row.pdfStorageKey}: ` +
          (e instanceof Error ? e.message : String(e)),
      );
      return false;
    }
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
        pdfStorageKey: true,
        totalInr: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate.toISOString(),
      // PRESIGNED, never the stored `pdfUrl`.
      //
      // Nothing in the bucket has been public since the 2026-07-28
      // security pass — `pdfUrl` is a canonical pointer that
      // deliberately does not resolve, so handing it to a browser
      // produced an AccessDenied XML page where the invoice should be.
      // `generateForOrder` twenty lines above already does this; this
      // read was simply never updated with the bucket.
      //
      // A row with no storage key has no PDF to sign for — null, so the
      // UI can say "not generated" rather than offering a dead link.
      pdfUrl:
        row.pdfStorageKey === null ? null : await this.spaces.presignGetUrl(row.pdfStorageKey),
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
      address: map.get('invoice.address') ?? 'Bengaluru, Karnataka, India',
      state: map.get('invoice.state') ?? 'Karnataka',
    };
  }
}
