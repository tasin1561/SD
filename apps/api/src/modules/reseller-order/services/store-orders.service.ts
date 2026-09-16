import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerStockMode,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { OrderWriteService } from '../../order/services/order-write.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/** One of a reseller store's orders in its list. The store sees its own customers in full. */
export interface StoreOrderListItem {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly placedAt: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientCity: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: string | null;
  readonly itemCount: number;
}

export interface StoreOrderLineView {
  readonly id: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  /** What the store pays the seller per unit, as placed. */
  readonly transferPriceInr: string | null;
  /** What the store sells one unit for, as placed. */
  readonly retailUnitInr: string | null;
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly stockMode: ResellerStockMode | null;
}

export interface StoreOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  /** A finished order (delivered, returned, cancelled…) — nothing more happens to it. */
  readonly terminal: boolean;
  readonly source: OrderSource;
  readonly placedAt: string;
  readonly confirmedAt: string | null;
  readonly cancelledAt: string | null;
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly altPhoneE164: string | null;
    readonly email: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
  };
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: string | null;
  readonly advanceAmountInr: string | null;
  readonly deliveryFeeInr: string | null;
  readonly discountInr: string | null;
  readonly notes: string | null;
  /** The terms version the order was placed under (RS-4). */
  readonly termsVersion: number | null;
  readonly lines: readonly StoreOrderLineView[];
  readonly totals: { readonly retailInr: string; readonly transferInr: string };
  readonly shipments: ReadonlyArray<{
    readonly awbNumber: string | null;
    readonly courierCode: string;
    readonly status: string;
  }>;
}

export interface StoreOrderEventView {
  readonly id: string;
  readonly type: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus | null;
  readonly description: string | null;
  readonly createdAt: string;
}

function money(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

/** Every store query carries both: the store off the caller's token, and the kind. */
function ownedBy(storeId: string): Prisma.OrderWhereInput {
  return { storeId, storeKind: SellerStoreKind.RESELLER, deletedAt: null };
}

/**
 * RS-5 — a reseller store's OWN orders, read and called off.
 *
 * ── SCOPE IS ALWAYS IN THE WHERE ─────────────────────────────────────
 * `storeId` is the caller's token's (or key's) store. Every read carries
 * it with `storeKind: RESELLER`, so an id from another store — or the
 * seller's own channel order — is a 404 that says nothing about whether
 * the row exists.
 *
 * ── THE STORE SEES ITS CUSTOMERS IN FULL ─────────────────────────────
 * The store sold to them, so their name, phone and address are its to
 * read. Since 2026-09-16 the SELLER reads them too (the order is theirs
 * to ship — ORD-7's amendment); what stays scoped here is one store's
 * view, which never reaches another store or the seller's own channel.
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogReadService,
    private readonly orderRead: OrderReadService,
    private readonly orderWrite: OrderWriteService,
  ) {}

  async list(
    storeId: string,
    query: { page?: number; pageSize?: number; status?: OrderStatus; search?: string },
  ): Promise<{ items: StoreOrderListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = { ...ownedBy(storeId) };
    if (query.status !== undefined) where.status = query.status;
    const search = query.search?.trim();
    if (search !== undefined && search !== '') {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { sellerOrderRef: { contains: search, mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { recipientPhoneE164: { contains: search, mode: 'insensitive' } },
        {
          orderShipments: {
            some: { shipment: { awbNumber: { contains: search, mode: 'insensitive' } } },
          },
        },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          orderNumber: true,
          sellerOrderRef: true,
          status: true,
          source: true,
          placedAt: true,
          recipientName: true,
          recipientPhoneE164: true,
          recipientCity: true,
          recipientPostalCode: true,
          paymentMode: true,
          codAmountInr: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.client.order.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        sellerOrderRef: r.sellerOrderRef,
        status: r.status,
        source: r.source,
        placedAt: r.placedAt.toISOString(),
        recipientName: r.recipientName,
        recipientPhoneE164: r.recipientPhoneE164,
        recipientCity: r.recipientCity,
        recipientPostalCode: r.recipientPostalCode,
        paymentMode: r.paymentMode,
        codAmountInr: money(r.codAmountInr),
        itemCount: r._count.items,
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(storeId: string, orderId: string): Promise<StoreOrderView> {
    const o = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(storeId) },
      select: {
        id: true,
        orderNumber: true,
        sellerOrderRef: true,
        status: true,
        source: true,
        placedAt: true,
        confirmedAt: true,
        cancelledAt: true,
        recipientName: true,
        recipientPhoneE164: true,
        recipientAltPhoneE164: true,
        recipientEmail: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientLandmark: true,
        recipientCity: true,
        recipientStateProvince: true,
        recipientPostalCode: true,
        paymentMode: true,
        codAmountInr: true,
        advanceAmountInr: true,
        deliveryFeeInr: true,
        discountInr: true,
        sellerNotes: true,
        resellerTermsVersion: { select: { version: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            variantId: true,
            skuCode: true,
            productName: true,
            variantLabel: true,
            quantity: true,
            resellerTransferPriceInr: true,
            resellerRetailUnitInr: true,
            resellerMinRetailInr: true,
            resellerMaxRetailInr: true,
            resellerStockMode: true,
          },
        },
        orderShipments: {
          select: { shipment: { select: { awbNumber: true, courierCode: true, status: true } } },
        },
      },
    });
    if (o === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    // A picture beside each line (CatalogReadService, fail-open: a lookup
    // failure costs the pictures, never the order).
    let thumbs: ReadonlyMap<string, string> = new Map();
    try {
      thumbs = await this.catalog.thumbnailUrlsByVariant(o.items.map((i) => i.variantId));
    } catch {
      thumbs = new Map();
    }
    const retail = o.items.reduce(
      (s, i) => s.add((i.resellerRetailUnitInr ?? new Prisma.Decimal(0)).mul(i.quantity)),
      new Prisma.Decimal(0),
    );
    const transfer = o.items.reduce(
      (s, i) => s.add((i.resellerTransferPriceInr ?? new Prisma.Decimal(0)).mul(i.quantity)),
      new Prisma.Decimal(0),
    );
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      sellerOrderRef: o.sellerOrderRef,
      status: o.status,
      terminal: this.orderRead.isTerminalStatus(o.status),
      source: o.source,
      placedAt: o.placedAt.toISOString(),
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      recipient: {
        name: o.recipientName,
        phoneE164: o.recipientPhoneE164,
        altPhoneE164: o.recipientAltPhoneE164,
        email: o.recipientEmail,
        addressLine1: o.recipientAddressLine1,
        addressLine2: o.recipientAddressLine2,
        landmark: o.recipientLandmark,
        city: o.recipientCity,
        stateProvince: o.recipientStateProvince,
        postalCode: o.recipientPostalCode,
      },
      paymentMode: o.paymentMode,
      codAmountInr: money(o.codAmountInr),
      advanceAmountInr: money(o.advanceAmountInr),
      deliveryFeeInr: money(o.deliveryFeeInr),
      discountInr: money(o.discountInr),
      notes: o.sellerNotes,
      termsVersion: o.resellerTermsVersion?.version ?? null,
      lines: o.items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        skuCode: i.skuCode,
        productName: i.productName,
        variantLabel: i.variantLabel,
        imageUrl: thumbs.get(i.variantId) ?? null,
        quantity: i.quantity,
        transferPriceInr: money(i.resellerTransferPriceInr),
        retailUnitInr: money(i.resellerRetailUnitInr),
        minRetailInr: money(i.resellerMinRetailInr),
        maxRetailInr: money(i.resellerMaxRetailInr),
        stockMode: i.resellerStockMode,
      })),
      totals: { retailInr: retail.toFixed(2), transferInr: transfer.toFixed(2) },
      shipments: o.orderShipments
        .map((s) => s.shipment)
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => ({ awbNumber: s.awbNumber, courierCode: s.courierCode, status: s.status })),
    };
  }

  /** The store's timeline: the same seller-visible events the seller sees. */
  async events(storeId: string, orderId: string): Promise<StoreOrderEventView[]> {
    const owned = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(storeId) },
      select: { id: true },
    });
    if (owned === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    const rows = await this.prisma.client.orderEvent.findMany({
      where: { orderId, isVisibleToSeller: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        fromStatus: true,
        toStatus: true,
        description: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * The store calls off one of its own orders — through the SAME seller
   * cancel the seller's own button uses (`OrderWriteService.cancelBySeller`:
   * "until it is packed", the open-box check, CC-6 dequeue, the stock
   * saga). The actor is the store user, so the timeline says who did it.
   */
  async cancel(
    user: { readonly id: string; readonly storeId: string },
    orderId: string,
    body: { readonly reason?: OrderCancellationReason; readonly note?: string },
    ctx: ClientContext,
  ): Promise<StoreOrderView> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(user.storeId) },
      select: { id: true, sellerId: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    await this.orderWrite.cancelBySeller({
      sellerId: order.sellerId,
      orderId: order.id,
      actor: { type: ActorType.STORE, id: user.id },
      cancellationReason: body.reason ?? OrderCancellationReason.SELLER_REQUESTED,
      note: body.note ?? 'Cancelled by the reseller store',
      ctx,
    });
    return this.detail(user.storeId, order.id);
  }
}
