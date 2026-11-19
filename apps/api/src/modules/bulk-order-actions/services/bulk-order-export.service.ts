import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@skydrop/db';

import { csvLine, istDay, istStamp } from '../../../common/bulk/csv';
import { BULK_MAX_EXPORT } from '../../../common/bulk/bulk-result';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Whose export this is. It decides the COLUMNS, and nothing else:
 *
 *   CLIENT  the client portal's own list, plus the shopfront it came from
 *   STORE   a member store and its associates — exactly what the store's
 *           order list and order page already show, and no seller-only
 *           money (the store pays the seller a transfer price and sees
 *           none of the seller's fees, which is why this has no such column)
 *   ADMIN   staff — adds the client's name
 */
export type ExportAudience = 'CLIENT' | 'STORE' | 'ADMIN';

export interface ExportSelection<F> {
  readonly orderIds?: readonly string[] | undefined;
  readonly filter?: F | undefined;
}

/** The slice of a list page the id-collector needs. */
export interface IdPage {
  readonly items: ReadonlyArray<{ readonly id: string }>;
  readonly total: number;
}

export interface BulkExportResult {
  readonly csv: string;
  readonly fileName: string;
  readonly rowCount: number;
  /** Ids that were asked for and are not in the file (not the caller's, or gone). */
  readonly missingCount: number;
}

const PAGE = 100;
const CHUNK = 500;

const ROW_SELECT = {
  id: true,
  orderNumber: true,
  sellerOrderRef: true,
  status: true,
  source: true,
  placedAt: true,
  recipientName: true,
  recipientPhoneE164: true,
  recipientPostalCode: true,
  recipientCity: true,
  recipientStateProvince: true,
  paymentMode: true,
  codAmountInr: true,
  storeNameSnapshot: true,
  seller: { select: { companyName: true } },
} satisfies Prisma.OrderSelect;

type Row = Prisma.OrderGetPayload<{ select: typeof ROW_SELECT }>;

interface Parcel {
  readonly shipmentId: string;
  readonly awb: string | null;
  readonly courierCode: string;
  readonly courierName: string | null;
}

interface LastScan {
  readonly status: ShipmentStatus;
  readonly at: Date;
}

const COMMON_HEAD = [
  'Order no.',
  'Your ref',
  'Status',
  'Created (IST)',
  'Customer',
  'Phone',
  'PIN',
  'City',
  'State',
  'Payment mode',
  'COD / collectable (INR)',
  'AWB',
  'Courier',
  'Last tracking status',
  'Last tracking time (IST)',
] as const;

@Injectable()
export class BulkOrderExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Turn "these ids" or "this filter" into the ids to export.
   *
   * The filter path runs the console's OWN list query, page by page, so
   * "all N matching" is by construction the N the list screen shows —
   * scope and filters included — rather than a second reading of them.
   */
  async collectIds<F extends { page?: number; pageSize?: number }>(
    selection: ExportSelection<F>,
    listPage: (filter: F) => Promise<IdPage>,
  ): Promise<string[]> {
    const hasIds = selection.orderIds !== undefined;
    const hasFilter = selection.filter !== undefined;
    if (hasIds === hasFilter) {
      throw new BadRequestException({
        code: 'EXPORT_SELECTION_INVALID',
        message: 'Send either orderIds or filter, not both and not neither.',
      });
    }
    if (selection.orderIds !== undefined) {
      const ids = [...new Set(selection.orderIds)];
      if (ids.length === 0 || ids.length > BULK_MAX_EXPORT) {
        throw this.tooMany();
      }
      return ids;
    }
    const base = { ...(selection.filter as F) };
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const res = await listPage({ ...base, page, pageSize: PAGE });
      if (res.total > BULK_MAX_EXPORT) throw this.tooMany();
      for (const it of res.items) ids.push(it.id);
      if (res.items.length < PAGE || ids.length >= res.total) break;
    }
    return ids;
  }

  /**
   * Build the file. `scope` is the caller's own boundary (their seller, their
   * store and person) and is part of the query that reads the rows — an id
   * outside it is simply absent, never fetched and filtered afterwards.
   */
  async build(input: {
    audience: ExportAudience;
    scope: Prisma.OrderWhereInput;
    orderIds: readonly string[];
    now?: Date;
  }): Promise<BulkExportResult> {
    const rowsById = new Map<string, Row>();
    for (let i = 0; i < input.orderIds.length; i += CHUNK) {
      const chunk = input.orderIds.slice(i, i + CHUNK);
      const rows = await this.prisma.client.order.findMany({
        where: { AND: [input.scope, { id: { in: chunk }, deletedAt: null }] },
        select: ROW_SELECT,
      });
      for (const r of rows) rowsById.set(r.id, r);
    }
    const ordered = input.orderIds.flatMap((id) => {
      const r = rowsById.get(id);
      return r === undefined ? [] : [r];
    });

    const parcels = await this.currentParcels(ordered.map((r) => r.id));
    const scans = await this.lastScans([...parcels.values()].map((p) => p.shipmentId));

    const head: string[] = [...COMMON_HEAD];
    if (input.audience === 'CLIENT') head.push('Source', 'Store');
    if (input.audience === 'ADMIN') head.push('Client', 'Source', 'Store');

    const lines: string[] = [csvLine(head)];
    for (const r of ordered) {
      const parcel = parcels.get(r.id);
      const scan = parcel === undefined ? undefined : scans.get(parcel.shipmentId);
      const cells: Array<string | number | null> = [
        r.orderNumber,
        r.sellerOrderRef,
        r.status,
        istStamp(r.placedAt),
        r.recipientName,
        r.recipientPhoneE164,
        r.recipientPostalCode,
        r.recipientCity,
        r.recipientStateProvince,
        r.paymentMode,
        r.codAmountInr === null ? null : r.codAmountInr.toFixed(2),
        parcel?.awb ?? null,
        // A store reads the courier code its order page shows; staff and
        // clients read the courier's display name.
        input.audience === 'STORE'
          ? (parcel?.courierCode ?? null)
          : (parcel?.courierName ?? parcel?.courierCode ?? null),
        scan?.status ?? null,
        istStamp(scan?.at),
      ];
      if (input.audience === 'CLIENT') cells.push(r.source, r.storeNameSnapshot);
      if (input.audience === 'ADMIN') {
        cells.push(r.seller.companyName, r.source, r.storeNameSnapshot);
      }
      lines.push(csvLine(cells));
    }

    const now = input.now ?? new Date();
    return {
      // A byte-order mark so a spreadsheet reads a Bengali or Hindi name as UTF-8.
      csv: `\uFEFF${lines.join('\r\n')}\r\n`,
      fileName: `skydrop-orders-${istDay(now)}.csv`,
      rowCount: ordered.length,
      missingCount: input.orderIds.length - ordered.length,
    };
  }

  /** The newest live parcel per order — the same one the lists show. */
  private async currentParcels(orderIds: readonly string[]): Promise<Map<string, Parcel>> {
    const out = new Map<string, Parcel>();
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const rows = await this.prisma.client.orderShipment.findMany({
        where: {
          orderId: { in: orderIds.slice(i, i + CHUNK) },
          shipment: { deletedAt: null, status: { not: ShipmentStatus.CANCELLED } },
        },
        orderBy: [{ shipmentSequence: 'asc' }, { createdAt: 'asc' }],
        select: {
          orderId: true,
          shipment: {
            select: {
              id: true,
              awbNumber: true,
              courierCode: true,
              manualCourierName: true,
              courier: { select: { displayName: true } },
            },
          },
        },
      });
      for (const r of rows) {
        out.set(r.orderId, {
          shipmentId: r.shipment.id,
          awb: r.shipment.awbNumber,
          courierCode: r.shipment.courierCode,
          courierName: r.shipment.manualCourierName ?? r.shipment.courier?.displayName ?? null,
        });
      }
    }
    return out;
  }

  private async lastScans(shipmentIds: readonly string[]): Promise<Map<string, LastScan>> {
    const out = new Map<string, LastScan>();
    for (let i = 0; i < shipmentIds.length; i += CHUNK) {
      const rows = await this.prisma.client.trackingEvent.findMany({
        where: { shipmentId: { in: shipmentIds.slice(i, i + CHUNK) } },
        orderBy: { eventAt: 'desc' },
        distinct: ['shipmentId'],
        select: { shipmentId: true, status: true, eventAt: true },
      });
      for (const r of rows) out.set(r.shipmentId, { status: r.status, at: r.eventAt });
    }
    return out;
  }

  private tooMany(): BadRequestException {
    return new BadRequestException({
      code: 'EXPORT_TOO_LARGE',
      message: `An export holds at most ${BULK_MAX_EXPORT} orders; narrow the filter or select fewer.`,
    });
  }
}
