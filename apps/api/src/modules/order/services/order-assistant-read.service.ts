import { Injectable } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * What the in-app AI assistant may read about an order — a deliberately
 * NARROW projection, not the order view.
 *
 * The recipient's phone, e-mail and street address are left out: the
 * assistant answers "where is my order", and a model that never receives
 * a phone number cannot repeat one into a transcript it stores. Money is
 * limited to what the customer owes on delivery (`codAmountInr`).
 */
export interface AssistantOrderSummary {
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: string;
  readonly source: string;
  readonly placedAt: string;
  readonly paymentMode: string;
  readonly codAmountInr: string | null;
  readonly recipient: {
    readonly name: string;
    readonly city: string;
    readonly state: string;
    readonly postalCode: string;
  };
  readonly shipment: { readonly awbNumber: string | null; readonly courier: string } | null;
  /** Present on a single-order read only. */
  readonly items?: ReadonlyArray<{
    readonly sku: string;
    readonly name: string;
    readonly quantity: number;
  }>;
}

interface ListRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: unknown;
  readonly source: unknown;
  readonly placedAt: Date;
  readonly paymentMode: unknown;
  readonly codAmountInr: { toString(): string } | null;
  readonly recipientName: string;
  readonly recipientCity: string | null;
  readonly recipientStateProvince: string | null;
  readonly recipientPostalCode: string;
  readonly shipment: {
    readonly awbNumber: string | null;
    readonly courierDisplayName: string | null;
    readonly manualCourierName: string | null;
    readonly courierCode: string;
  } | null;
}

function summarise(row: ListRow): AssistantOrderSummary {
  return {
    orderNumber: row.orderNumber,
    sellerOrderRef: row.sellerOrderRef,
    status: String(row.status),
    source: String(row.source),
    placedAt: row.placedAt.toISOString(),
    paymentMode: String(row.paymentMode),
    codAmountInr: row.codAmountInr === null ? null : row.codAmountInr.toString(),
    recipient: {
      name: row.recipientName,
      city: row.recipientCity ?? '',
      state: row.recipientStateProvince ?? '',
      postalCode: row.recipientPostalCode,
    },
    shipment:
      row.shipment === null
        ? null
        : {
            awbNumber: row.shipment.awbNumber,
            courier:
              row.shipment.manualCourierName ??
              row.shipment.courierDisplayName ??
              row.shipment.courierCode,
          },
  };
}

/**
 * The order module's door for the assistant (`assistant` module). It
 * exists because `OrderService` is internal to this module (the module
 * exports exactly the read/write facades), and because the projection
 * above belongs next to the order shape it is cut from.
 *
 * The caller's scope is an ARGUMENT, never read from anywhere else:
 * `sellerId` goes straight into `OrderService.list`'s WHERE clause, the
 * same call `GET /seller/orders` makes, so a number that belongs to
 * somebody else matches nothing. Matches are EXACT (order number, the
 * seller's own reference, or the waybill) — a partial match could hand
 * back a different order than the one asked about.
 */
@Injectable()
export class OrderAssistantReadService {
  constructor(private readonly orders: OrderService) {}

  /** The seller's own newest orders. */
  async listForSeller(sellerId: string, limit: number): Promise<AssistantOrderSummary[]> {
    const page = await this.orders.list(sellerId, { page: 1, pageSize: limit });
    return page.items.map(summarise);
  }

  /** One of the seller's orders by order number, own reference or waybill; null if not theirs. */
  async findForSeller(sellerId: string, identifier: string): Promise<AssistantOrderSummary | null> {
    const wanted = identifier.trim().toLowerCase();
    const page = await this.orders.list(sellerId, {
      page: 1,
      pageSize: 10,
      search: identifier.trim(),
    });
    const hit = page.items.find((o) => matches(o, wanted));
    if (hit === undefined) return null;
    const full = await this.orders.loadOwned(sellerId, hit.id);
    return {
      ...summarise(hit),
      items: full.items.map((i) => ({ sku: i.skuCode, name: i.productName, quantity: i.quantity })),
    };
  }

  /** Staff: any order, by the same exact identifiers. */
  async findForStaff(identifier: string): Promise<AssistantOrderSummary | null> {
    const wanted = identifier.trim().toLowerCase();
    const page = await this.orders.adminList({ page: 1, pageSize: 10, search: identifier.trim() });
    const hit = page.items.find((o) => matches(o, wanted));
    if (hit === undefined) return null;
    const full = await this.orders.adminGetById(hit.id);
    return {
      ...summarise(hit),
      items: full.items.map((i) => ({ sku: i.skuCode, name: i.productName, quantity: i.quantity })),
    };
  }
}

function matches(o: ListRow, wanted: string): boolean {
  return (
    o.orderNumber.toLowerCase() === wanted ||
    (o.sellerOrderRef ?? '').toLowerCase() === wanted ||
    (o.shipment?.awbNumber ?? '').toLowerCase() === wanted
  );
}
