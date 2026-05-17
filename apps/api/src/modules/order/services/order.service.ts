import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  OrderCancellationReason,
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
import { OrderStateMachineService } from './order-state-machine.service';
import { RecipientAddressCacheService } from './recipient-address-cache.service';
import { AddressValidationService } from './address-validation.service';
import type { CreateOrderDto } from '../dto/create-order.dto';
import type { UpdateOrderDto } from '../dto/update-order.dto';
import type { CancelOrderDto } from '../dto/cancel-order.dto';

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
    private readonly stateMachine: OrderStateMachineService,
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

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.order.update({
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
      return updated;
    });
  }

  /**
   * Seller/customer cancel. Only valid from a pre-reservation state — the
   * state machine declares NO side-effects for those CANCELLED edges
   * (DRAFT / PENDING_CONFIRMATION). A CONFIRMED+ order's CANCELLED edge
   * carries RELEASE_STOCK; that path is OrderWriteService.transitionStatus
   * (commit 12), not this seller-facing shortcut.
   */
  async cancel(
    sellerId: string,
    id: string,
    input: CancelOrderDto,
    actor: EventActor,
    ctx: ClientContext,
  ): Promise<OrderView> {
    const order = await this.loadOwned(sellerId, id);
    if (!this.stateMachine.isValidTransition(order.status, OrderStatus.CANCELLED)) {
      throw new ConflictException({
        code: 'NOT_CANCELLABLE',
        message: `An order in ${order.status} cannot be cancelled here`,
      });
    }
    if (
      this.stateMachine.requiredSideEffects(order.status, OrderStatus.CANCELLED).length > 0
    ) {
      throw new ConflictException({
        code: 'CANCEL_NEEDS_STOCK_RELEASE',
        message:
          `Cancelling a ${order.status} order releases reserved stock; use the ops cancel path`,
      });
    }

    const reason = input.reason ?? OrderCancellationReason.SELLER_REQUESTED;
    const now = new Date();
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancellationReason: reason,
          cancelledAt: now,
          cancelledById: actor.type === ActorType.STAFF ? (actor.id ?? null) : null,
        },
        include: ORDER_VIEW_INCLUDE,
      });
      await this.events.statusChanged(tx, {
        orderId: id,
        from: order.status,
        to: OrderStatus.CANCELLED,
        actor,
        description: `Order cancelled (${reason})${input.note ? `: ${input.note}` : ''}`,
        data: { reason, note: input.note ?? null },
      });
      await this.audit.log(
        {
          actorType: actor.type,
          actorId: actor.id ?? null,
          sellerId,
          action: 'order.cancelled',
          entityType: 'order',
          entityId: id,
          metadata: {
            orderNumber: order.orderNumber,
            fromStatus: order.status,
            reason,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return updated;
    });
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
  ): Promise<OrderView> {
    const order = await this.loadOwned(sellerId, id);

    const isDraft = order.status === OrderStatus.DRAFT;
    const isPending = order.status === OrderStatus.PENDING_CONFIRMATION;
    if (!isDraft && !isPending) {
      throw new ConflictException({
        code: 'NOT_EDITABLE',
        message: `An order in ${order.status} cannot be edited`,
      });
    }

    const economicKeys = [
      'paymentMode',
      'codAmountInr',
      'declaredValueInr',
      'totalWeightGrams',
      'packageType',
      'isUrgent',
    ] as const;
    const touchedEconomic = economicKeys.some((k) => input[k] !== undefined);
    if (isPending && (input.items !== undefined || touchedEconomic)) {
      throw new BadRequestException({
        code: 'EDIT_SCOPE_PENDING',
        message:
          'A PENDING_CONFIRMATION order accepts recipient/customer corrections and notes only',
      });
    }

    const data: Prisma.OrderUpdateInput = {};
    const changed: string[] = [];

    // ── Recipient block (+ revalidation when any recipient field set) ──
    const recipientKeys = [
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
    const touchedRecipient = recipientKeys.some((k) => input[k] !== undefined);

    if (touchedRecipient) {
      const merged = {
        recipientPhoneE164:
          input.recipientPhoneE164?.trim() ?? order.recipientPhoneE164,
        recipientAltPhoneE164:
          input.recipientAltPhoneE164 ?? order.recipientAltPhoneE164,
        recipientPostalCode:
          input.recipientPostalCode?.trim() ?? order.recipientPostalCode,
        recipientStateProvince:
          input.recipientStateProvince ?? order.recipientStateProvince,
        recipientCountryCode: order.recipientCountryCode,
      };
      const canonicalState = await this.addressValidation.assertValid(merged);

      if (input.recipientName !== undefined) data.recipientName = input.recipientName;
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

    // ── Economics / physical (DRAFT only) ──────────────────────────────
    let effectivePaymentMode = order.paymentMode;
    if (isDraft) {
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

    // ── Lines: full replace (DRAFT only) ───────────────────────────────
    let replacementLines: Awaited<ReturnType<OrderService['resolveLines']>> | null = null;
    if (input.items !== undefined) {
      replacementLines = await this.resolveLines(sellerId, input.items);
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
    const phoneChanged =
      newPhone !== undefined && newPhone !== order.recipientPhoneE164;

    if (changed.length === 0) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'No editable fields were supplied',
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      if (phoneChanged && newPhone !== undefined) {
        const customer = await this.customers.findOrCreate(tx, {
          sellerId,
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
          create: replacementLines.map((l) => ({
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
        };
      }

      const updated = await tx.order.update({
        where: { id },
        data,
        include: ORDER_VIEW_INCLUDE,
      });
      await this.events.note(
        tx,
        id,
        `Order edited (${changed.join(', ')})${phoneChanged ? '; customer re-linked' : ''}`,
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
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return updated;
    });
  }

  /** Seller-scoped load (ownership + soft-delete guard). */
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
