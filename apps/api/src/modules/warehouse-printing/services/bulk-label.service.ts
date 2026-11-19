import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { PDFDocument } from 'pdf-lib';

import { appendNotIncludedPages, type NotIncluded } from '../../../common/bulk/not-included-page';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { LabelPrintService } from './label-print.service';

/** `LabelPrintService.build` takes at most this many parcels per sheet. */
const SHEET = 100;

export interface BulkLabelResult {
  readonly pdf: Buffer;
  readonly fileName: string;
  /** Orders whose label is in the file. */
  readonly included: number;
  readonly notIncluded: readonly NotIncluded[];
}

/**
 * ONE merged PDF of the chosen orders' labels.
 *
 * Not a second label path: each order's current parcel goes through the
 * existing `LabelPrintService.build` (stored courier label, or the drawn one
 * for a manual courier), in the order the operator chose. An order with no
 * parcel, or a parcel with no waybill yet, is NOT in the file — it is named
 * on a last page, because a short stack looks exactly like a full one on the
 * bench.
 */
@Injectable()
export class BulkLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labels: LabelPrintService,
  ) {}

  async merge(
    orderIds: readonly string[],
    staffId: string,
    now: Date = new Date(),
  ): Promise<BulkLabelResult> {
    const ids = [...new Set(orderIds)];
    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        orderShipments: {
          where: { shipment: { deletedAt: null, status: { not: ShipmentStatus.CANCELLED } } },
          orderBy: [{ shipmentSequence: 'asc' }, { createdAt: 'asc' }],
          select: { shipment: { select: { id: true, awbNumber: true } } },
        },
      },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    const notIncluded: NotIncluded[] = [];
    const queue: Array<{ shipmentId: string; label: string }> = [];
    for (const id of ids) {
      const order = byId.get(id);
      if (order === undefined) {
        notIncluded.push({ label: `Order ${id.slice(0, 8)}`, reason: 'NOT_FOUND' });
        continue;
      }
      // The newest live parcel — the one the lists show.
      const parcel = order.orderShipments.at(-1)?.shipment;
      if (parcel === undefined) {
        notIncluded.push({ label: order.orderNumber, reason: 'NO_PARCEL - not packed yet' });
        continue;
      }
      if (parcel.awbNumber === null) {
        notIncluded.push({
          label: order.orderNumber,
          reason: 'NO_AWB - nothing has been booked for this parcel yet',
        });
        continue;
      }
      queue.push({ shipmentId: parcel.id, label: order.orderNumber });
    }

    const out = await PDFDocument.create();
    out.setTitle('Shipping labels');
    out.setProducer('Skydrop');
    let included = 0;

    for (let i = 0; i < queue.length; i += SHEET) {
      const slice = queue.slice(i, i + SHEET);
      const built = await this.labels.build(
        slice.map((q) => q.shipmentId),
        staffId,
      );
      const failedIds = new Map(built.failed.map((f) => [f.shipmentId, f.reason]));
      for (const q of slice) {
        const reason = failedIds.get(q.shipmentId);
        if (reason === undefined) included += 1;
        else notIncluded.push({ label: q.label, reason });
      }
      // A chunk with every label failed still returns a (blank) document.
      if (built.pageCount > 0) {
        const src = await PDFDocument.load(Buffer.from(built.pdfBase64, 'base64'));
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      }
    }

    await appendNotIncludedPages(out, notIncluded);
    const day = now.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
    return {
      pdf: Buffer.from(await out.save()),
      fileName: `skydrop-labels-${day}.pdf`,
      included,
      notIncluded,
    };
  }
}
