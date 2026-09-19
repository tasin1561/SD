import { Injectable, Logger } from '@nestjs/common';
import { ActorType, BulkUploadStatus, OrderSource, OrderStatus, PaymentMode } from '@skydrop/db';
import Papa from 'papaparse';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { OrderService, type BulkOrderPatchInput } from '../../order/services/order.service';
import { ResellerOrderService } from '../../order/services/reseller-order.service';
import { StagedOrderRowService } from './staged-order-row.service';
import type { CreateOrderDto } from '../../order/dto/create-order.dto';
import type { CreateStoreOrderDto } from '../../order/dto/create-store-order.dto';
import type { UpdateOrderDto } from '../../order/dto/update-order.dto';
import { OrderCsvParserService, type CoercedOrderRow } from './order-csv-parser.service';
import type { OrderCsvField } from '../order-csv-fields';
import { orderErrorReportKeyFor } from '../order-csv-key';

interface ErrorRow {
  rowNumber: number;
  errorField: string;
  errorReason: string;
  original: Record<string, string>;
}

function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * ORD-9 CSV row processor. Per-row, terminal-state idempotent, state
 * aware:
 *  - new externalRef ⇒ create the order in PENDING_CONFIRMATION (CSV is
 *    submission, not drafting). NO availability check (ORD-10 — Module 7
 *    catches shortfall at confirmation).
 *  - externalRef matches a DRAFT/PENDING_CONFIRMATION order ⇒ PATCH.
 *  - externalRef matches a CONFIRMED+ order ⇒ ERROR row (never a silent
 *    update).
 * Each row is its own unit; a failing row is written to the error
 * report and never half-writes (OrderService.create / applyBulkPatch
 * are individually tx-wrapped).
 */
@Injectable()
export class OrderCsvImportProcessorService {
  private readonly logger = new Logger(OrderCsvImportProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly parser: OrderCsvParserService,
    private readonly catalog: CatalogReadService,
    private readonly orders: OrderService,
    private readonly staged: StagedOrderRowService,
    // RS-5: a reseller store's upload places each row as THAT store's
    // order, through every refusal a portal order meets.
    private readonly resellerOrders: ResellerOrderService,
  ) {}

  async process(uploadId: string, mapping: Partial<Record<OrderCsvField, string>>): Promise<void> {
    const upload = await this.prisma.client.bulkOrderUpload.findUnique({
      where: { id: uploadId },
      select: {
        id: true,
        sellerId: true,
        spacesKey: true,
        status: true,
        resellerStoreId: true,
        uploadedByStoreUserId: true,
      },
    });
    if (!upload) {
      this.logger.warn({ uploadId }, 'Order CSV upload row not found; skipping');
      return;
    }
    if (
      upload.status === BulkUploadStatus.COMPLETED ||
      upload.status === BulkUploadStatus.COMPLETED_WITH_ERRORS
    ) {
      return; // terminal — idempotent against a re-delivered job
    }

    await this.prisma.client.bulkOrderUpload.update({
      where: { id: uploadId },
      data: { status: BulkUploadStatus.PROCESSING, startedAt: new Date() },
    });

    const sellerId = upload.sellerId;
    const buffer = await this.spaces.getObject(upload.spacesKey);
    if (!buffer) {
      await this.fail(uploadId, 'Uploaded CSV could not be read from storage');
      return;
    }
    const parsed = this.parser.parse(buffer);
    if (parsed.rowCount > this.env.csvMaxRows) {
      await this.fail(
        uploadId,
        `CSV has ${parsed.rowCount} rows; the limit is ${this.env.csvMaxRows}`,
      );
      return;
    }

    const actor = { type: ActorType.SELLER, id: sellerId };
    const ctx = { ipAddress: null, userAgent: null, requestId: `bulk:${uploadId}` };
    const counters = { ordersCreated: 0, rowsFailed: 0, rowsSkipped: 0 };
    const errorRows: ErrorRow[] = [];
    // RS-5 — a reseller store's upload. Its rows are that store's orders
    // and its customers' details; none is ever parked in the SELLER's
    // staged-row queue (the seller must not read them), so a failed row
    // lives in the error report only.
    const storeId = upload.resellerStoreId ?? null;
    const storeUserId = upload.uploadedByStoreUserId ?? null;

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      if (!raw) continue;
      const rowNumber = i + 2; // 1 header + 1-based

      const { row, errors } = this.parser.coerceRow(raw, mapping);
      if (!row || errors.length > 0) {
        for (const e of errors) {
          errorRows.push({
            rowNumber,
            errorField: e.field ?? '',
            errorReason: e.reason,
            original: raw,
          });
        }
        // ...and park it somewhere the seller can actually fix it. The
        // error CSV stays for bulk triage; this is the queue.
        if (storeId === null) {
          await this.staged.stage({
            uploadId,
            sellerId,
            rowNumber,
            data: this.mappedValues(raw, mapping),
            problems: errors.map((e) => ({ field: e.field ?? '', reason: e.reason })),
          });
        }
        counters.rowsFailed += 1;
        continue;
      }

      if (storeId !== null) {
        /*
          ORD-9 for a STORE, in full since 2026-09-19 (owner): a new
          reference PLACES the order, a reference already placed and
          still editable is PATCHED, and anything past that is an error
          row. It used to stop at the second step — a repeat reference
          was always an error — because a patch re-snapshotted the line
          from the live catalogue with no reseller terms on it, which
          would have re-priced the store's deal. It now goes through the
          same `OrderService.edit` the store's own portal uses, so the
          line is re-termed under the order's OWN snapshot, the money is
          re-planned and the seller is told; see `patchStoreOrder`.
        */
        try {
          if (storeUserId === null) {
            throw new Error('This upload has no store user to place its orders as');
          }
          const existing = await this.orders.getBySellerOrderRef(
            sellerId,
            row.externalRef,
            storeId,
          );
          if (existing === null) {
            await this.createStoreOrder(sellerId, storeId, storeUserId, uploadId, row, ctx);
            counters.ordersCreated += 1;
          } else if (
            existing.status === OrderStatus.DRAFT ||
            existing.status === OrderStatus.PENDING_CONFIRMATION
          ) {
            await this.patchStoreOrder(sellerId, storeId, storeUserId, existing.id, row, ctx);
            counters.rowsSkipped += 1; // matched an existing order (patched/unchanged)
          } else {
            errorRows.push({
              rowNumber,
              errorField: 'externalRef',
              errorReason: `externalRef "${row.externalRef}" matches an order of this store in ${existing.status}; a CSV cannot change a confirmed-or-later order`,
              original: raw,
            });
            counters.rowsFailed += 1;
          }
        } catch (err) {
          errorRows.push({
            rowNumber,
            errorField: '',
            errorReason: err instanceof Error ? err.message : 'Unexpected error importing row',
            original: raw,
          });
          counters.rowsFailed += 1;
        }
        continue;
      }

      try {
        const existing = await this.orders.getBySellerOrderRef(sellerId, row.externalRef);
        if (!existing) {
          await this.createOrder(sellerId, uploadId, row, actor, ctx);
          counters.ordersCreated += 1;
        } else if (
          existing.status === OrderStatus.DRAFT ||
          existing.status === OrderStatus.PENDING_CONFIRMATION
        ) {
          await this.orders.applyBulkPatch(sellerId, existing.id, this.toPatch(row), actor);
          counters.rowsSkipped += 1; // matched an existing order (patched/unchanged)
        } else {
          errorRows.push({
            rowNumber,
            errorField: 'externalRef',
            errorReason: `externalRef "${row.externalRef}" matches an order in ${existing.status}; CSV cannot update a confirmed-or-later order`,
            original: raw,
          });
          counters.rowsFailed += 1;
        }
      } catch (err) {
        // A suspected duplicate is not a malformed row — it is a
        // question only the seller can answer, so it goes to the queue
        // carrying the orders it might duplicate rather than into an
        // error report that offers no way to answer it.
        const dup = this.asDuplicate(err);
        errorRows.push({
          rowNumber,
          errorField: dup ? 'customerPhone' : '',
          errorReason: err instanceof Error ? err.message : 'Unexpected error importing row',
          original: raw,
        });
        await this.staged.stage({
          uploadId,
          sellerId,
          rowNumber,
          data: this.mappedValues(raw, mapping),
          problems: dup
            ? []
            : [
                {
                  field: '',
                  reason: err instanceof Error ? err.message : 'Unexpected error importing row',
                },
              ],
          ...(dup ? { duplicateOf: dup } : {}),
        });
        counters.rowsFailed += 1;
      }
    }

    let errorReportKey: string | null = null;
    if (errorRows.length > 0) {
      errorReportKey = await this.writeErrorReport(upload.spacesKey, parsed.headers, errorRows);
    }

    const status =
      counters.rowsFailed === 0
        ? BulkUploadStatus.COMPLETED
        : counters.rowsFailed === parsed.rowCount
          ? BulkUploadStatus.FAILED
          : BulkUploadStatus.COMPLETED_WITH_ERRORS;

    await this.prisma.client.bulkOrderUpload.update({
      where: { id: uploadId },
      data: {
        status,
        rowCount: parsed.rowCount,
        ...counters,
        errorReportKey,
        completedAt: new Date(),
      },
    });

    await this.audit.log({
      actorType: storeId === null ? ActorType.SELLER : ActorType.STORE,
      ...(storeId === null ? {} : { actorId: storeUserId }),
      sellerId,
      action: 'order.csv_import.processed',
      entityType: 'bulk_order_upload',
      entityId: uploadId,
      metadata: {
        status,
        ...counters,
        rowCount: parsed.rowCount,
        ...(storeId === null ? {} : { resellerStoreId: storeId }),
      },
    });
  }

  // ── internal ──────────────────────────────────────────────────────

  /** RS-5 — one CSV row as a reseller store's order (every portal refusal applies). */
  private async createStoreOrder(
    sellerId: string,
    storeId: string,
    storeUserId: string,
    uploadId: string,
    row: CoercedOrderRow,
    ctx: { ipAddress: null; userAgent: null; requestId: string },
  ): Promise<void> {
    const resolved = await this.catalog.getVariantBySku(sellerId, row.productSku);
    if (!resolved || resolved.sellerId !== sellerId) {
      throw new Error(`Variant SKU "${row.productSku}" is not in this store's catalogue`);
    }
    const dto: CreateStoreOrderDto = {
      sellerOrderRef: row.externalRef,
      recipientName: row.customerName,
      recipientPhoneE164: row.customerPhone,
      recipientAddressLine1: row.addressLine1,
      recipientAddressLine2: row.addressLine2,
      recipientPostalCode: row.pinCode,
      // A store order is cash on delivery (prepaid waits for the store
      // wallet, RS-5); with no COD Amount the row collects its retail total.
      paymentMode: PaymentMode.COD,
      items: [
        {
          variantId: resolved.variantId,
          quantity: row.quantity,
          // A row with no selling price falls back to the seller's
          // SUGGESTED RETAIL for this store, inside `ResellerOrderService`
          // — the one place that decides it for every door (2026-09-19).
          // Passing 0 here would price the goods at nothing and pass
          // every range check that has no minimum.
          ...(row.retailUnitPrice === undefined ? {} : { retailUnitPriceInr: row.retailUnitPrice }),
        },
      ],
    } as CreateStoreOrderDto;
    if (row.customerEmail !== undefined) dto.recipientEmail = row.customerEmail;
    if (row.landmark !== undefined) dto.recipientLandmark = row.landmark;
    if (row.city !== undefined) dto.recipientCity = row.city;
    if (row.state !== undefined) dto.recipientStateProvince = row.state;
    if (row.codAmount !== undefined && row.codAmount > 0) dto.codAmountInr = row.codAmount;

    await this.resellerOrders.create({ kind: 'STORE_USER', storeId, storeUserId }, dto, ctx, {
      source: OrderSource.BULK_UPLOAD,
      bulkUploadId: uploadId,
    });
  }

  /**
   * ORD-9's PATCH half for a RESELLER STORE's re-upload (owner,
   * 2026-09-19).
   *
   * ── WHY IT GOES THROUGH `OrderService.edit` ──────────────────────────
   * `applyBulkPatch` — the seller's CSV patch — still refuses a reseller
   * order, and should: it re-snapshots the line from the LIVE catalogue
   * with no reseller terms, so the patched line would carry
   * `store_kind = RESELLER` with null term columns (which the table's own
   * CHECK refuses) and the money would have nothing to re-plan from.
   *
   * `edit` with a store scope is the SAME call the store's own portal
   * makes, so a CSV re-upload inherits every part of it rather than a
   * second implementation that would drift: the lifecycle-stage gate, the
   * address revalidation, `ResellerOrderRetermService` (a kept line keeps
   * its snapshotted transfer price and range — ORD-6; a line whose SKU
   * moved is priced from the store's catalogue and refused by name when
   * it has no price there), the money recalculated under the order's OWN
   * terms version through `ResellerOrderMoneyService`, and the notice to
   * the seller.
   *
   * ── WHAT THE SELLING-PRICE COLUMN MEANS HERE ────────────────────────
   * Exactly what it means at create: stated ⇒ used; absent ⇒ the line
   * keeps the retail it was PLACED at, or — only when the SKU moved and
   * there is nothing to keep — the seller's suggested retail for this
   * store; with neither, refused by name. That is the reterm service's
   * rule, not a second one written here.
   *
   * A row that changes nothing comes back as `NOTHING_TO_UPDATE`, which
   * is not an error on a re-upload: the same file uploaded twice is the
   * ordinary shape, and a counted failure there would make a clean import
   * read as a broken one.
   */
  private async patchStoreOrder(
    sellerId: string,
    storeId: string,
    storeUserId: string,
    orderId: string,
    row: CoercedOrderRow,
    ctx: { ipAddress: null; userAgent: null; requestId: string },
  ): Promise<void> {
    const resolved = await this.catalog.getVariantBySku(sellerId, row.productSku);
    if (!resolved || resolved.sellerId !== sellerId) {
      throw new Error(`Variant SKU "${row.productSku}" is not in this store's catalogue`);
    }
    const dto: UpdateOrderDto = {
      recipientName: row.customerName,
      recipientPhoneE164: row.customerPhone,
      recipientAddressLine1: row.addressLine1,
      recipientAddressLine2: row.addressLine2,
      recipientPostalCode: row.pinCode,
      items: [
        {
          variantId: resolved.variantId,
          quantity: row.quantity,
          // The RETAIL on a reseller order. Omitted, the reterm service
          // keeps what the line was placed at (or the catalogue's
          // suggestion for a line that is new to the order).
          ...(row.retailUnitPrice === undefined ? {} : { unitPriceInr: row.retailUnitPrice }),
        },
      ],
    };
    if (row.customerEmail !== undefined) dto.recipientEmail = row.customerEmail;
    if (row.landmark !== undefined) dto.recipientLandmark = row.landmark;
    // A row that omits city/state leaves the stored value alone, exactly
    // as the seller's own CSV patch does — `?? null` would blank a
    // locality the first upload got right.
    if (row.city !== undefined) dto.recipientCity = row.city;
    if (row.state !== undefined) dto.recipientStateProvince = row.state;
    if (row.codAmount !== undefined) dto.codAmountInr = row.codAmount;

    try {
      await this.orders.edit(
        sellerId,
        orderId,
        dto,
        { type: ActorType.STORE, id: storeUserId },
        ctx,
        { storeId },
      );
    } catch (err) {
      if (this.isNothingToUpdate(err)) return;
      throw err;
    }
  }

  /** The 400 `edit` answers with when a row changes nothing. */
  private isNothingToUpdate(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const res = (err as { response?: unknown }).response;
    if (typeof res !== 'object' || res === null) return false;
    return (res as { code?: unknown }).code === 'NOTHING_TO_UPDATE';
  }

  private async createOrder(
    sellerId: string,
    uploadId: string,
    row: CoercedOrderRow,
    actor: { type: ActorType; id: string },
    ctx: { ipAddress: null; userAgent: null; requestId: string },
  ): Promise<void> {
    const resolved = await this.catalog.getVariantBySku(sellerId, row.productSku);
    if (!resolved || resolved.sellerId !== sellerId) {
      throw new Error(`Variant SKU "${row.productSku}" not found for this seller`);
    }
    const isCod = row.codAmount !== undefined && row.codAmount > 0;
    const dto: CreateOrderDto = {
      sellerOrderRef: row.externalRef,
      recipientName: row.customerName,
      recipientPhoneE164: row.customerPhone,
      recipientAddressLine1: row.addressLine1,
      recipientAddressLine2: row.addressLine2,
      recipientPostalCode: row.pinCode,
      paymentMode: isCod ? PaymentMode.COD : PaymentMode.PREPAID,
      items: [{ variantId: resolved.variantId, quantity: row.quantity }],
    } as CreateOrderDto;
    if (row.customerEmail !== undefined) dto.recipientEmail = row.customerEmail;
    if (row.landmark !== undefined) dto.recipientLandmark = row.landmark;
    // Optional since the seller form stopped asking, but a CSV that DOES
    // carry them should still store them — and a supplied state is still
    // checked against ops.allowed_indian_states.
    if (row.city !== undefined) dto.recipientCity = row.city;
    if (row.state !== undefined) dto.recipientStateProvince = row.state;
    if (isCod && row.codAmount !== undefined) dto.codAmountInr = row.codAmount;

    await this.orders.create(sellerId, dto, actor, ctx, {
      source: OrderSource.BULK_UPLOAD,
      initialStatus: OrderStatus.PENDING_CONFIRMATION,
      bulkUploadId: uploadId,
    });
  }

  private toPatch(row: CoercedOrderRow): BulkOrderPatchInput {
    const patch: BulkOrderPatchInput = {
      productSku: row.productSku,
      quantity: row.quantity,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      pinCode: row.pinCode,
    };
    if (row.customerEmail !== undefined) patch.customerEmail = row.customerEmail;
    if (row.landmark !== undefined) patch.landmark = row.landmark;
    if (row.city !== undefined) patch.city = row.city;
    if (row.state !== undefined) patch.state = row.state;
    if (row.codAmount !== undefined) patch.codAmount = row.codAmount;
    return patch;
  }

  private async writeErrorReport(
    sourceKey: string,
    headers: string[],
    errorRows: ErrorRow[],
  ): Promise<string | null> {
    const key = orderErrorReportKeyFor(sourceKey);
    if (!key) return null;
    const outCols = ['row_number', 'error_field', 'error_reason', ...headers];
    const records = errorRows.map((er) => {
      const rec: Record<string, string> = {
        row_number: String(er.rowNumber),
        error_field: csvSafe(er.errorField),
        error_reason: csvSafe(er.errorReason),
      };
      for (const h of headers) rec[h] = csvSafe(er.original[h] ?? '');
      return rec;
    });
    const csv = Papa.unparse({ fields: outCols, data: records });
    await this.spaces.putObject(key, Buffer.from(csv, 'utf8'), 'text/csv');
    return key;
  }

  private async fail(uploadId: string, reason: string): Promise<void> {
    await this.prisma.client.bulkOrderUpload.update({
      where: { id: uploadId },
      data: { status: BulkUploadStatus.FAILED, completedAt: new Date() },
    });
    this.logger.warn({ uploadId, reason }, 'Order CSV import failed');
  }

  /**
   * The mapped cells, keyed by the field they map to.
   *
   * Deliberately the RAW values rather than the coerced ones: the row is
   * here because coercion failed, so what the seller needs to see and
   * edit is what their file actually said.
   */
  private mappedValues(
    raw: Record<string, string>,
    mapping: Partial<Record<string, string>>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [field, header] of Object.entries(mapping)) {
      if (typeof header === 'string' && header.length > 0) {
        out[field] = raw[header] ?? '';
      }
    }
    return out;
  }

  /** The duplicate 409's payload, or null if this was some other error. */
  private asDuplicate(err: unknown): unknown {
    if (typeof err !== 'object' || err === null) return null;
    const res = (err as { response?: unknown }).response;
    if (typeof res !== 'object' || res === null) return null;
    const body = res as { code?: unknown; details?: { existingOrders?: unknown } };
    if (body.code !== 'DUPLICATE_ORDER_SUSPECTED') return null;
    return body.details?.existingOrders ?? null;
  }
}
