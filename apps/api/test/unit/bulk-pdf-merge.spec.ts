import { PDFDocument } from 'pdf-lib';

import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import { BulkInvoiceService } from '../../src/modules/invoice/services/bulk-invoice.service';
import type { InvoiceService } from '../../src/modules/invoice/services/invoice.service';
import { BulkLabelService } from '../../src/modules/warehouse-printing/services/bulk-label.service';
import type { LabelPrintService } from '../../src/modules/warehouse-printing/services/label-print.service';

async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

async function pageCount(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

const RESELLER = { kind: 'RESELLER' };
const CHANNEL = { kind: 'CHANNEL' };

describe('BulkInvoiceService', () => {
  function make(): { svc: BulkInvoiceService; orderQuery: jest.Mock } {
    const orders = [
      { id: 'o1', orderNumber: 'SD-1', store: CHANNEL },
      { id: 'o2', orderNumber: 'SD-2', store: CHANNEL }, // no invoice
      { id: 'o3', orderNumber: 'SD-3', store: RESELLER }, // member-store order
      { id: 'o4', orderNumber: 'SD-4', store: CHANNEL },
    ];
    const orderQuery = jest.fn().mockResolvedValue(orders);
    const prisma = {
      client: {
        order: { findMany: orderQuery },
        invoice: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'i1', orderId: 'o1', invoiceNumber: 'INV-1', pdfStorageKey: 'k1' },
            { id: 'i4', orderId: 'o4', invoiceNumber: 'INV-4', pdfStorageKey: 'k4' },
          ]),
        },
      },
    } as unknown as PrismaService;
    const spaces = {
      getObject: jest.fn(async (key: string) => (key === 'k1' ? pdf(2) : pdf(1))),
    } as unknown as SpacesService;
    const invoices = {
      ensurePdfObject: jest.fn().mockResolvedValue(true),
    } as unknown as InvoiceService;
    return { svc: new BulkInvoiceService(prisma, spaces, invoices), orderQuery };
  }

  it('merges the invoices, never issues one, and lists what is left out on a last page', async () => {
    const { svc, orderQuery } = make();
    const out = await svc.merge(
      'sellerA',
      ['o1', 'o2', 'o3', 'o4', 'foreign'],
      new Date('2026-11-19T08:00:00Z'),
    );

    expect(out.included).toBe(2);
    expect(out.notIncluded.map((n) => n.label)).toEqual(['SD-2', 'SD-3', 'Order foreign']);
    expect(out.notIncluded.map((n) => n.reason.split(' ')[0])).toEqual([
      'INVOICE_NOT_FOUND',
      'INVOICE_NOT_FOR_RESELLER_ORDER',
      'NOT_FOUND',
    ]);
    // 2 + 1 invoice pages, plus ONE "Not included" page.
    expect(await pageCount(out.pdf)).toBe(4);
    expect(out.fileName).toBe('skydrop-invoices-2026-11-19.pdf');
    // The seller is part of the order query.
    expect((orderQuery.mock.calls[0]?.[0] as { where: { sellerId: string } }).where.sellerId).toBe(
      'sellerA',
    );
  });

  it('adds no extra page when nothing is left out', async () => {
    const { svc } = make();
    const out = await svc.merge('sellerA', ['o1', 'o4']);
    expect(out.notIncluded).toHaveLength(0);
    expect(await pageCount(out.pdf)).toBe(3);
  });

  it('paginates the not-included list so 200 skips do not run off the page', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `x${i}`);
    const { svc } = make();
    const out = await svc.merge('sellerA', ids);
    expect(out.included).toBe(0);
    expect(out.notIncluded).toHaveLength(120);
    expect(await pageCount(out.pdf)).toBeGreaterThanOrEqual(2);
  });
});

describe('BulkLabelService', () => {
  function make(failShipment?: string): { svc: BulkLabelService; build: jest.Mock } {
    const live = (id: string, awb: string | null): unknown => ({
      shipment: { id, awbNumber: awb },
    });
    const orders = [
      { id: 'o1', orderNumber: 'SD-1', orderShipments: [live('s1', 'AWB1')] },
      { id: 'o2', orderNumber: 'SD-2', orderShipments: [] }, // not packed
      { id: 'o3', orderNumber: 'SD-3', orderShipments: [live('s3', null)] }, // no waybill
      { id: 'o4', orderNumber: 'SD-4', orderShipments: [live('s4', 'AWB4')] },
    ];
    const prisma = {
      client: { order: { findMany: jest.fn().mockResolvedValue(orders) } },
    } as unknown as PrismaService;
    const build = jest.fn(async (shipmentIds: string[]) => {
      const failed = shipmentIds
        .filter((s) => s === failShipment)
        .map((s) => ({ shipmentId: s, shipmentNumber: 'N', reason: 'NO_STORED_LABEL' }));
      const ok = shipmentIds.length - failed.length;
      return {
        pdfBase64: (await pdf(ok)).toString('base64'),
        fileName: 'x.pdf',
        shipmentCount: ok,
        pageCount: ok,
        failed,
      };
    });
    return {
      svc: new BulkLabelService(prisma, { build } as unknown as LabelPrintService),
      build,
    };
  }

  it('sends the labelled parcels through the existing print and names the rest', async () => {
    const { svc, build } = make();
    const out = await svc.merge(
      ['o1', 'o2', 'o3', 'o4', 'ghost'],
      'staff-1',
      new Date('2026-11-19T08:00:00Z'),
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(['s1', 's4'], 'staff-1');
    expect(out.included).toBe(2);
    expect(out.notIncluded.map((n) => n.label)).toEqual(['SD-2', 'SD-3', 'Order ghost']);
    // 2 labels + 1 "Not included" page.
    expect(await pageCount(out.pdf)).toBe(3);
    expect(out.fileName).toBe('skydrop-labels-2026-11-19.pdf');
  });

  it('lists a parcel whose label the print could not produce', async () => {
    const { svc } = make('s4');
    const out = await svc.merge(['o1', 'o4'], 'staff-1');
    expect(out.included).toBe(1);
    expect(out.notIncluded).toEqual([{ label: 'SD-4', reason: 'NO_STORED_LABEL' }]);
    expect(await pageCount(out.pdf)).toBe(2);
  });

  it('prints in sheets of 100 so a 200-order selection never trips the sheet cap', async () => {
    const orders = Array.from({ length: 200 }, (_, i) => ({
      id: `o${i}`,
      orderNumber: `SD-${i}`,
      orderShipments: [{ shipment: { id: `s${i}`, awbNumber: `A${i}` } }],
    }));
    const prisma = {
      client: { order: { findMany: jest.fn().mockResolvedValue(orders) } },
    } as unknown as PrismaService;
    const build = jest.fn(async (ids: string[]) => ({
      pdfBase64: (await pdf(ids.length)).toString('base64'),
      fileName: 'x.pdf',
      shipmentCount: ids.length,
      pageCount: ids.length,
      failed: [],
    }));
    const svc = new BulkLabelService(prisma, { build } as unknown as LabelPrintService);
    const out = await svc.merge(
      orders.map((o) => o.id),
      'staff-1',
    );
    expect(build).toHaveBeenCalledTimes(2);
    expect(out.included).toBe(200);
    expect(await pageCount(out.pdf)).toBe(200);
  });
});
