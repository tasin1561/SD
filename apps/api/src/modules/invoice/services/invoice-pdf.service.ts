import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Phase 1B — GST tax invoice renderer.
 *
 * Pure synchronous-ish PDF generation via pdfkit. The output is a
 * Buffer for the caller to upload to Spaces. No I/O, no DB calls
 * here.
 *
 * Format follows the Indian GST Tax Invoice template:
 *   - Header: "TAX INVOICE" + Skydrop GSTIN + invoice meta
 *   - Bill To: buyer info (recipient)
 *   - Items table: SR / Description / Qty / Rate / Taxable / GST% / IGST / Total
 *   - Totals row + place of supply + footer
 *
 * Numbers shown in ₹ with comma-separated lakh format.
 */
export interface InvoicePayload {
  readonly invoiceNumber: string;
  readonly invoiceDate: string; // ISO
  readonly seller: {
    readonly companyName: string;
    readonly gstin: string | null;
    readonly address: string;
    readonly state: string;
    readonly email: string;
  };
  readonly buyer: {
    readonly name: string;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly city: string;
    readonly state: string;
    readonly postalCode: string;
    readonly phone: string;
    readonly gstin: string | null;
  };
  readonly orderNumber: string;
  readonly placeOfSupplyState: string;
  readonly items: ReadonlyArray<{
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceInr: string;
    readonly lineTotalInr: string;
  }>;
  readonly shippingCharges: ReadonlyArray<{
    readonly label: string;
    readonly amountInr: string;
  }>;
  readonly subtotalInr: string;
  readonly gstRate: string;
  readonly gstInr: string;
  readonly totalInr: string;
}

@Injectable()
export class InvoicePdfService {
  async render(payload: InvoicePayload): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Tax Invoice ${payload.invoiceNumber}`,
          Author: 'Skydrop',
          Subject: payload.orderNumber,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        this.draw(doc, payload);
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private draw(doc: InstanceType<typeof PDFDocument>, p: InvoicePayload): void {
    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica');
    doc.text(`Invoice No: ${p.invoiceNumber}`, { continued: true });
    doc.text(`    Date: ${new Date(p.invoiceDate).toLocaleDateString('en-IN')}`, {
      align: 'right',
    });
    doc.text(`Order: ${p.orderNumber}`);
    doc.moveDown(0.8);

    // Seller block
    doc.fontSize(9).font('Helvetica-Bold').text('From:');
    doc.font('Helvetica').text(p.seller.companyName);
    if (p.seller.gstin) doc.text(`GSTIN: ${p.seller.gstin}`);
    doc.text(p.seller.address);
    doc.text(`State: ${p.seller.state}`);
    doc.text(`Email: ${p.seller.email}`);
    doc.moveDown(0.6);

    // Buyer block
    doc.font('Helvetica-Bold').text('Bill To:');
    doc.font('Helvetica').text(p.buyer.name);
    doc.text(p.buyer.addressLine1);
    if (p.buyer.addressLine2) doc.text(p.buyer.addressLine2);
    doc.text(`${p.buyer.city}, ${p.buyer.state} ${p.buyer.postalCode}`);
    doc.text(`Phone: ${p.buyer.phone}`);
    if (p.buyer.gstin) doc.text(`GSTIN: ${p.buyer.gstin}`);
    doc.moveDown(0.6);

    doc.font('Helvetica-Oblique').fontSize(8).text(`Place of supply: ${p.placeOfSupplyState}`);
    doc.moveDown(0.4);

    // Items table
    this.drawItemsTable(doc, p);

    // Totals
    doc.moveDown(0.4);
    const totalsX = 350;
    const totalsW = 175;
    doc.fontSize(9).font('Helvetica');
    this.totalRow(doc, totalsX, totalsW, 'Subtotal', `₹ ${p.subtotalInr}`);
    if (p.shippingCharges.length > 0) {
      for (const c of p.shippingCharges) {
        this.totalRow(doc, totalsX, totalsW, c.label, `₹ ${c.amountInr}`);
      }
    }
    this.totalRow(doc, totalsX, totalsW, `IGST (${p.gstRate}%)`, `₹ ${p.gstInr}`);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold');
    this.totalRow(doc, totalsX, totalsW, 'Grand Total', `₹ ${p.totalInr}`);

    // Footer
    doc.moveDown(1.5);
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('#666');
    doc.text(
      'This is a computer-generated invoice. No signature required. Goods once shipped will not be taken back unless covered by our RTO policy.',
      { align: 'center' },
    );
    doc.fillColor('black');
  }

  private drawItemsTable(doc: InstanceType<typeof PDFDocument>, p: InvoicePayload): void {
    const startY = doc.y;
    interface Col {
      readonly label: string;
      readonly x: number;
      readonly w: number;
      readonly align: 'left' | 'right';
    }
    const cols: ReadonlyArray<Col> = [
      { label: 'Sr', x: 40, w: 22, align: 'left' },
      // Description absorbs the 50pt the HSN column used to hold, so
      // every column after it keeps its original x and the table still
      // ends at 520.
      { label: 'Description', x: 62, w: 250, align: 'left' },
      { label: 'Qty', x: 312, w: 38, align: 'right' },
      { label: 'Unit', x: 350, w: 70, align: 'right' },
      { label: 'Amount', x: 420, w: 100, align: 'right' },
    ];
    const writeCell = (col: Col, value: string, atY: number): void => {
      doc.text(value, col.x + 3, atY, {
        width: col.w - 6,
        align: col.align,
      });
    };

    // Header
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
    doc.rect(40, startY, 480, 18).fillAndStroke('#f3f3f3', '#dddddd');
    doc.fillColor('#111');
    for (const c of cols) writeCell(c, c.label, startY + 5);

    // Rows
    let y = startY + 18;
    doc.font('Helvetica').fontSize(9);
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i];
      if (!it) continue;
      const rowH = 22;
      if (i % 2 === 1) {
        doc.rect(40, y, 480, rowH).fillAndStroke('#fafafa', '#eeeeee');
        doc.fillColor('#111');
      } else {
        doc.rect(40, y, 480, rowH).stroke('#eeeeee');
      }
      const [c0, c1, c2, c3, c4] = cols;
      if (c0) writeCell(c0, String(i + 1), y + 6);
      if (c1) writeCell(c1, it.description, y + 6);
      if (c2) writeCell(c2, String(it.quantity), y + 6);
      if (c3) writeCell(c3, it.unitPriceInr, y + 6);
      if (c4) writeCell(c4, it.lineTotalInr, y + 6);
      y += rowH;
    }
    doc.y = y;
  }

  private totalRow(
    doc: InstanceType<typeof PDFDocument>,
    x: number,
    w: number,
    label: string,
    value: string,
  ): void {
    const startY = doc.y;
    doc.text(label, x, startY, { width: 100, align: 'left' });
    doc.text(value, x + 105, startY, { width: w - 105, align: 'right' });
  }
}
