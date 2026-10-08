import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SellerStoreKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CustomerService,
  type CustomerView,
  type ListCustomersQuery,
} from '../../order/services/customer.service';
import { isOwnScoped, type StoreOrderViewer } from './store-orders.service';

/**
 * ASSOC-1 — the people a reseller store has sold to, narrowed to the
 * people ONE of its users has sold to when that user's roles resolve to
 * OWN scope.
 *
 * ── THE SCOPE IS OVER THE ORDERS, NOT OVER THE IDENTITY ──────────────
 * A customer row belongs to the STORE (ORD-7 generalised by RS-5: one
 * identity per owner, per phone), so two associates who both sell to the
 * same phone number share one row — there is no second row to hand one
 * of them. "Only his customers" therefore has to mean "a customer this
 * person has placed an order for", which is a question about the ORDERS
 * and is asked of them: `orders: { some: { placedByStoreUserId } }`, in
 * the WHERE clause, so a colleague's customer is a 404 rather than a row
 * fetched and then hidden.
 *
 * ── ALL SCOPE GOES THROUGH THE ORIGINAL READ, UNCHANGED ──────────────
 * An owner, an admin or an ops user reads exactly what they read before
 * associates existed — `CustomerService.listForStore` / `getForStore`,
 * untouched. Two paths rather than one predicate with an empty branch is
 * the deliberate choice: this is the only new query, so it is the only
 * one that can be wrong, and every store login that exists today is
 * provably unaffected by it.
 */
@Injectable()
export class StoreCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerService,
  ) {}

  async list(
    storeId: string,
    viewer: StoreOrderViewer,
    query: ListCustomersQuery,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    if (!narrowed(viewer)) return this.customers.listForStore(storeId, query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CustomerWhereInput = this.soldTo(storeId, viewer.storeUserId);
    if (query.search !== undefined && query.search !== '') {
      where.OR = [
        { phoneE164: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.client.customer.findMany({
        where,
        orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: SCOPED_SELECT,
      }),
      this.prisma.client.customer.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(storeId: string, viewer: StoreOrderViewer, id: string): Promise<CustomerView> {
    if (!narrowed(viewer)) return this.customers.getForStore(storeId, id);

    const customer = await this.prisma.client.customer.findFirst({
      where: { id, ...this.soldTo(storeId, viewer.storeUserId) },
      select: SCOPED_SELECT,
    });
    if (customer === null) {
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'No such customer' });
    }
    return customer;
  }

  /** This store's customers that THIS person has placed an order for. */
  private soldTo(storeId: string, storeUserId: string): Prisma.CustomerWhereInput {
    return {
      resellerStoreId: storeId,
      deletedAt: null,
      orders: {
        some: {
          placedByStoreUserId: storeUserId,
          // The store and the kind as well as the person: an order of
          // this person's at some OTHER store of the same seller's must
          // not drag a customer into this store's list.
          storeId,
          storeKind: SellerStoreKind.RESELLER,
          deletedAt: null,
        },
      },
    };
  }
}

/**
 * The ONE predicate, borrowed from the orders service rather than
 * restated: "whose customers may this person see" and "whose orders may
 * they see" are the same question, and two copies of it is how one
 * screen comes to answer it differently from the next.
 */
function narrowed(
  viewer: StoreOrderViewer,
): viewer is Extract<StoreOrderViewer, { kind: 'STORE_USER' }> {
  return isOwnScoped(viewer) && viewer.kind === 'STORE_USER';
}

/**
 * The narrowed read's projection.
 *
 * `satisfies Record<keyof CustomerView, true>` is what stops it drifting
 * from `CustomerService`'s own: a field added there widens `CustomerView`
 * and THIS object stops compiling, rather than an associate's customer
 * screen quietly losing a column that everybody else's shows.
 */
const SCOPED_SELECT = {
  id: true,
  sellerId: true,
  phoneE164: true,
  name: true,
  email: true,
  altPhoneE164: true,
  totalOrdersCount: true,
  successfulOrdersCount: true,
  rtoCount: true,
  refusedCount: true,
  fakeOrdersCount: true,
  riskLevel: true,
  riskNotes: true,
  preferredLanguage: true,
  firstOrderAt: true,
  lastOrderAt: true,
  createdAt: true,
} satisfies Record<keyof CustomerView, true> & Prisma.CustomerSelect;
