import { Injectable, Logger } from '@nestjs/common';
import { ActorType, BulkUploadStatus, OrderSource, OrderStatus, PaymentMode } from '@skydrop/db';
import Papa from 'papaparse';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import {
  OrderService,
  type BulkOrderPatchInput,
} from '../../order/services/order.service';
import type { CreateOrderDto } from '../../order/dto/create-order.dto';
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
  ) {}

  async process(
    uploadId: string,
    mapping: Partial<Record<OrderCsvField, string>>,
  ): Promise<void> {
    const upload = await this.prisma.client.bulkOrderUpload.findUnique({
      where: { id: uploadId },
      select: { id: true, sellerId: true, spacesKey: true, status: true },
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

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      if (!raw) continue;
      const rowNumber = i + 2; // 1 header + 1-based

      const { row, errors } = this.parser.coerceRow(raw, mapping);
      if (!row || errors.length > 0) {
        for (const e of errors) {
          errorRows.push({ rowNumber, errorField: e.field ?? '', errorReason: e.reason, original: raw });
        }
        counters.rowsFailed += 1;
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
        errorRows.push({
          rowNumber,
          errorField: '',
          errorReason: err instanceof Error ? err.message : 'Unexpected error importing row',
          original: raw,
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
      actorType: ActorType.SELLER,
      sellerId,
      action: 'order.csv_import.processed',
      entityType: 'bulk_order_upload',
      entityId: uploadId,
      metadata: { status, ...counters, rowCount: parsed.rowCount },
    });
  }

  // ── internal ──────────────────────────────────────────────────────

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
      recipientCity: row.city,
      recipientStateProvince: row.state,
      recipientPostalCode: row.pinCode,
      paymentMode: isCod ? PaymentMode.COD : PaymentMode.PREPAID,
      items: [{ variantId: resolved.variantId, quantity: row.quantity }],
    } as CreateOrderDto;
    if (row.customerEmail !== undefined) dto.recipientEmail = row.customerEmail;
    if (row.addressLine2 !== undefined) dto.recipientAddressLine2 = row.addressLine2;
    if (row.landmark !== undefined) dto.recipientLandmark = row.landmark;
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
      city: row.city,
      state: row.state,
      pinCode: row.pinCode,
    };
    if (row.customerEmail !== undefined) patch.customerEmail = row.customerEmail;
    if (row.addressLine2 !== undefined) patch.addressLine2 = row.addressLine2;
    if (row.landmark !== undefined) patch.landmark = row.landmark;
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
}
