import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  ResellerStockMode,
  ResellerStoreActionMode,
  SellerStoreKind,
  StoreOrderRequestKind,
  StoreOrderScope,
} from '@skydrop/db';
import { storeOrderOwnerFilter } from '../../../common/auth/store-order-scope';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { OrderReadService } from '../../order/services/order-read.service';
import {
  OrderWriteService,
  SELLER_CANCELLABLE_STATES,
} from '../../order/services/order-write.service';
import { CONTENTS_EDITABLE_STATUSES } from '../../order/services/order.service';
import { DELIVERY_ACTION_STATUSES } from '../../delivery-action/delivery-action-stages';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  StoreOrderRequestService,
  type StoreOrderRequestView,
} from '../../store-order-request/services/store-order-request.service';

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

/**
 * ASSOC-1 — what the STORE pays its seller, and the range the seller
 * permits it to sell inside. An ASSOCIATE sees NEITHER.
 *
 * ── WHY A DISCRIMINATED UNION AND NOT NULLABLE FIELDS ────────────────
 * The owner's constraint is that "the associate shouldn't be able to see
 * how much the reseller is getting paid and what's the cost" — the same
 * fact `catalogue.sell` exists to withhold, which reached them on the
 * order by a longer route. Three ways to close it, and only one of them
 * stays closed:
 *
 *   - make the fields optional: every ALL-scope reader then narrows for
 *     no reason, and the next cost field somebody adds lands in the
 *     leaky shape BY DEFAULT, which is how this leak happened;
 *   - a second whole order view: thirty fields duplicated that have
 *     nothing to do with cost, and two shapes to keep in step;
 *   - this. A reader must narrow on `visible` before it can touch any
 *     of it, so a cost field added to the `visible: true` arm later is
 *     UNREACHABLE at OWN scope by the type system rather than by
 *     somebody remembering a filter.
 *
 * What stays visible at OWN scope is everything an associate needs to
 * answer their own customer: the product, the quantity, the retail the
 * customer agreed and the money the customer owes. It is the store's
 * cost and the store's permitted range that go.
 */
export type StoreLineCost =
  | {
      readonly visible: true;
      /** What the store pays the seller per unit, as placed. */
      readonly transferPriceInr: string | null;
      /** The range the SELLER set for this product (RS-3). */
      readonly minRetailInr: string | null;
      readonly maxRetailInr: string | null;
    }
  | { readonly visible: false };

/** The same split on the order's totals — the two halves of its margin. */
export type StoreTotalsCost =
  | { readonly visible: true; readonly transferInr: string }
  | { readonly visible: false };

export interface StoreOrderLineView {
  readonly id: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  /** What the store sells one unit for, as placed. */
  readonly retailUnitInr: string | null;
  readonly stockMode: ResellerStockMode | null;
  /** The store's cost and the seller's range — withheld at OWN scope. */
  readonly cost: StoreLineCost;
}

export interface StoreOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  /** A finished order (delivered, returned, cancelled…) — nothing more happens to it. */
  readonly terminal: boolean;
  /**
   * Which of the store's tasks the order's STAGE leaves room for
   * (2026-09-17), read off the same lists the server refuses by. Cosmetic
   * (FE-2): the portal hides what cannot work yet, and each action is
   * still refused by name if tried. The seller's policy is separate.
   */
  readonly stages: {
    /** Cancel — until the parcel is packed. */
    readonly cancel: boolean;
    /** Call the customer again / try again / send it back — out for delivery or just failed. */
    readonly deliveryActions: boolean;
    /**
     * Change the ORDER itself — the customer's details, what is in the
     * parcel, the money — which is possible until the confirmation call
     * settles it (`CONTENTS_EDITABLE_STATUSES`). Past that the customer's
     * details may still change, but the COURIER decides
     * (`/store/orders/:id/consignee`), which is the panel the portal
     * shows instead.
     *
     * Keeps its old name so no saved link or stored client breaks; the
     * capability behind it widened on 2026-09-18 (owner).
     */
    readonly addressCorrection: boolean;
  };
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
  readonly totals: { readonly retailInr: string; readonly cost: StoreTotalsCost };
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

/**
 * ASSOC-1 — WHO is reading, so the WHERE clause can narrow to them.
 *
 * A union rather than an optional scope, because the two callers are
 * genuinely different things and a new one must say which it is. An
 * API KEY has no person behind it (`placed_by_store_user_id` is null on
 * every order it places), so it reads the whole store — narrowing a key
 * to "the orders this key placed" would be a different rule nobody asked
 * for, and it would hide from an integration the orders its own portal
 * users put in.
 */
export type StoreOrderViewer =
  | { readonly kind: 'STORE_USER'; readonly storeUserId: string; readonly scope: StoreOrderScope }
  | { readonly kind: 'STORE_API_KEY' };

/**
 * ASSOC-1 — is this caller narrowed to their own work?
 *
 * THE one predicate, because it answers two different questions that
 * must never diverge: which orders they may read, and whether the
 * store's cost is on them. A machine key is NOT narrowed — it placed
 * none of the orders itself and it is the store's own integration.
 */
export function isOwnScoped(viewer: StoreOrderViewer): boolean {
  return viewer.kind === 'STORE_USER' && viewer.scope === StoreOrderScope.OWN;
}

/** The viewer off an authenticated portal user — resolved by the guard, never here. */
export function viewerFor(user: {
  readonly id: string;
  readonly orderScope: StoreOrderScope;
}): StoreOrderViewer {
  return { kind: 'STORE_USER', storeUserId: user.id, scope: user.orderScope };
}

/**
 * Every store query carries all three: the store off the caller's token,
 * the kind, and — for a person with OWN scope — the orders they placed.
 *
 * ONE function, because this predicate is the whole of ASSOC-1's reading
 * half and a screen that builds its own `where` is a screen that will
 * eventually be built without it.
 */
function ownedBy(storeId: string, viewer: StoreOrderViewer): Prisma.OrderWhereInput {
  return {
    storeId,
    storeKind: SellerStoreKind.RESELLER,
    deletedAt: null,
    ...(viewer.kind === 'STORE_API_KEY'
      ? {}
      : storeOrderOwnerFilter({ scope: viewer.scope, storeUserId: viewer.storeUserId })),
  };
}

/**
 * What came of a store's cancel: done, or waiting on seller staff. A
 * union rather than a nullable order — the address-correction shape.
 */
export type StoreCancelOutcome =
  | { readonly applied: true; readonly order: StoreOrderView; readonly request: null }
  | { readonly applied: false; readonly order: null; readonly request: StoreOrderRequestView };

/**
 * RS-5 — a reseller store's OWN orders, read and called off.
 *
 * ── SCOPE IS ALWAYS IN THE WHERE ─────────────────────────────────────
 * `storeId` is the caller's token's (or key's) store. Every read carries
 * it with `storeKind: RESELLER`, so an id from another store — or the
 * seller's own channel order — is a 404 that says nothing about whether
 * the row exists.
 *
 * ── AND ONE PERSON MAY SEE LESS OF IT (ASSOC-1) ──────────────────────
 * An ASSOCIATE — a store user whose roles resolve to OWN scope — reads
 * only the orders they placed themselves. The narrowing is the same
 * `ownedBy` fragment every query here already carries, so it cannot be
 * applied to the list and forgotten on the detail; and it is in the
 * WHERE clause, so an order of a colleague's is a 404 rather than a row
 * fetched and then hidden.
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
    private readonly policies: ResellerStoreActionPolicyService,
    private readonly requests: StoreOrderRequestService,
  ) {}

  async list(
    storeId: string,
    viewer: StoreOrderViewer,
    query: { page?: number; pageSize?: number; status?: OrderStatus; search?: string },
  ): Promise<{ items: StoreOrderListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = { ...ownedBy(storeId, viewer) };
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

  async detail(
    storeId: string,
    viewer: StoreOrderViewer,
    orderId: string,
  ): Promise<StoreOrderView> {
    const o = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(storeId, viewer) },
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
    /*
      ASSOC-1 — decided ONCE for the whole response, off the same
      predicate that decided which orders this caller may read. Deciding
      it per line would be the same judgement written twice, and a
      response whose lines disagreed with its totals about whether the
      cost is shown is worse than either answer.
    */
    const showCost = !isOwnScoped(viewer);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      sellerOrderRef: o.sellerOrderRef,
      status: o.status,
      terminal: this.orderRead.isTerminalStatus(o.status),
      stages: {
        cancel: SELLER_CANCELLABLE_STATES.has(o.status),
        deliveryActions: DELIVERY_ACTION_STATUSES.has(o.status),
        addressCorrection: CONTENTS_EDITABLE_STATUSES.has(o.status),
      },
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
        retailUnitInr: money(i.resellerRetailUnitInr),
        stockMode: i.resellerStockMode,
        cost: showCost
          ? {
              visible: true,
              transferPriceInr: money(i.resellerTransferPriceInr),
              minRetailInr: money(i.resellerMinRetailInr),
              maxRetailInr: money(i.resellerMaxRetailInr),
            }
          : { visible: false },
      })),
      totals: {
        retailInr: retail.toFixed(2),
        cost: showCost ? { visible: true, transferInr: transfer.toFixed(2) } : { visible: false },
      },
      shipments: o.orderShipments
        .map((s) => s.shipment)
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => ({ awbNumber: s.awbNumber, courierCode: s.courierCode, status: s.status })),
    };
  }

  /** The store's timeline: the same seller-visible events the seller sees. */
  async events(
    storeId: string,
    viewer: StoreOrderViewer,
    orderId: string,
  ): Promise<StoreOrderEventView[]> {
    await this.assertOwned(storeId, viewer, orderId);
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
   *
   * The seller's policy for this store decides HOW (2026-09-17, owner):
   *   OFF         — refused, and told who does it instead.
   *   DIRECT      — cancelled here and now.
   *   ASK_SELLER  — held for seller staff; approving it runs this same
   *                 cancel, as the store, from the leaf decision module.
   * Checked AFTER ownership, so an order that is not this store's stays a
   * 404 that says nothing about whether it exists.
   */
  async cancel(
    user: { readonly id: string; readonly storeId: string; readonly orderScope: StoreOrderScope },
    orderId: string,
    body: { readonly reason?: OrderCancellationReason; readonly note?: string },
    ctx: ClientContext,
  ): Promise<StoreCancelOutcome> {
    const viewer = viewerFor(user);
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(user.storeId, viewer) },
      select: { id: true, sellerId: true },
    });
    if (order === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }

    const policy = await this.policies.forStore(user.storeId);
    if (policy.cancel === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller has not enabled cancelling for this store. Ask them to call the order off.',
      });
    }

    if (policy.cancel === ResellerStoreActionMode.ASK_SELLER) {
      const request = await this.requests.hold({
        storeId: user.storeId,
        storeUserId: user.id,
        orderId: order.id,
        kind: StoreOrderRequestKind.CANCEL,
        note: body.note ?? null,
        cancellationReason: body.reason ?? OrderCancellationReason.SELLER_REQUESTED,
      });
      return { applied: false, order: null, request };
    }

    await this.orderWrite.cancelBySeller({
      sellerId: order.sellerId,
      orderId: order.id,
      actor: { type: ActorType.STORE, id: user.id },
      cancellationReason: body.reason ?? OrderCancellationReason.SELLER_REQUESTED,
      note: body.note ?? 'Cancelled by the reseller store',
      ctx,
    });
    return {
      applied: true,
      order: await this.detail(user.storeId, viewer, order.id),
      request: null,
    };
  }

  /** What this store has sent seller staff to approve on one of its orders. */
  async heldRequests(
    storeId: string,
    viewer: StoreOrderViewer,
    orderId: string,
  ): Promise<readonly StoreOrderRequestView[]> {
    await this.assertOwned(storeId, viewer, orderId);
    return this.requests.listForStoreOrder(storeId, orderId);
  }

  /**
   * THE ownership check every store-side ACT on an order runs first —
   * scoped in the WHERE clause, never fetched and then compared, so a
   * miss is a 404 that says nothing about whether the row exists or
   * whose it is (RS-2's discipline, and ASSOC-1's narrowing inside it).
   *
   * Public because the acts live in sibling services (the edit, the held
   * change) that must not each write this predicate for themselves —
   * that is how one of them comes to be written without the scope.
   */
  async assertOwned(storeId: string, viewer: StoreOrderViewer, orderId: string): Promise<void> {
    const owned = await this.prisma.client.order.findFirst({
      where: { id: orderId, ...ownedBy(storeId, viewer) },
      select: { id: true },
    });
    if (owned === null) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
  }
}
