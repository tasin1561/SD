import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  SellerStoreKind,
  VariantStatus,
  SellerCapability,
  ShipmentStatus,
} from '@skydrop/db';
import {
  resellerOrderColumns,
  type ResellerCreateContext,
  type ResellerLineTerms,
} from '../reseller-order-snapshot';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { CustomerService } from './customer.service';
import { CustomerReputationService } from './customer-reputation.service';
import { OrderNumberingService } from './order-numbering.service';
import { OrderEventWriterService, type EventActor } from './order-event-writer.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { RecipientAddressCacheService } from './recipient-address-cache.service';
import { AddressValidationService } from './address-validation.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import { OrderChargesService } from '../../order-charges/services/order-charges.service';
import { EarlyReservationService } from '../../early-reservation/services/early-reservation.service';
import { composeSellerPrefixedName, stripSellerPrefix } from '../../../common/text/recipient-name';
import type { CreateOrderDto } from '../dto/create-order.dto';
import type { UpdateOrderDto } from '../dto/update-order.dto';
import { SellerCreditService } from '../../seller-credit/services/seller-credit.service';
import { SellerStoreService } from '../../seller-store/services/seller-store.service';
import { StoreOrderRequestService } from '../../store-order-request/services/store-order-request.service';
import { StoreRequestNotifier } from '../../store-order-request/services/store-request-notifier.service';
import { ResellerOrderMoneyService } from '../../reseller-order-money/services/reseller-order-money.service';
import { ResellerOrderRetermService } from './reseller-order-reterm.service';
import {
  OrderPostCommitHooksService,
  type ResellerMoneyEditOutcome,
} from './order-post-commit-hooks.service';
import { recipientChangeRoute } from '../recipient-change-route';
import { describeMoneyOutcome, describeOrderChanges } from '../order-change-description';

/**
 * The statuses in which the order's CONTENTS may still change — the ONE
 * list, read by `edit` (which refuses outside it, `NOT_EDITABLE`) and by
 * the reseller store's order view (cosmetic, FE-2).
 *
 * Nothing is committed before confirmation: no stock is reserved (ORD-10),
 * no waybill is booked (CUR-2b books it on entry to CONFIRMED), no
 * shipment exists. After it, all three are true, so what is IN the parcel
 * is fixed for BOTH parties. Where it is GOING is a separate question
 * with a separate answer — `recipientChangeRoute`.
 *
 * Named `RECIPIENT_EDITABLE_STATUSES` until 2026-09-18, when the
 * recipient stopped being bounded by it (owner decision 3).
 */
export const CONTENTS_EDITABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
]);

/**
 * The recipient block — WHERE the parcel is going.
 *
 * Named `STORE_EDITABLE_KEYS` until 2026-09-18, when it stopped being
 * the limit of what a store may change (see `STORE_FORBIDDEN_KEYS`) and
 * became what it always described: the ten fields that make up an
 * address. Still the ONE list, read by the edit's revalidation trigger,
 * the held-change columns and every label.
 */
export const RECIPIENT_KEYS = [
  'recipientName',
  'recipientPhoneE164',
  'recipientAltPhoneE164',
  'recipientEmail',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientLandmark',
  'recipientCity',
  'recipientStateProvince',
  'recipientPostalCode',
] as const;

/**
 * What a RESELLER STORE may NOT change on its own order (owner,
 * 2026-09-18) — and it is a DENY list on purpose.
 *
 * The rule the owner gave is "the store may change the order, limited
 * only by what our main system allows, never by an extra restriction
 * because it is the store". An allow list encodes the opposite: every
 * field added to the DTO afterwards is silently closed to the store
 * until somebody remembers to open it, which is exactly the drift this
 * decision was reversing. So the store may reach every key except these
 * two, each closed for a reason about the FIELD rather than about who is
 * asking:
 *
 *   internalNotes — Skydrop's own working notes on the order. Not the
 *                   seller's to read either way, and not a fact about
 *                   the sale.
 *   storeId       — which shopfront the sale is filed under. Moving an
 *                   order to another store would move its money, its
 *                   customer identity (ORD-7) and its terms snapshot to
 *                   a deal that was never struck for it.
 *
 * Everything else a store genuinely cannot do is structural rather than
 * listed: the transfer price and the terms version are not fields on the
 * DTO at all (they are the seller's terms), the retail is checked against
 * the store's own agreed range, and the phone stays the customer's
 * identity (ORD-7).
 */
export const STORE_FORBIDDEN_KEYS = ['internalNotes', 'storeId'] as const;

/** Why each forbidden key is forbidden — said to the store, by name. */
const STORE_FORBIDDEN_REASON: Readonly<Record<(typeof STORE_FORBIDDEN_KEYS)[number], string>> = {
  internalNotes: 'internal notes are Skydrop’s own working notes on the order',
  storeId:
    'which shopfront an order belongs to cannot move — its money, its customer and its terms were all agreed for this one',
};

const ORDER_VIEW_INCLUDE = {
  items: {
    select: {
      id: true,
      variantId: true,
      skuCode: true,
      productName: true,
      variantLabel: true,
      imageUrl: true,
      quantity: true,
      unitWeightGrams: true,
      unitDeclaredValueInr: true,
      unitPriceInr: true,
      qtyReserved: true,
      // RS-5: a reseller line's terms as placed (all null on a channel
      // order). The transfer price is the SELLER's own figure, so both
      // the seller and Skydrop may read it.
      resellerTransferPriceInr: true,
      resellerRetailUnitInr: true,
      resellerMinRetailInr: true,
      resellerMaxRetailInr: true,
      resellerStockMode: true,
    },
  },
} as const;

export type OrderView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>;

/** The staff read of an order: the reseller terms version by NUMBER too. */
export type AdminOrderView = OrderView & { readonly resellerTermsVersionNumber: number | null };

const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  sellerOrderRef: true,
  status: true,
  source: true,
  recipientName: true,
  recipientPhoneE164: true,
  recipientCity: true,
  recipientStateProvince: true,
  // The PIN is the one part of a destination that is always there:
  // city and state are optional and blank on every order placed since
  // the form stopped asking (ORD-5), because Delhivery routes on the
  // PIN and resolves the locality itself. A list that wants to show
  // WHERE an order is going has to show this, or a column of dashes.
  recipientPostalCode: true,
  paymentMode: true,
  codAmountInr: true,
  advanceAmountInr: true,
  deliveryFeeInr: true,
  discountInr: true,
  declaredValueInr: true,
  totalWeightGrams: true,
  isUrgent: true,
  customerId: true,
  placedAt: true,
  createdAt: true,
  // RS-5: which shopfront — a reseller store's orders are listed with
  // its name, and `storeKind` is what the seller-side mask reads.
  storeId: true,
  storeKind: true,
  storeNameSnapshot: true,
} satisfies Prisma.OrderSelect;

export type OrderListItem = Prisma.OrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;

const ORDER_EVENT_SELECT = {
  id: true,
  type: true,
  fromStatus: true,
  toStatus: true,
  description: true,
  data: true,
  actorType: true,
  createdAt: true,
} satisfies Prisma.OrderEventSelect;

export type OrderEventView = Prisma.OrderEventGetPayload<{ select: typeof ORDER_EVENT_SELECT }>;

export interface ListOrdersQuery {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  source?: OrderSource;
  search?: string;
  /** Narrow to ONE shopfront. Omitted means every store. */
  storeId?: string;
  /** ISO instants. Both optional — either end alone is a valid filter. */
  placedFrom?: string;
  placedTo?: string;
}

export interface AdminListOrdersQuery extends ListOrdersQuery {
  /** Cross-seller by default; narrow to one seller when set. */
  sellerId?: string;
}

/** Neutral CSV-patch shape (processor maps CoercedOrderRow → this, so
 *  the order module never depends on the csv-import module). */
export interface BulkOrderPatchInput {
  productSku: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  addressLine1: string;
  /** The landmark. Required — see ORDER_CSV_REQUIRED_FIELDS. */
  addressLine2: string;
  landmark?: string | null;
  /** Optional: Delhivery resolves the locality from the PIN. */
  city?: string;
  state?: string;
  pinCode: string;
  codAmount?: number | null;
}

/** Per-line snapshot resolved from the catalog before the write tx. */
interface ResolvedLine {
  variantId: string;
  skuCode: string;
  productName: string;
  variantLabel: string | null;
  imageUrl: string | null;
  quantity: number;
  unitWeightGrams: number | null;
  unitDeclaredValueInr: Prisma.Decimal | null;
  unitPriceInr: Prisma.Decimal | null;
}

export interface CreateOrderOptions {
  /**
   * Order source. Defaults to MANUAL (this is the manual single-entry
   * path). The recipient-address autocomplete cache is fed for MANUAL
   * only (locked decision #4) so the bulk path doesn't pollute
   * suggestions; kept here as an option so commit 13's CSV path can reuse
   * this snapshot logic without duplicating it.
   */
  source?: OrderSource;
  /**
   * Initial status. Manual entry → DRAFT (default). CSV bulk import →
   * PENDING_CONFIRMATION ("CSV is submission, not drafting" — ORD-9).
   * Only these two are accepted.
   */
  initialStatus?: OrderStatus;
  /** Set on the order when created by a bulk upload. */
  bulkUploadId?: string;
  /**
   * RS-5 — a RESELLER STORE's order. Supplied ONLY by
   * `ResellerOrderService`, after every refusal has run: the order is
   * filed under the store (never resolved through `resolveForOrder`,
   * which refuses a reseller store), its customer is the STORE's, each
   * line carries its terms, and `lockAndReadTerms` runs first inside the
   * create transaction (FOR SHARE on the store row — RS-1's close race).
   */
  reseller?: ResellerCreateContext;
}

/**
 * ORD core write path — manual single-order create.
 *
 * Invariants enforced here:
 *  - **Tx-wrapped** (CLAUDE MUST #8): order number, customer resolution,
 *    order + items, customer aggregate bump, CREATED event, address-cache
 *    upsert and the audit row all commit atomically. The order number is
 *    allocated INSIDE the tx (ORD-8) so number and row are inseparable.
 *  - **Immutable snapshot** (CLAUDE MUST #10 / ORD-6): the recipient block
 *    and every per-line SKU field are copied onto the row at create and
 *    never re-linked. Catalog reads go via CatalogReadService (MUST #13).
 *  - **No reservation at create** (ORD-10 / Q9): stock is untouched; the
 *    order lands in DRAFT. StockReservationService is intentionally NOT a
 *    dependency of this service — reservation is LATE, at confirmation
 *    (Module 7). order_items.qtyReserved stays at its 0 default.
 *  - **Per-seller customer** (ORD-7): resolved/created by
 *    (sellerId, recipientPhoneE164); phone is the immutable identity.
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictions: SellerRestrictionService,
    private readonly numbering: OrderNumberingService,
    private readonly customers: CustomerService,
    private readonly reputation: CustomerReputationService,
    private readonly events: OrderEventWriterService,
    private readonly addressCache: RecipientAddressCacheService,
    private readonly addressValidation: AddressValidationService,
    private readonly catalog: CatalogReadService,
    private readonly audit: AuditLogService,
    private readonly stateMachine: OrderStateMachineService,
    private readonly stores: SellerStoreService,
    private readonly callQueue: CallQueueService,
    private readonly orderCharges: OrderChargesService,
    private readonly earlyReservations: EarlyReservationService,
    private readonly credit: SellerCreditService,
    // 2026-09-17 — seller staff correcting a reseller store's recipient
    // closes the store's waiting correction and emails the store. An R3
    // primitive that imports nothing order-shaped.
    private readonly storeRequests: StoreOrderRequestService,
    private readonly storeRequestNotifier: StoreRequestNotifier,
    // 2026-09-18 (owner) — a changed reseller order keeps its terms and
    // its money follows it. Both imports are one-way: neither module
    // imports the order domain back.
    private readonly resellerReterm: ResellerOrderRetermService,
    private readonly resellerMoney: ResellerOrderMoneyService,
    // 2026-09-19 — re-pricing a changed reseller order is a POST-COMMIT
    // hook shared with god mode, so the two writers of a money-affecting
    // field cannot drift (ORD-2 / `order-post-commit-hooks-shared.spec`).
    private readonly postCommit: OrderPostCommitHooksService,
  ) {}

  /**
   * M15→M6 auto-compute charges. POST-COMMIT, best-effort: a failure
   * is logged + audited but NEVER rolls back the order create. Mirrors
   * the CC-6 enqueueForCall discipline. CHARGES_ALREADY_EXIST (which
   * the system variant catches and turns into `skipped`) is a benign
   * no-op — the admin Compute action already wrote them.
   */
  private async computeChargesAsync(orderId: string): Promise<void> {
    try {
      await this.orderCharges.persistForOrderSystem(orderId);
    } catch (e) {
      this.logger.error(
        { orderId, err: (e as Error).message },
        'Post-commit auto-compute charges failed; order persisted, charges not written',
      );
    }
  }

  /**
   * CC-6 — a freshly-PENDING_CONFIRMATION order joins the call queue.
   * POST-COMMIT + best-effort: enqueueOrder is idempotent (existing
   * OPEN entry → no-op), so a retry / a racing enqueue is safe; a
   * failure here must NOT fail the order write (the order is correctly
   * persisted; an admin re-enqueue / reconciler recovers a missed
   * enqueue). Mirrors the saga's post-commit discipline.
   */
  private async enqueueForCall(orderId: string, ctx: ClientContext): Promise<void> {
    try {
      await this.callQueue.enqueueOrder(orderId, ctx);
    } catch (e) {
      this.logger.error(
        { orderId, err: (e as Error).message },
        'Post-commit call-queue enqueue failed; order persisted, needs re-enqueue',
      );
    }
  }

  /**
   * R5 — at-placement ("virtual") stock booking. POST-COMMIT +
   * best-effort, same discipline as enqueueForCall/computeChargesAsync:
   * the order is already durably persisted, and a seller who has NOT
   * opted in sees no behaviour change at all (the service no-ops on the
   * setting). Marshals the lines as a DTO so `early-reservation` needs no
   * Order dependency (R3 snapshot-DTO discipline).
   */
  private async reserveAtPlacementAsync(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.client.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          sellerId: true,
          items: { select: { id: true, variantId: true, quantity: true } },
        },
      });
      if (!order || order.items.length === 0) return;

      const setting = await this.prisma.client.systemSetting.findUnique({
        where: { key: 'ops.default_warehouse_id' },
        select: { valueString: true },
      });
      const warehouseId = setting?.valueString?.trim();
      if (!warehouseId) return;

      await this.earlyReservations.reserveAtPlacement({
        orderId: order.id,
        sellerId: order.sellerId,
        warehouseId,
        lines: order.items.map((i) => ({
          orderItemId: i.id,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
      });
    } catch (e) {
      this.logger.error(
        { orderId, err: (e as Error).message },
        'At-placement reservation hook failed; order persisted and unaffected',
      );
    }
  }

  async create(
    sellerId: string,
    input: CreateOrderDto,
    actor: EventActor,
    ctx: ClientContext,
    options: CreateOrderOptions = {},
  ): Promise<OrderView> {
    // WHICH SHOPFRONT. Resolved before the transaction opens, so a
    // store belonging to another seller — or one somebody closed — is
    // refused before an order number is burned. Given none, the
    // seller's default; the CSV importer reaches this same line, which
    // is why a row that names no store still lands somewhere.
    //
    // RS-5: a reseller store's order names its store in `reseller`, set
    // only by ResellerOrderService — `resolveForOrder` refuses a reseller
    // store by design (STORE_IS_RESELLER), so the seller's own form can
    // never file an order under one.
    const reseller = options.reseller ?? null;
    if (reseller !== null && reseller.lines.length !== input.items.length) {
      throw new BadRequestException({
        code: 'RESELLER_LINES_MISMATCH',
        message: 'Every line of a reseller order needs its terms',
      });
    }
    const store =
      reseller === null
        ? await this.stores.resolveForOrder(sellerId, input.storeId)
        : { id: reseller.storeId, name: reseller.storeName };
    // A seller on hold cannot start new work. Checked here rather than
    // in the controller so the CSV importer — which reaches this same
    // method with no screen in front of it — is covered by the same
    // line.
    await this.restrictions.assertAllowed(sellerId, SellerCapability.ORDER_CREATE);
    // And a seller too deep in the red cannot start new work either.
    // Checked at CREATE on purpose: it is the last point where nothing
    // has been committed. At confirmation an agent would find out with
    // the customer on the line; at dispatch the goods are already
    // picked. Sits beside the restriction check so the CSV importer,
    // which reaches this method with no screen in front of it, is
    // covered by the same line.
    await this.credit.assertCanPlaceOrder(sellerId);

    const source = options.source ?? OrderSource.MANUAL;
    const initialStatus = options.initialStatus ?? OrderStatus.DRAFT;
    if (initialStatus !== OrderStatus.DRAFT && initialStatus !== OrderStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException({
        code: 'INVALID_INITIAL_STATUS',
        message: 'initialStatus must be DRAFT or PENDING_CONFIRMATION',
      });
    }
    const now = new Date();

    // ── Pre-tx validation (no writes; fail fast before allocating a
    //    number / touching the customer row). ────────────────────────────
    const canonicalState = await this.addressValidation.assertValid({
      recipientPhoneE164: input.recipientPhoneE164,
      recipientAltPhoneE164: input.recipientAltPhoneE164 ?? null,
      recipientPostalCode: input.recipientPostalCode,
      recipientStateProvince: input.recipientStateProvince ?? '',
      recipientCountryCode: input.recipientCountryCode ?? 'IN',
    });

    this.assertPayment(input);
    const lines = await this.resolveLines(sellerId, input.items);
    await this.assertNotDuplicate(sellerId, input, lines, reseller?.storeId ?? null);

    const declaredValueInr =
      input.declaredValueInr !== undefined
        ? new Prisma.Decimal(input.declaredValueInr)
        : lines.reduce(
            (sum, l) => sum.add((l.unitDeclaredValueInr ?? new Prisma.Decimal(0)).mul(l.quantity)),
            new Prisma.Decimal(0),
          );

    const totalWeightGrams =
      input.totalWeightGrams !== undefined
        ? input.totalWeightGrams
        : lines.every((l) => l.unitWeightGrams !== null)
          ? lines.reduce((sum, l) => sum + (l.unitWeightGrams ?? 0) * l.quantity, 0)
          : null;

    let created;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        // RS-5 FIRST: lock the reseller store row FOR SHARE and re-check
        // it is still ACTIVE — before a number is allocated, so a store
        // closed or paused a moment ago burns none. A close takes the row
        // for UPDATE, so the two cannot interleave: whichever commits
        // first, the other sees it (RS-1).
        const resellerTerms = reseller === null ? null : await reseller.lockAndReadTerms(tx);
        const orderNumber = await this.numbering.nextOrderNumber(tx, now);

        // The stored recipient name carries the seller's code. Composed
        // HERE rather than in the form so every entry path gets it —
        // CSV import calls this same method, and an order placed by API
        // would otherwise be the one parcel on the bench with no code.
        //
        // EXCEPT a reseller store's order (RS-10, decision 4): the stored
        // name is what the courier prints on the label, and the customer
        // must see the STORE, never a code naming the seller behind it.
        const seller = await tx.seller.findUnique({
          where: { id: sellerId },
          select: { initials: true },
        });
        const prefixedRecipientName =
          reseller === null
            ? composeSellerPrefixedName(seller?.initials, input.recipientName)
            : input.recipientName.trim();

        const customer = await this.customers.findOrCreate(tx, {
          sellerId,
          // RS-5 (ORD-7 generalised): a reseller order's customer is the
          // STORE's, a separate identity from the seller's own customer
          // with the same phone.
          resellerStoreId: reseller?.storeId ?? null,
          phoneE164: input.recipientPhoneE164.trim(),
          // The CUSTOMER record stays clean — it is a person, and the
          // same person may buy from two sellers.
          name: stripSellerPrefix(seller?.initials, input.customerName ?? input.recipientName),
          email: input.customerEmail ?? input.recipientEmail ?? null,
          altPhoneE164: input.recipientAltPhoneE164 ?? null,
          preferredLanguage: input.preferredLanguage ?? 'en',
        });

        const order = await tx.order.create({
          data: {
            orderNumber,
            sellerId,
            customerId: customer.id,
            storeId: store.id,
            // RS-5: the composite FK makes this the store's own kind; the
            // CHECK then demands the whole snapshot on a reseller order.
            storeKind: reseller === null ? SellerStoreKind.CHANNEL : SellerStoreKind.RESELLER,
            ...(resellerTerms === null ? {} : resellerOrderColumns(resellerTerms)),
            // ORD-6: the NAME as it was. Renaming the store later must
            // not rewrite what a past customer was told, and the live
            // row cannot answer what it used to be called.
            storeNameSnapshot: store.name,
            sellerOrderRef: input.sellerOrderRef ?? null,
            source,
            status: initialStatus,
            bulkUploadId: options.bulkUploadId ?? null,
            recipientName: prefixedRecipientName,
            recipientPhoneE164: input.recipientPhoneE164.trim(),
            recipientAltPhoneE164: input.recipientAltPhoneE164 ?? null,
            // Recorded, not just honoured — see the column comment.
            duplicateAcknowledgedAt: input.acknowledgeDuplicate === true ? new Date() : null,
            recipientEmail: input.recipientEmail ?? null,
            recipientAddressLine1: input.recipientAddressLine1,
            recipientAddressLine2: input.recipientAddressLine2 ?? null,
            recipientLandmark: input.recipientLandmark ?? null,
            recipientCity: input.recipientCity ?? '',
            recipientStateProvince: canonicalState,
            recipientPostalCode: input.recipientPostalCode.trim(),
            recipientCountryCode: (input.recipientCountryCode ?? 'IN').toUpperCase(),
            paymentMode: input.paymentMode,
            codAmountInr:
              input.paymentMode === PaymentMode.COD && input.codAmountInr !== undefined
                ? new Prisma.Decimal(input.codAmountInr)
                : null,
            // The three figures the collectable was built from. Kept
            // whatever the payment mode: a prepaid order still has an
            // advance and a delivery fee worth being able to read back.
            advanceAmountInr:
              input.advanceAmountInr === undefined
                ? null
                : new Prisma.Decimal(input.advanceAmountInr),
            deliveryFeeInr:
              input.deliveryFeeInr === undefined ? null : new Prisma.Decimal(input.deliveryFeeInr),
            discountInr:
              input.discountInr === undefined ? null : new Prisma.Decimal(input.discountInr),
            declaredValueInr,
            totalWeightGrams,
            packageType: input.packageType ?? null,
            isUrgent: input.isUrgent ?? false,
            sellerNotes: input.sellerNotes ?? null,
            internalNotes: input.internalNotes ?? null,
            placedAt: now,
            items: {
              create: lines.map((l, i) => {
                // RS-5: the line's terms as placed. Retail is ALSO the
                // unit price, so every reader that already shows one is
                // right without knowing about stores.
                const terms = reseller?.lines[i];
                return {
                  variantId: l.variantId,
                  skuCode: l.skuCode,
                  productName: l.productName,
                  variantLabel: l.variantLabel,
                  imageUrl: l.imageUrl,
                  quantity: l.quantity,
                  unitWeightGrams: l.unitWeightGrams,
                  unitDeclaredValueInr: l.unitDeclaredValueInr,
                  unitPriceInr: terms?.retailUnitInr ?? l.unitPriceInr,
                  ...(terms === undefined
                    ? {}
                    : {
                        resellerTransferPriceInr: terms.transferPriceInr,
                        resellerRetailUnitInr: terms.retailUnitInr,
                        resellerMinRetailInr: terms.minRetailInr,
                        resellerMaxRetailInr: terms.maxRetailInr,
                        resellerStockMode: terms.stockMode,
                      }),
                };
              }),
            },
          },
          include: ORDER_VIEW_INCLUDE,
        });

        await this.customers.recordNewOrder(tx, customer.id, now);

        await this.events.created(
          tx,
          order.id,
          actor,
          { orderNumber, source, itemCount: lines.length },
          initialStatus,
        );

        // Locked decision #4: feed the autocomplete cache for MANUAL
        // entry only (bulk imports must not pollute suggestions). RS-5:
        // never for a reseller order — the cache is read on the SELLER's
        // form, and a store customer's address is not the seller's to see.
        if (source === OrderSource.MANUAL && reseller === null) {
          await this.addressCache.recordAddress(
            tx,
            customer.id,
            {
              line1: input.recipientAddressLine1,
              line2: input.recipientAddressLine2 ?? null,
              landmark: input.recipientLandmark ?? null,
              city: input.recipientCity ?? '',
              stateProvince: canonicalState,
              postalCode: input.recipientPostalCode.trim(),
            },
            now,
          );
        }

        await this.audit.log(
          {
            actorType: actor.type,
            actorId: actor.id ?? null,
            sellerId,
            action: 'order.created',
            entityType: 'order',
            entityId: order.id,
            metadata: {
              orderNumber,
              source,
              itemCount: lines.length,
              customerId: customer.id,
              ...(reseller === null
                ? {}
                : {
                    resellerStoreId: reseller.storeId,
                    resellerTermsVersionId: resellerTerms?.termsVersionId ?? null,
                  }),
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              requestId: ctx.requestId,
            },
          },
          tx,
        );

        return order;
      });
    } catch (e) {
      // (sellerId, storeId, sellerOrderRef) is @@unique — surface a
      // clean 409. Per STORE since 2026-09-07: two shopfronts each
      // running their own Shopify both emit `#1001`, and the old
      // seller-wide key made the second silently PATCH the first.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_SELLER_ORDER_REF',
          message: `An order with sellerOrderRef "${input.sellerOrderRef}" already exists for this seller`,
        });
      }
      throw e;
    }

    // CC-6: created straight into PENDING_CONFIRMATION (CSV submission
    // path / manual submit-on-create) → join the call queue post-commit.
    if (initialStatus === OrderStatus.PENDING_CONFIRMATION) {
      await this.enqueueForCall(created.id, ctx);
      // R5: stage 1 of two-stage booking (no-op unless the seller opted in).
      // RS-5: never for a reseller order — an at-placement hold would
      // take stock outside the confirm-time set-aside rule.
      if (reseller === null) await this.reserveAtPlacementAsync(created.id);
    }
    // M15→M6: auto-compute order charges post-commit (best-effort).
    await this.computeChargesAsync(created.id);

    return created;
  }

  // ── helpers ────────────────────────────────────────────────────────

  /**
   * Refuse a second unpacked order to the same customer unless the
   * seller says they meant it.
   *
   * The common case this catches is a double submit — the same order
   * entered twice, which becomes two parcels, two delivery fees and a
   * confused customer. The seller can always proceed; they just have to
   * say so, and that acknowledgement is recorded on the order so a
   * later dispute has an answer.
   *
   * Scoped to THIS seller by construction: the lookup filters on
   * sellerId, so seller A's pending order can never warn seller B about
   * a customer they happen to share. That is not a rule enforced
   * somewhere — it is that B's query does not see A's rows.
   *
   * Once a parcel is PACKED the warning stops: the box is physically
   * made up, the two orders can no longer be consolidated, and a
   * warning about it is noise the seller will learn to click through.
   */
  private async assertNotDuplicate(
    sellerId: string,
    input: CreateOrderDto,
    lines: ReadonlyArray<{ variantId: string }>,
    /** RS-5: a reseller store's order is checked against that store's orders only. */
    resellerStoreId: string | null,
  ): Promise<void> {
    if (input.acknowledgeDuplicate === true) return;

    const open = await this.reputation.findOpenOrdersForPhone(
      sellerId,
      input.recipientPhoneE164,
      lines.map((l) => l.variantId),
      resellerStoreId === null ? { kind: 'SELLER' } : { kind: 'STORE', storeId: resellerStoreId },
    );
    if (open.length === 0) return;

    throw new ConflictException({
      code: 'DUPLICATE_ORDER_SUSPECTED',
      message:
        `This customer already has ${open.length} order(s) not yet packed. ` +
        `Re-submit with acknowledgeDuplicate to place it anyway.`,
      // `details` specifically — the global exception filter passes that
      // key through and drops anything else, so a bespoke field name
      // would vanish between the throw and the response.
      //
      // The seller needs to SEE what they would be duplicating, not just
      // be told a number: the decision is "is this the same order?", and
      // a count cannot answer it.
      details: { existingOrders: open },
    });
  }

  private assertPayment(input: CreateOrderDto): void {
    if (input.paymentMode === PaymentMode.COD) {
      if (input.codAmountInr === undefined || input.codAmountInr <= 0) {
        throw new BadRequestException({
          code: 'COD_AMOUNT_REQUIRED',
          message: 'codAmountInr (> 0) is required when paymentMode = COD',
        });
      }
    } else if (input.codAmountInr !== undefined) {
      throw new BadRequestException({
        code: 'COD_AMOUNT_NOT_ALLOWED',
        message: 'codAmountInr must be absent for PREPAID orders',
      });
    }
  }

  /**
   * Resolve every line through the sanctioned catalog read boundary
   * (CLAUDE MUST #13). Validates seller ownership and the ARCHIVED block
   * (catalog rule #8 — ARCHIVED variants cannot enter new orders).
   * OUT_OF_STOCK *variant status* is allowed: reservation is LATE so a
   * draft for currently-unstocked SKUs is valid; it simply won't confirm
   * until stock exists.
   */
  private async resolveLines(
    sellerId: string,
    items: CreateOrderDto['items'],
  ): Promise<ResolvedLine[]> {
    const ids = [...new Set(items.map((i) => i.variantId))];
    const resolved = await this.catalog.getVariantsByIds(ids);

    return items.map((item) => {
      const v = resolved.get(item.variantId);
      if (!v || v.sellerId !== sellerId) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant ${item.variantId} not found for this seller`,
        });
      }
      if (v.status === VariantStatus.ARCHIVED) {
        throw new BadRequestException({
          code: 'VARIANT_ARCHIVED',
          message: `Variant ${item.variantId} is archived and cannot be ordered`,
        });
      }
      return {
        variantId: v.variantId,
        skuCode: v.skuCode,
        productName: v.productName,
        variantLabel: v.variantLabel,
        imageUrl: v.imageUrl,
        quantity: item.quantity,
        unitWeightGrams: v.weightGrams,
        unitDeclaredValueInr: v.declaredValueInr,
        unitPriceInr:
          item.unitPriceInr !== undefined ? new Prisma.Decimal(item.unitPriceInr) : null,
      };
    });
  }

  // ── submit / edit / cancel (state-dependent, ORD-1/ORD-6) ───────────

  /** DRAFT → PENDING_CONFIRMATION. No stock side-effect (reservation is
   *  LATE, ORD-10). State machine is the source of truth. */
  async submit(
    sellerId: string,
    id: string,
    actor: EventActor,
    ctx: ClientContext,
  ): Promise<OrderView> {
    const order = await this.loadOwned(sellerId, id);
    if (order.status !== OrderStatus.DRAFT) {
      throw new ConflictException({
        code: 'NOT_SUBMITTABLE',
        message: `Only DRAFT orders can be submitted (order is ${order.status})`,
      });
    }
    // Defensive: the machine must agree (and declare no side-effects).
    if (!this.stateMachine.isValidTransition(order.status, OrderStatus.PENDING_CONFIRMATION)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `${order.status} → PENDING_CONFIRMATION is not a valid transition`,
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id },
        data: { status: OrderStatus.PENDING_CONFIRMATION },
        include: ORDER_VIEW_INCLUDE,
      });
      await this.events.statusChanged(tx, {
        orderId: id,
        from: OrderStatus.DRAFT,
        to: OrderStatus.PENDING_CONFIRMATION,
        actor,
        description: 'Order submitted for call confirmation',
      });
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          sellerId,
          action: 'order.submitted',
          entityType: 'order',
          entityId: id,
          metadata: { orderNumber: order.orderNumber, ...this.ctxMeta(ctx) },
        },
        tx,
      );
      return row;
    });

    // CC-6: DRAFT → PENDING_CONFIRMATION → join the call queue
    // (post-commit, idempotent, best-effort).
    await this.enqueueForCall(id, ctx);
    // R5: a DRAFT only becomes a real order at submit, so this is the
    // other at-placement entry point (no-op unless the seller opted in).
    await this.reserveAtPlacementAsync(id);
    return updated;
  }

  /**
   * State-dependent edit (ORD-6). DRAFT = fully editable (incl. a full
   * line-set replace re-snapshotted from the catalog). PENDING_CONFIRMATION
   * = recipient/customer corrections + notes only. Any other status → 409
   * (god-mode is a separate, non-Checkpoint-2 path). PATCH semantics:
   * only provided keys change.
   */
  async edit(
    sellerId: string,
    id: string,
    input: UpdateOrderDto,
    actor: EventActor,
    ctx: ClientContext,
    /**
     * 2026-09-16 — set when a RESELLER STORE is changing its OWN order,
     * never by a seller path.
     *
     * The store gets in here rather than a parallel edit method so it
     * inherits the whole of this one: the stage gate, the courier route,
     * address revalidation, the canonical state casing, the line
     * re-terming, the money recalculation and the notice to the other
     * side. A second implementation would drift from all of that, and the
     * one that drifted would be the one nobody was testing.
     */
    storeScope?: { readonly storeId: string },
  ): Promise<OrderView> {
    const order = await this.loadOwned(sellerId, id);

    /*
      BOTH SIDES MAY CHANGE A RESELLER STORE'S ORDER (owner, 2026-09-18).

      RS-5 refused a seller edit outright ("only the store can change
      it"), and 2026-09-17 opened the recipient. The owner has now
      overruled the rest, in both directions:

        - SELLER STAFF own the goods, the warehouse slot, the courier and
          the money at risk, so they may change anything on the order.
        - The RESELLER STORE sold it, holds the customer, and is limited
          ONLY by what the system genuinely cannot allow — never by an
          extra restriction because it is the store (STORE_FORBIDDEN_KEYS
          says which two fields and why).

      What did NOT move is the set of REAL constraints, and they bind the
      two identically: the lifecycle stage below; the courier's word on a
      post-handover address (`recipientChangeRoute`); a line with no
      transfer price under the store's catalogue; the phone as the
      customer's identity (ORD-7); and money only through
      `ResellerOrderMoneyService`.

      ORD-6 is deliberately narrowed by this: the order's snapshot is
      immutable against the CATALOGUE and the store's live terms — a later
      price-list change never re-prices a placed order — but it is not
      immutable against the two parties to the sale agreeing to change it.
      Every change writes an order event and tells the other side.
    */
    const isReseller = order.storeKind === SellerStoreKind.RESELLER;
    const sellerEditingResellerOrder = isReseller && storeScope === undefined;
    if (isReseller) {
      if (storeScope !== undefined && order.storeId !== storeScope.storeId) {
        // Another store's order. A store may not reach it, and saying so
        // in any more detail would confirm it exists.
        throw new NotFoundException(`Order ${id} not found`);
      }
    } else if (storeScope !== undefined) {
      // A store reaching for a channel order — the seller's own. Same
      // 404-shaped refusal as everywhere else on the store surface.
      throw new NotFoundException(`Order ${id} not found`);
    }

    if (storeScope !== undefined) {
      const forbidden = (Object.keys(input) as Array<keyof UpdateOrderDto>).filter(
        (k) =>
          input[k] !== undefined &&
          (STORE_FORBIDDEN_KEYS as readonly string[]).includes(k as string),
      );
      if (forbidden.length > 0) {
        throw new ForbiddenException({
          code: 'STORE_EDIT_FIELD_NOT_YOURS',
          message: `A store cannot change ${forbidden
            .map((k) => STORE_FORBIDDEN_REASON[k as (typeof STORE_FORBIDDEN_KEYS)[number]])
            .join('; ')}. Remove: ${forbidden.join(', ')}.`,
        });
      }
    }

    // BEFORE anything is written: an edit the money could not follow is
    // refused by name rather than committed and then discovered. Today
    // that is exactly one case — changing how a priced order is paid for.
    if (isReseller) {
      await this.resellerMoney.assertEditKeepsMoneyCorrectable(id, {
        paymentMode: input.paymentMode,
      });
    }

    const isPending = order.status === OrderStatus.PENDING_CONFIRMATION;
    const touchesOnlyRecipient = (Object.keys(input) as Array<keyof UpdateOrderDto>).every(
      (k) => input[k] === undefined || (RECIPIENT_KEYS as readonly string[]).includes(k as string),
    );
    if (!CONTENTS_EDITABLE_STATUSES.has(order.status)) {
      /*
        PAST THE POINT THE CONTENTS MAY CHANGE (owner decision 3).

        Once the order is confirmed, stock is reserved, a waybill is
        booked and the parcel may already be packed — so what is IN it
        cannot change here, for either party. That is a real system limit
        rather than a rule about who is asking, and it binds seller staff
        and the store identically.

        The RECIPIENT still may change, and `recipientChangeRoute` — the
        ONE place — says how. DIRECT means no waybill exists yet, so
        nobody outside holds the address and we write it. COURIER means
        they do, and the owner's rule is absolute: ask them, and store it
        only if they accept. This refusal names the endpoint that asks.
      */
      if (!touchesOnlyRecipient) {
        throw new ConflictException({
          code: 'NOT_EDITABLE',
          message:
            `An order in ${order.status} cannot have its contents changed — its stock is held, its ` +
            'waybill is booked and it may already be packed. The customer’s details can still be corrected.',
        });
      }
      const route = recipientChangeRoute({
        orderStatus: order.status,
        isTerminal: this.stateMachine.isTerminal(order.status),
        liveShipment: await this.liveShipmentForRoute(id),
      });
      if (route.kind === 'REFUSED') {
        throw new ConflictException({ code: 'NOT_EDITABLE', message: route.reason });
      }
      if (route.kind === 'COURIER') {
        throw new ConflictException({
          code: 'COURIER_MUST_ACCEPT_ADDRESS_CHANGE',
          message:
            'The courier already has this parcel’s address, so only they can change it. Send the ' +
            'correction to them instead — the name, phone and street address can still be ' +
            'corrected, and it is only stored if they accept it. ' +
            route.reason,
          details: {
            endpoint: `${storeScope === undefined ? 'seller' : 'store'}/orders/${id}/consignee`,
            courierWillAccept: route.courierWillAccept,
          },
        });
      }
      // DIRECT: no waybill anywhere, so this is ours to write.
    }

    /*
      THE WHOLE ORDER IS EDITABLE UNTIL THE CALL CONFIRMS IT (2026-09-09).

      This used to accept only recipient corrections and notes once the
      order reached PENDING_CONFIRMATION — items and the six economic
      fields were refused as EDIT_SCOPE_PENDING. That was stricter than
      the business needs: nothing is committed before confirmation. No
      stock is reserved (ORD-10 — reservation is LATE, at CONFIRMED), no
      waybill is booked (CUR-2b books it on entry to CONFIRMED), no
      shipment exists (provisioned on the same edge), and under FLAT
      pricing the persisted `order_charges` do not depend on weight, COD
      or contents at all — the fee is per seller, and GST is a percent of
      the fee. So an edit here rewrites a row and nothing else.

      AND IT IS EDITABLE DURING THE CALL TOO (owner decision 4,
      2026-09-18). `EDIT_DURING_CALL` used to refuse any change to the
      contents or the amount while an agent held the order, because the
      agent is reading both to the customer and a change underneath them
      means the customer agrees to one order and we ship another.

      That risk is real, and the answer to it is not a refusal — it is
      that the agent MUST BE LOOKING AT THE ORDER AS IT IS NOW. A refusal
      protected an agent who was, in fact, reading a snapshot taken when
      they pulled the call: the station copied the pulled assignment into
      its own state and never looked again, so the address an agent read
      out could already be stale for reasons this guard never covered (a
      second agent, an admin, a god-mode edit, a CSV patch). The guard
      bought nothing against the real hazard and cost a seller — and now a
      store — the ability to fix a wrong number while somebody has the
      customer on the line, which is exactly when they find out.

      So: every change writes a visible order event (below), and the call
      station re-reads its held call and tells the agent, on screen, that
      the order changed mid-call. `callQueue.activeAssignment` is still
      read — not to refuse, but to record on the event that somebody was
      on the phone when it happened, which is what makes a later "the
      customer agreed to something else" answerable.
    */
    const activeCall = isPending ? await this.callQueue.activeAssignment(id) : null;

    const data: Prisma.OrderUpdateInput = {};
    const changed: string[] = [];

    // ── Recipient block (+ revalidation when any recipient field set) ──
    // The ONE list (`RECIPIENT_KEYS`), not a second copy of it: this used
    // to restate all ten, which is how one of the two comes to be missing
    // a field and the revalidation silently stops firing for it.
    const touchedRecipient = RECIPIENT_KEYS.some((k) => input[k] !== undefined);

    if (touchedRecipient) {
      const merged = {
        recipientPhoneE164: input.recipientPhoneE164?.trim() ?? order.recipientPhoneE164,
        recipientAltPhoneE164: input.recipientAltPhoneE164 ?? order.recipientAltPhoneE164,
        recipientPostalCode: input.recipientPostalCode?.trim() ?? order.recipientPostalCode,
        recipientStateProvince: input.recipientStateProvince ?? order.recipientStateProvince,
        recipientCountryCode: order.recipientCountryCode,
      };
      const canonicalState = await this.addressValidation.assertValid(merged);

      if (input.recipientName !== undefined) {
        // Idempotent: the seller's edit form round-trips the stored
        // value, so this must not stack a second prefix.
        const seller = await this.prisma.client.seller.findUnique({
          where: { id: sellerId },
          select: { initials: true },
        });
        // RS-10: a reseller order's consignee carries NO seller-initials
        // prefix — it is printed on the courier label, and a code naming
        // the seller would reach the store's customer. So a store
        // correcting the name writes it through unchanged; prefixing here
        // would corrupt the very field it came to fix.
        data.recipientName =
          order.storeKind === SellerStoreKind.RESELLER
            ? input.recipientName
            : composeSellerPrefixedName(seller?.initials, input.recipientName);
      }
      if (input.recipientPhoneE164 !== undefined) {
        data.recipientPhoneE164 = input.recipientPhoneE164.trim();
      }
      if (input.recipientAltPhoneE164 !== undefined) {
        data.recipientAltPhoneE164 = input.recipientAltPhoneE164;
      }
      if (input.recipientEmail !== undefined) data.recipientEmail = input.recipientEmail;
      if (input.recipientAddressLine1 !== undefined) {
        data.recipientAddressLine1 = input.recipientAddressLine1;
      }
      if (input.recipientAddressLine2 !== undefined) {
        data.recipientAddressLine2 = input.recipientAddressLine2;
      }
      if (input.recipientLandmark !== undefined) {
        data.recipientLandmark = input.recipientLandmark;
      }
      if (input.recipientCity !== undefined) data.recipientCity = input.recipientCity;
      if (input.recipientPostalCode !== undefined) {
        data.recipientPostalCode = input.recipientPostalCode.trim();
      }
      // Always persist the canonical state casing when recipient touched.
      data.recipientStateProvince = canonicalState;
      changed.push('recipient');
    }

    // ── Notes (both states) ─────────────────────────────────────────────
    if (input.sellerNotes !== undefined) {
      data.sellerNotes = input.sellerNotes;
      changed.push('sellerNotes');
    }
    if (input.internalNotes !== undefined) {
      data.internalNotes = input.internalNotes;
      changed.push('internalNotes');
    }

    // ── Economics / physical (until the call confirms it) ──────────────
    // `isDraft` was the gate here too, which is the other half of the
    // old restriction: the guard above refused the request and this
    // block would have silently ignored the fields anyway. Both open
    // now — a PENDING order is not committed to anything (see the note
    // at the top of this method).
    let effectivePaymentMode = order.paymentMode;
    {
      if (input.paymentMode !== undefined) {
        data.paymentMode = input.paymentMode;
        effectivePaymentMode = input.paymentMode;
        changed.push('paymentMode');
      }
      if (input.declaredValueInr !== undefined) {
        data.declaredValueInr = new Prisma.Decimal(input.declaredValueInr);
        changed.push('declaredValueInr');
      }
      if (input.totalWeightGrams !== undefined) {
        data.totalWeightGrams = input.totalWeightGrams;
        changed.push('totalWeightGrams');
      }
      if (input.packageType !== undefined) {
        data.packageType = input.packageType;
        changed.push('packageType');
      }
      if (input.isUrgent !== undefined) {
        data.isUrgent = input.isUrgent;
        changed.push('isUrgent');
      }
      // COD/PREPAID consistency on the *resulting* state.
      const effectiveCod =
        input.codAmountInr !== undefined
          ? input.codAmountInr
          : order.codAmountInr === null
            ? null
            : Number(order.codAmountInr);
      if (effectivePaymentMode === PaymentMode.COD) {
        if (effectiveCod === null || effectiveCod <= 0) {
          throw new BadRequestException({
            code: 'COD_AMOUNT_REQUIRED',
            message: 'codAmountInr (> 0) is required for a COD order',
          });
        }
        if (input.codAmountInr !== undefined) {
          data.codAmountInr = new Prisma.Decimal(input.codAmountInr);
          changed.push('codAmountInr');
        }
      } else {
        if (input.codAmountInr !== undefined && input.codAmountInr > 0) {
          throw new BadRequestException({
            code: 'COD_AMOUNT_NOT_ALLOWED',
            message: 'codAmountInr must be absent for PREPAID orders',
          });
        }
        // Switching to PREPAID clears any prior COD amount.
        if (order.codAmountInr !== null || input.paymentMode === PaymentMode.PREPAID) {
          data.codAmountInr = null;
        }
      }
    }

    // ── The rest of the money, the reference and the shopfront ────────
    if (input.advanceAmountInr !== undefined) {
      data.advanceAmountInr = new Prisma.Decimal(input.advanceAmountInr);
      changed.push('advanceAmountInr');
    }
    if (input.deliveryFeeInr !== undefined) {
      data.deliveryFeeInr = new Prisma.Decimal(input.deliveryFeeInr);
      changed.push('deliveryFeeInr');
    }
    if (input.discountInr !== undefined) {
      data.discountInr = new Prisma.Decimal(input.discountInr);
      changed.push('discountInr');
    }
    if (input.sellerOrderRef !== undefined) {
      const ref = input.sellerOrderRef.trim();
      // Empty means "no reference", not the empty string: the UNIQUE is
      // on (seller, store, ref) and Postgres treats every NULL as
      // distinct, so blanking two orders is fine while storing '' twice
      // is a collision.
      data.sellerOrderRef = ref === '' ? null : ref;
      changed.push('sellerOrderRef');
    }
    if (input.storeId !== undefined) {
      // Through the resolver, so a store belonging to another seller is
      // a 404 and an inactive one is refused by name — the same answers
      // create gives.
      const store = await this.stores.resolveForOrder(sellerId, input.storeId);
      data.store = { connect: { id: store.id } };
      changed.push('storeId');
    }

    // ── Lines: full replace (until the call confirms it) ───────────────
    let replacementLines: Awaited<ReturnType<OrderService['resolveLines']>> | null = null;
    // RS-4/RS-5: one per replacement line, in the SAME order. Null on a
    // channel order — it has no reseller terms and its item columns stay
    // null by CHECK.
    let replacementTerms: readonly ResellerLineTerms[] | null = null;
    if (input.items !== undefined) {
      replacementLines = await this.resolveLines(sellerId, input.items);
      if (isReseller && order.storeId !== null) {
        // The order's OWN terms (ORD-6/RS-4): a kept line keeps its
        // snapshot, a new one is priced from the store's catalogue, and a
        // product with no transfer price there is refused by name rather
        // than given one nobody agreed. Never the store's live terms
        // VERSION — that stays exactly as placed.
        replacementTerms = await this.resellerReterm.retermLines({
          orderId: id,
          storeId: order.storeId,
          sellerId,
          items: input.items,
        });
      }
      if (input.declaredValueInr === undefined) {
        data.declaredValueInr = replacementLines.reduce(
          (sum, l) => sum.add((l.unitDeclaredValueInr ?? new Prisma.Decimal(0)).mul(l.quantity)),
          new Prisma.Decimal(0),
        );
      }
      if (input.totalWeightGrams === undefined) {
        data.totalWeightGrams = replacementLines.every((l) => l.unitWeightGrams !== null)
          ? replacementLines.reduce((s, l) => s + (l.unitWeightGrams ?? 0) * l.quantity, 0)
          : null;
      }
      changed.push('items');
    }

    // Re-resolve the per-seller customer when the phone is corrected
    // (ORD-7: a new phone is a different customer identity).
    const newPhone = input.recipientPhoneE164?.trim();
    const phoneChanged = newPhone !== undefined && newPhone !== order.recipientPhoneE164;

    if (changed.length === 0) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'No editable fields were supplied',
      });
    }

    let supersededAddressChanges = 0;
    try {
      const saved = await this.prisma.client.$transaction(async (tx) => {
        if (phoneChanged && newPhone !== undefined) {
          const customer = await this.customers.findOrCreate(tx, {
            sellerId,
            // ORD-7 amended (RS-5): a reseller order's customer is the
            // STORE's identity, never the seller's own.
            ...(order.storeKind === SellerStoreKind.RESELLER && order.storeId !== null
              ? { resellerStoreId: order.storeId }
              : {}),
            phoneE164: newPhone,
            name: input.recipientName ?? order.recipientName,
            email: input.recipientEmail ?? order.recipientEmail,
            altPhoneE164: input.recipientAltPhoneE164 ?? order.recipientAltPhoneE164,
          });
          data.customer = { connect: { id: customer.id } };
        }

        if (replacementLines !== null) {
          await tx.orderItem.deleteMany({ where: { orderId: id } });
          data.items = {
            create: replacementLines.map((l, i) => {
              // A reseller line carries all five terms or none — the
              // table's CHECK says so, and the money reads them.
              const terms = replacementTerms?.[i];
              return {
                variantId: l.variantId,
                skuCode: l.skuCode,
                productName: l.productName,
                variantLabel: l.variantLabel,
                imageUrl: l.imageUrl,
                quantity: l.quantity,
                unitWeightGrams: l.unitWeightGrams,
                unitDeclaredValueInr: l.unitDeclaredValueInr,
                // On a reseller order the RETAIL is the unit price — the
                // same mapping `toCreateOrderDto` makes at create, so a
                // line edited later reads identically to one placed.
                unitPriceInr: terms?.retailUnitInr ?? l.unitPriceInr,
                ...(terms === undefined
                  ? {}
                  : {
                      resellerTransferPriceInr: terms.transferPriceInr,
                      resellerRetailUnitInr: terms.retailUnitInr,
                      resellerMinRetailInr: terms.minRetailInr,
                      resellerMaxRetailInr: terms.maxRetailInr,
                      resellerStockMode: terms.stockMode,
                    }),
              };
            }),
          };
        }

        const updated = await tx.order.update({
          where: { id },
          data,
          include: ORDER_VIEW_INCLUDE,
        });
        if (isReseller) {
          /*
            A change the store had waiting on seller staff cannot stand
            beside this one — closed as SUPERSEDED in the same tx.

            For EITHER party (2026-09-18). It was seller-only, which left a
            hole: a seller who switches the store's policy from "ask me
            first" to "directly" while a request is open leaves the store
            able to change the order AND a stale proposal sitting in the
            seller's queue, which approving would apply on top. Only
            PENDING rows move, so an approval already in flight (APPROVED)
            is untouched and finishes normally.

            `decidedBySellerUserId` is a SELLER-user column, so a store's
            edit passes null rather than stamping a store user id into it:
            "who decided this" must never read as somebody it was not.
          */
          supersededAddressChanges = await this.storeRequests.supersedeAddressChanges(
            tx,
            id,
            storeScope === undefined ? (actor.id ?? null) : null,
          );
        }
        await this.events.note(
          tx,
          id,
          `Order edited (${changed.join(', ')})${phoneChanged ? '; customer re-linked' : ''}` +
            // Whoever picks this order up later — the agent, the seller,
            // Skydrop — has to be able to see that the order moved while
            // somebody had the customer on the phone. It is no longer
            // refused (owner decision 4), so the record is the safeguard.
            (activeCall === null ? '' : ' — WHILE AN AGENT WAS ON THE CALL'),
          actor,
          true,
        );
        await this.audit.log(
          {
            actorType: actor.type,
            actorId: actor.id ?? null,
            sellerId,
            action: 'order.edited',
            entityType: 'order',
            entityId: id,
            metadata: {
              orderNumber: order.orderNumber,
              status: order.status,
              changed,
              phoneChanged,
              duringCall: activeCall !== null,
              ...(sellerEditingResellerOrder
                ? { resellerStoreId: order.storeId, supersededAddressChanges }
                : {}),
              ...(storeScope === undefined ? {} : { byResellerStoreId: storeScope.storeId }),
              ...this.ctxMeta(ctx),
            },
          },
          tx,
        );
        return updated;
      });
      if (isReseller && order.storeId !== null) {
        // The money follows the order, then WHOEVER DID NOT MAKE THE
        // CHANGE is told — the store by email (it has no inbox), seller
        // staff in-app by permission. Post-commit, and neither may throw
        // (NOTIF-1): the edit is the durable fact.
        const money = await this.postCommit.runForMoneyAffectingEdit({
          orderId: id,
          sellerId,
          orderNumber: order.orderNumber,
          changed,
          reason: `Order ${order.orderNumber} was changed (${changed.join(', ')})`,
          // No `announce`: this path tells them itself, just below, with
          // the same money line and the full field-by-field diff.
        });
        await this.tellTheOtherSideAboutTheEdit({
          storeId: order.storeId,
          saved,
          before: order,
          input,
          changed,
          money,
          byStore: storeScope !== undefined,
          supersededRequest: supersededAddressChanges > 0,
        });
      }
      return saved;
    } catch (e) {
      // `(sellerId, storeId, sellerOrderRef)` is UNIQUE, and an edit can
      // now set both the ref and the store — so the same clash create
      // guards against is reachable here. Translated to the same 409
      // rather than left to surface as a 500 with a Prisma code in it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_SELLER_ORDER_REF',
          message: `Another order already uses the reference "${input.sellerOrderRef ?? ''}" in this shopfront`,
        });
      }
      throw e;
    }
  }

  /**
   * Tell WHOEVER DID NOT MAKE THE CHANGE (owner, 2026-09-18).
   *
   * A reseller order has two parties and one of them just changed it, so
   * the other finds out every time — with the old value beside the new
   * one, and the money's before and after when it moved. The store hears
   * by EMAIL (a reseller store has no in-app inbox, so an in-app leg
   * would be written to a feed nobody there can open); seller staff hear
   * IN-APP, addressed by PERMISSION (NOTIF-10), exactly as every other
   * seller-side store topic is.
   *
   * Never throws (NOTIF-1). Awaited rather than fired and forgotten, so
   * the e2e reset has no in-flight write to drain (NOTIF-19).
   */
  private async tellTheOtherSideAboutTheEdit(input: {
    storeId: string;
    saved: { id: string; orderNumber: string; sellerId: string; updatedAt: Date };
    before: OrderView;
    input: UpdateOrderDto;
    changed: readonly string[];
    money: ResellerMoneyEditOutcome;
    byStore: boolean;
    supersededRequest: boolean;
  }): Promise<void> {
    try {
      const [seller, store] = await Promise.all([
        this.prisma.client.seller.findUnique({
          where: { id: input.saved.sellerId },
          select: { companyName: true },
        }),
        this.prisma.client.sellerStore.findUnique({
          where: { id: input.storeId },
          select: { name: true, displayName: true },
        }),
      ]);
      const changes = describeOrderChanges(input.before, input.input, input.changed);
      const money = describeMoneyOutcome(input.money);
      const eventKey = `${input.saved.id}:${input.saved.updatedAt.getTime()}`;
      if (input.byStore) {
        await this.storeRequestNotifier.orderChangedByStore({
          sellerId: input.saved.sellerId,
          eventKey,
          orderId: input.saved.id,
          orderNumber: input.saved.orderNumber,
          storeName: store?.displayName ?? store?.name ?? 'a reseller store',
          changes,
          money,
        });
        return;
      }
      await this.storeRequestNotifier.orderChangedBySeller({
        storeId: input.storeId,
        eventKey,
        orderId: input.saved.id,
        orderNumber: input.saved.orderNumber,
        sellerName: seller?.companyName ?? 'Your seller',
        changes,
        money,
        supersededRequest: input.supersededRequest,
      });
    } catch (err) {
      this.logger.warn(
        { orderId: input.saved.id, err: err instanceof Error ? err.message : err },
        'Could not tell the other side that a reseller order was changed',
      );
    }
  }

  /**
   * The order's live parcel, for `recipientChangeRoute` — the ONE fact
   * that decides whether an address is ours to write or the courier's to
   * accept. Superseded and voided parcels are excluded: neither is what
   * the courier is carrying.
   */
  private async liveShipmentForRoute(
    orderId: string,
  ): Promise<{ status: ShipmentStatus; awbNumber: string | null } | null> {
    const link = await this.prisma.client.orderShipment.findFirst({
      where: { orderId, shipment: { deletedAt: null, supersededAt: null } },
      orderBy: { shipmentSequence: 'desc' },
      select: { shipment: { select: { status: true, awbNumber: true } } },
    });
    return link?.shipment ?? null;
  }

  /** Seller-scoped load (ownership + soft-delete guard). */
  /**
   * The seller's order detail, with each line's picture resolved LIVE.
   *
   * `order_items.imageUrl` is part of the ORD-6 snapshot and stores the
   * canonical object URL, which has resolved for nobody since the bucket
   * went private (2026-07-28) — rendering it gives a broken image on
   * every order. A presigned URL expires in minutes and so cannot be
   * snapshotted; minting one at read time is the only correct shape.
   * See `CatalogReadService.thumbnailUrlsByVariant` for what that means
   * (the photograph is current; every other field stays immutable).
   *
   * Separate from `loadOwned` on purpose: the mutators call that one and
   * have no use for a picture, and presigning on a write path would be
   * work nobody reads.
   */
  async loadOwnedForDisplay(sellerId: string, id: string): Promise<OrderView> {
    const order = await this.loadOwnedForSeller(sellerId, id);
    const thumbs = await this.catalog.thumbnailUrlsByVariant(order.items.map((i) => i.variantId));
    return {
      ...order,
      items: order.items.map((i) => ({ ...i, imageUrl: thumbs.get(i.variantId) ?? null })),
    };
  }

  /**
   * The order as its SELLER may read it — IN FULL, the customer included.
   *
   * AMENDED 2026-09-16 (owner). RS-5 masked a reseller store's customer
   * here: their name, phones, email and street address were taken off
   * before the seller read them, because the customer was the store's.
   * The owner's call is that the ORDER is the seller's — their stock,
   * their warehouse slot, their courier, their money at risk — and a
   * seller who cannot see who a parcel is going to cannot act on it:
   * they cannot ring about a failed delivery, judge a bad address, or
   * answer the call centre. `order/reseller-privacy.ts` is deleted.
   *
   * The method survives the mask it existed for: it is still the ONE
   * seller-scoped read, so a future rule about what a seller may see has
   * a single place to live.
   */
  async loadOwnedForSeller(sellerId: string, id: string): Promise<OrderView> {
    return this.loadOwned(sellerId, id);
  }

  async loadOwned(sellerId: string, id: string): Promise<OrderView> {
    const order = await this.prisma.client.order.findFirst({
      where: { id, sellerId, deletedAt: null },
      include: ORDER_VIEW_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  async list(
    sellerId: string,
    query: ListOrdersQuery,
  ): Promise<{ items: OrderListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = { sellerId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    // The seller supplies a store id; the guard supplies the seller, and
    // `where.sellerId` is already set — so a store belonging to somebody
    // else matches nothing rather than leaking a row.
    if (query.storeId) where.storeId = query.storeId;
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { sellerOrderRef: { contains: query.search, mode: 'insensitive' } },
        // A name or phone matches EVERY order of this seller's, a
        // reseller store's included (2026-09-16): the rows no longer
        // hide the customer, so a search that skipped them would mean a
        // seller reading a phone number on one screen and finding
        // nothing when they typed it into the next.
        { recipientName: { contains: query.search, mode: 'insensitive' } },
        { recipientPhoneE164: { contains: query.search, mode: 'insensitive' } },
        // The WAYBILL. It is the number a courier quotes, a customer
        // reads off a text message and a seller pastes from an email —
        // and it was the one identifier on the parcel that this search
        // could not find.
        {
          orderShipments: {
            some: { shipment: { awbNumber: { contains: query.search, mode: 'insensitive' } } },
          },
        },
      ];
    }
    // Placed between. Both ends optional, so "everything since the
    // 1st" and "everything before today" are one control away.
    if (query.placedFrom !== undefined || query.placedTo !== undefined) {
      where.placedAt = {
        ...(query.placedFrom === undefined ? {} : { gte: new Date(query.placedFrom) }),
        ...(query.placedTo === undefined ? {} : { lte: new Date(query.placedTo) }),
      };
    }
    const [items, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: ORDER_LIST_SELECT,
      }),
      this.prisma.client.order.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * Admin (cross-seller) list. RBAC scoping defers to Module 12
   * (phase-1a-debt — same as every other admin surface in Phase 1A).
   */
  async adminList(
    query: AdminListOrdersQuery,
  ): Promise<{ items: OrderListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    // A store belongs to exactly one seller, so narrowing to one is
    // already narrowing to that seller — the admin list does not need
    // both, and supplying a mismatched pair correctly returns nothing.
    if (query.storeId) where.storeId = query.storeId;
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { sellerOrderRef: { contains: query.search, mode: 'insensitive' } },
        { recipientName: { contains: query.search, mode: 'insensitive' } },
        { recipientPhoneE164: { contains: query.search, mode: 'insensitive' } },
        // The WAYBILL. It is the number a courier quotes, a customer
        // reads off a text message and a seller pastes from an email —
        // and it was the one identifier on the parcel that this search
        // could not find.
        {
          orderShipments: {
            some: { shipment: { awbNumber: { contains: query.search, mode: 'insensitive' } } },
          },
        },
      ];
    }
    // Placed between. Both ends optional, so "everything since the
    // 1st" and "everything before today" are one control away.
    if (query.placedFrom !== undefined || query.placedTo !== undefined) {
      where.placedAt = {
        ...(query.placedFrom === undefined ? {} : { gte: new Date(query.placedFrom) }),
        ...(query.placedTo === undefined ? {} : { lte: new Date(query.placedTo) }),
      };
    }
    const [items, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: ORDER_LIST_SELECT,
      }),
      this.prisma.client.order.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Admin order detail (no seller scope). 404 on missing/soft-deleted. */
  async adminGetById(id: string): Promise<AdminOrderView> {
    const order = await this.prisma.client.order.findFirst({
      where: { id, deletedAt: null },
      include: ORDER_VIEW_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    // A reseller order names its terms by id; staff read the version NUMBER
    // ("Version 3"), which is what the store and seller saw when accepting.
    const termsVersionId = order.resellerTermsVersionId ?? null;
    const resellerTermsVersionNumber =
      termsVersionId === null
        ? null
        : ((
            await this.prisma.client.resellerStoreTermsVersion.findUnique({
              where: { id: termsVersionId },
              select: { version: true },
            })
          )?.version ?? null);
    return { ...order, resellerTermsVersionNumber };
  }

  /** Seller-visible timeline. Internal-only events are filtered out. */
  async listEvents(sellerId: string, orderId: string): Promise<OrderEventView[]> {
    await this.loadOwned(sellerId, orderId); // ownership + 404 guard
    return this.prisma.client.orderEvent.findMany({
      where: { orderId, isVisibleToSeller: true },
      orderBy: { createdAt: 'asc' },
      select: ORDER_EVENT_SELECT,
    });
  }

  /** Shipments associated with an order (via order_shipments).
   *  Returns ordering of newest-first; supersede chains keep older
   *  rows around so the operator sees the whole lineage. */
  async listShipmentsForAdmin(orderId: string): Promise<
    Array<{
      id: string;
      shipmentNumber: string;
      status: string;
      awbNumber: string | null;
      courierCode: string;
      /** WHICH of our accounts with that courier carried it (CACC-1). */
      courierAccountLabel: string | null;
      /** WHICH CARRIER an aggregator's ranking actually gave us — e.g.
       *  "Blue Dart Air" on a Shiprocket booking. Null for Delhivery,
       *  who is the carrier, and null for anything booked before we
       *  started recording it (their reply is not stored, so it cannot
       *  be backfilled). */
      carrierName: string | null;
      isManualCourier: boolean;
      manualCourierName: string | null;
      createdAt: Date;
      supersedesShipmentId: string | null;
      /** When the courier accepted a cancellation of this waybill. A
       *  voided shipment with an AWB and no stamp is still live there. */
      courierCancelledAt: Date | null;
    }>
  > {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    const rows = await this.prisma.client.orderShipment.findMany({
      where: { orderId },
      select: {
        shipment: {
          select: {
            id: true,
            shipmentNumber: true,
            status: true,
            awbNumber: true,
            courierCode: true,
            courierAccount: { select: { label: true } },
            carrierName: true,
            isManualCourier: true,
            manualCourierName: true,
            createdAt: true,
            supersedesShipmentId: true,
            courierCancelledAt: true,
          },
        },
      },
    });
    return rows
      .map((r) => r.shipment)
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map(({ courierAccount, ...s }) => ({
        ...s,
        courierAccountLabel: courierAccount?.label ?? null,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Soft-delete (discard) a DRAFT order. Only DRAFT is discardable — a
   * submitted/active order must be cancelled, not deleted, so its history
   * is preserved (CLAUDE soft-delete rule; deletedAt hides it from read
   * paths). Idempotent-safe: loadOwned already filters deletedAt.
   */
  async discardDraft(
    sellerId: string,
    id: string,
    actor: EventActor,
    ctx: ClientContext,
  ): Promise<void> {
    const order = await this.loadOwned(sellerId, id);
    if (order.status !== OrderStatus.DRAFT) {
      throw new ConflictException({
        code: 'NOT_DISCARDABLE',
        message: `Only DRAFT orders can be discarded (order is ${order.status}); cancel it instead`,
      });
    }
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { deletedAt: now } });
      await this.events.note(tx, id, 'Draft order discarded', actor, true);
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          sellerId,
          action: 'order.discarded',
          entityType: 'order',
          entityId: id,
          metadata: { orderNumber: order.orderNumber, ...this.ctxMeta(ctx) },
        },
        tx,
      );
    });
  }

  // ── CSV bulk-import helpers (ORD-9 state-aware idempotency) ──────────

  /** Lightweight existence/state probe for CSV idempotency. */
  async getBySellerOrderRef(
    sellerId: string,
    ref: string,
    storeId?: string | null,
  ): Promise<{ id: string; status: OrderStatus } | null> {
    // Scoped to the STORE when one is given. Without it, a CSV row from
    // shopfront B carrying `#1001` matches shopfront A's order and the
    // importer PATCHES it (ORD-9) — the collision the unique key was
    // widened to prevent, arriving through the read instead.
    return this.prisma.client.order.findFirst({
      where: {
        sellerId,
        sellerOrderRef: ref,
        deletedAt: null,
        // RS-5: with no store named, only the seller's OWN (channel)
        // orders — a seller's CSV row must never match, and so PATCH, an
        // order a reseller store placed under the same reference.
        ...(storeId == null || storeId === ''
          ? { storeKind: SellerStoreKind.CHANNEL }
          : { storeId }),
      },
      select: { id: true, status: true },
    });
  }

  /**
   * ORD-9 PATCH: re-upload of an externalRef that matches a
   * DRAFT/PENDING_CONFIRMATION order. CSV-provided cells overwrite;
   * recipient changes re-validate + re-resolve the per-seller customer
   * on a phone change; the single CSV line's quantity/SKU is synced.
   * The caller (processor) has already rejected CONFIRMED+ matches.
   * Returns whether anything actually changed.
   */
  async applyBulkPatch(
    sellerId: string,
    orderId: string,
    patch: BulkOrderPatchInput,
    actor: EventActor,
  ): Promise<'PATCHED' | 'UNCHANGED'> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, sellerId, deletedAt: null },
      select: {
        id: true,
        status: true,
        recipientName: true,
        recipientPhoneE164: true,
        recipientEmail: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientLandmark: true,
        recipientCity: true,
        recipientStateProvince: true,
        recipientPostalCode: true,
        recipientCountryCode: true,
        codAmountInr: true,
        customerId: true,
        storeKind: true,
        items: { select: { id: true, variantId: true, quantity: true }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    /*
      RS-5: THIS path re-snapshots the line from the LIVE catalogue with
      no reseller terms on it, so a patched line would carry
      `store_kind = RESELLER` with null term columns — which
      `order_items_reseller_snapshot_ck` refuses — and the money would
      have nothing to re-plan from. It stays refused.

      A store's OWN CSV re-upload is patchable since 2026-09-19, and it
      does NOT come through here: `OrderCsvImportProcessorService`
      routes a store row to `OrderService.edit` with the store's scope,
      which re-terms the line under the ORDER's snapshot and re-plans the
      money. This refusal is what stops a future caller from taking the
      cheap route instead.
    */
    if (order.storeKind === SellerStoreKind.RESELLER) {
      throw new ConflictException({
        code: 'RESELLER_ORDER_NOT_EDITABLE',
        message:
          'A reseller store’s order cannot be changed by this path — it carries terms a live-catalogue re-snapshot would lose',
      });
    }
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING_CONFIRMATION) {
      throw new ConflictException({
        code: 'BULK_PATCH_NOT_ALLOWED',
        message: `Order in ${order.status} is not CSV-patchable`,
      });
    }

    const canonicalState = await this.addressValidation.assertValid({
      recipientPhoneE164: patch.customerPhone,
      recipientPostalCode: patch.pinCode,
      recipientStateProvince: patch.state,
      recipientCountryCode: order.recipientCountryCode,
    });

    const data: Prisma.OrderUpdateInput = {};
    const changed: string[] = [];
    const setIf = (
      cur: string | null,
      next: string | null,
      key: keyof Prisma.OrderUpdateInput,
    ): void => {
      if ((cur ?? null) !== (next ?? null)) {
        (data as Record<string, unknown>)[key] = next;
        changed.push(key as string);
      }
    };
    setIf(order.recipientName, patch.customerName, 'recipientName');
    setIf(order.recipientPhoneE164, patch.customerPhone.trim(), 'recipientPhoneE164');
    setIf(order.recipientEmail, patch.customerEmail ?? null, 'recipientEmail');
    setIf(order.recipientAddressLine1, patch.addressLine1, 'recipientAddressLine1');
    setIf(order.recipientAddressLine2, patch.addressLine2 ?? null, 'recipientAddressLine2');
    setIf(order.recipientLandmark, patch.landmark ?? null, 'recipientLandmark');
    // City and state are optional on a CSV row now. A row that omits
    // them must LEAVE THE STORED VALUE ALONE — `?? null` wrote null into
    // a NOT NULL column and failed the whole import, and even a '' would
    // have silently blanked a locality the first upload got right.
    if (patch.city !== undefined) setIf(order.recipientCity, patch.city, 'recipientCity');
    if (patch.state !== undefined) {
      setIf(order.recipientStateProvince, canonicalState, 'recipientStateProvince');
    }
    setIf(order.recipientPostalCode, patch.pinCode.trim(), 'recipientPostalCode');

    const curCod = order.codAmountInr === null ? null : Number(order.codAmountInr);
    const nextCod = patch.codAmount ?? null;
    if (curCod !== nextCod) {
      data.codAmountInr = nextCod === null ? null : new Prisma.Decimal(nextCod);
      changed.push('codAmountInr');
    }

    const phoneChanged = patch.customerPhone.trim() !== order.recipientPhoneE164;

    // Single CSV line: sync quantity and (if the SKU moved) re-snapshot.
    const line = order.items[0];
    let lineUpdate: { id: string; data: Prisma.OrderItemUpdateInput } | null = null;
    if (line) {
      const resolved = await this.catalog.getVariantBySku(sellerId, patch.productSku);
      if (!resolved || resolved.sellerId !== sellerId) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant SKU "${patch.productSku}" not found for this seller`,
        });
      }
      const liData: Prisma.OrderItemUpdateInput = {};
      if (resolved.variantId !== line.variantId) {
        liData.variant = { connect: { id: resolved.variantId } };
        liData.skuCode = resolved.skuCode;
        liData.productName = resolved.productName;
        liData.variantLabel = resolved.variantLabel;
        liData.imageUrl = resolved.imageUrl;
        liData.unitWeightGrams = resolved.weightGrams;
        liData.unitDeclaredValueInr = resolved.declaredValueInr;
        changed.push('lineVariant');
      }
      if (patch.quantity !== line.quantity) {
        liData.quantity = patch.quantity;
        changed.push('lineQuantity');
      }
      if (Object.keys(liData).length > 0) {
        lineUpdate = { id: line.id, data: liData };
      }
    }

    if (changed.length === 0) return 'UNCHANGED';

    await this.prisma.client.$transaction(async (tx) => {
      if (phoneChanged) {
        const customer = await this.customers.findOrCreate(tx, {
          sellerId,
          phoneE164: patch.customerPhone.trim(),
          name: patch.customerName,
          email: patch.customerEmail ?? null,
        });
        data.customer = { connect: { id: customer.id } };
      }
      if (Object.keys(data).length > 0) {
        await tx.order.update({ where: { id: order.id }, data });
      }
      if (lineUpdate) {
        await tx.orderItem.update({ where: { id: lineUpdate.id }, data: lineUpdate.data });
      }
      await this.events.note(
        tx,
        order.id,
        `CSV re-upload patch (${changed.join(', ')})`,
        actor,
        false,
      );
    });
    return 'PATCHED';
  }

  private ctxMeta(ctx: ClientContext): Record<string, unknown> {
    return {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    };
  }

  // ActorType re-exported so controllers (commit 11) can build the actor
  // without a direct @skydrop/db import at the call site.
  static readonly Actor = ActorType;
}
