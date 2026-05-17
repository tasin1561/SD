import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  ActorType,
  OrderSource,
  OrderStatus,
  PaymentMode,
  Prisma,
  VariantStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { CustomerService } from './customer.service';
import { OrderNumberingService } from './order-numbering.service';
import { OrderEventWriterService, type EventActor } from './order-event-writer.service';
import { RecipientAddressCacheService } from './recipient-address-cache.service';
import { AddressValidationService } from './address-validation.service';
import type { CreateOrderDto } from '../dto/create-order.dto';

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
      hsCode: true,
      qtyReserved: true,
    },
  },
} as const;

export type OrderView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>;

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
  hsCode: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: OrderNumberingService,
    private readonly customers: CustomerService,
    private readonly events: OrderEventWriterService,
    private readonly addressCache: RecipientAddressCacheService,
    private readonly addressValidation: AddressValidationService,
    private readonly catalog: CatalogReadService,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    sellerId: string,
    input: CreateOrderDto,
    actor: EventActor,
    ctx: ClientContext,
    options: CreateOrderOptions = {},
  ): Promise<OrderView> {
    const source = options.source ?? OrderSource.MANUAL;
    const now = new Date();

    // ── Pre-tx validation (no writes; fail fast before allocating a
    //    number / touching the customer row). ────────────────────────────
    const canonicalState = await this.addressValidation.assertValid({
      recipientPhoneE164: input.recipientPhoneE164,
      recipientAltPhoneE164: input.recipientAltPhoneE164 ?? null,
      recipientPostalCode: input.recipientPostalCode,
      recipientStateProvince: input.recipientStateProvince,
      recipientCountryCode: input.recipientCountryCode ?? 'IN',
    });

    this.assertPayment(input);
    const lines = await this.resolveLines(sellerId, input.items);

    const declaredValueInr =
      input.declaredValueInr !== undefined
        ? new Prisma.Decimal(input.declaredValueInr)
        : lines.reduce(
            (sum, l) =>
              sum.add((l.unitDeclaredValueInr ?? new Prisma.Decimal(0)).mul(l.quantity)),
            new Prisma.Decimal(0),
          );

    const totalWeightGrams =
      input.totalWeightGrams !== undefined
        ? input.totalWeightGrams
        : lines.every((l) => l.unitWeightGrams !== null)
          ? lines.reduce((sum, l) => sum + (l.unitWeightGrams ?? 0) * l.quantity, 0)
          : null;

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const orderNumber = await this.numbering.nextOrderNumber(tx, now);

        const customer = await this.customers.findOrCreate(tx, {
          sellerId,
          phoneE164: input.recipientPhoneE164.trim(),
          name: input.customerName ?? input.recipientName,
          email: input.customerEmail ?? input.recipientEmail ?? null,
          altPhoneE164: input.recipientAltPhoneE164 ?? null,
          preferredLanguage: input.preferredLanguage ?? 'en',
        });

        const order = await tx.order.create({
          data: {
            orderNumber,
            sellerId,
            customerId: customer.id,
            sellerOrderRef: input.sellerOrderRef ?? null,
            source,
            status: OrderStatus.DRAFT,
            recipientName: input.recipientName,
            recipientPhoneE164: input.recipientPhoneE164.trim(),
            recipientAltPhoneE164: input.recipientAltPhoneE164 ?? null,
            recipientEmail: input.recipientEmail ?? null,
            recipientAddressLine1: input.recipientAddressLine1,
            recipientAddressLine2: input.recipientAddressLine2 ?? null,
            recipientLandmark: input.recipientLandmark ?? null,
            recipientCity: input.recipientCity,
            recipientStateProvince: canonicalState,
            recipientPostalCode: input.recipientPostalCode.trim(),
            recipientCountryCode: (input.recipientCountryCode ?? 'IN').toUpperCase(),
            paymentMode: input.paymentMode,
            codAmountInr:
              input.paymentMode === PaymentMode.COD && input.codAmountInr !== undefined
                ? new Prisma.Decimal(input.codAmountInr)
                : null,
            declaredValueInr,
            totalWeightGrams,
            packageType: input.packageType ?? null,
            isUrgent: input.isUrgent ?? false,
            sellerNotes: input.sellerNotes ?? null,
            internalNotes: input.internalNotes ?? null,
            placedAt: now,
            items: {
              create: lines.map((l) => ({
                variantId: l.variantId,
                skuCode: l.skuCode,
                productName: l.productName,
                variantLabel: l.variantLabel,
                imageUrl: l.imageUrl,
                quantity: l.quantity,
                unitWeightGrams: l.unitWeightGrams,
                unitDeclaredValueInr: l.unitDeclaredValueInr,
                unitPriceInr: l.unitPriceInr,
                hsCode: l.hsCode,
              })),
            },
          },
          include: ORDER_VIEW_INCLUDE,
        });

        await this.customers.recordNewOrder(tx, customer.id, now);

        await this.events.created(tx, order.id, actor, {
          orderNumber,
          source,
          itemCount: lines.length,
        });

        // Locked decision #4: feed the autocomplete cache for MANUAL
        // entry only (bulk imports must not pollute suggestions).
        if (source === OrderSource.MANUAL) {
          await this.addressCache.recordAddress(
            tx,
            customer.id,
            {
              line1: input.recipientAddressLine1,
              line2: input.recipientAddressLine2 ?? null,
              landmark: input.recipientLandmark ?? null,
              city: input.recipientCity,
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
      // (sellerId, sellerOrderRef) is @@unique — surface a clean 409.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'DUPLICATE_SELLER_ORDER_REF',
          message: `An order with sellerOrderRef "${input.sellerOrderRef}" already exists for this seller`,
        });
      }
      throw e;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────

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
        hsCode: v.hsCode,
      };
    });
  }

  // ActorType re-exported so controllers (commit 11) can build the actor
  // without a direct @skydrop/db import at the call site.
  static readonly Actor = ActorType;
}
