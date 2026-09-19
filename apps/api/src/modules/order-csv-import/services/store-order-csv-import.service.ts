import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, BulkUploadStatus, type Prisma } from '@skydrop/db';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ORDER_CSV_STORE_REQUIRED_FIELDS, type OrderCsvField } from '../order-csv-fields';
import { buildStoreOrderCsvKey, parseStoreOrderCsvKey } from '../order-csv-key';
import { OrderCsvImportQueue } from '../queue/order-csv-import.queue';
import type {
  PresignOrderCsvDto,
  PreviewOrderCsvDto,
  ProcessOrderCsvDto,
} from '../dto/order-csv-import.dto';
import { OrderCsvParserService } from './order-csv-parser.service';
import type {
  BulkOrderUploadView,
  CsvPresignResult,
  OrderCsvPreviewResult,
} from './order-csv-import.service';

/**
 * The store's template: the seller's columns plus the SELLING PRICE.
 *
 * The column is offered but not REQUIRED (2026-09-19): a row that leaves
 * it blank is priced at the seller's suggested retail for this store. It
 * stays on the template because stating it is the common case and a
 * column nobody can see is a column nobody fills in.
 */
const STORE_TEMPLATE_COLUMNS: Array<[string, string]> = [
  ['Product SKU', 'TSHIRT-001-RED-M'],
  ['Quantity', '2'],
  ['Retail Price', '499'],
  ['Customer Name', 'Asha Verma'],
  ['Customer Phone', '+919876543210'],
  ['Customer Email', 'asha@example.com'],
  ['Address Line1', '12 MG Road'],
  ['Address Line2', 'Near City Hospital'],
  ['City', 'Bengaluru'],
  ['State', 'Karnataka'],
  ['Pin Code', '560001'],
  ['COD Amount', '998'],
  ['External Ref', 'STORE-ORD-1001'],
];

const UPLOAD_VIEW_SELECT = {
  id: true,
  fileName: true,
  status: true,
  rowCount: true,
  ordersCreated: true,
  rowsFailed: true,
  rowsSkipped: true,
  errorReportKey: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

type StoreUserRef = { readonly id: string; readonly storeId: string; readonly sellerId: string };

/**
 * RS-5 — a reseller store's order CSV, on the SAME machinery as a
 * seller's: the parser, the `order-csv-import` queue and worker, and the
 * processor, which places each row through `ResellerOrderService` (every
 * portal refusal applies). The upload row carries `reseller_store_id`, so
 * it is listed to this store only and never to the seller; its key sits
 * under the store's own prefix, so neither side can process the other's
 * file.
 */
@Injectable()
export class StoreOrderCsvImportService {
  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly parser: OrderCsvParserService,
    private readonly audit: AuditLogService,
    private readonly queue: OrderCsvImportQueue,
  ) {}

  buildTemplate(): string {
    const headers = STORE_TEMPLATE_COLUMNS.map(([h]) => h).join(',');
    const example = STORE_TEMPLATE_COLUMNS.map(([, v]) => (v.includes(',') ? `"${v}"` : v)).join(
      ',',
    );
    return `${headers}\n${example}\n`;
  }

  async presign(user: StoreUserRef, _input: PresignOrderCsvDto): Promise<CsvPresignResult> {
    const key = buildStoreOrderCsvKey(user.sellerId, user.storeId);
    const ttl = this.env.csvPresignTtlSeconds;
    const uploadUrl = await this.spaces.presignPutUrl(key, 'text/csv', ttl);
    return { spacesKey: key, uploadUrl, expiresInSeconds: ttl };
  }

  async preview(user: StoreUserRef, input: PreviewOrderCsvDto): Promise<OrderCsvPreviewResult> {
    const buffer = await this.loadOwnedCsv(user, input.spacesKey);
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = resolveMapping(parsed.headers, detected.mapping, input.mappingOverride);
    return {
      rowCount: parsed.rowCount,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 5),
      mapping,
      missingRequired: ORDER_CSV_STORE_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined),
      unmatchedHeaders: detected.unmatchedHeaders,
      exceedsRowLimit: parsed.rowCount > this.env.csvMaxRows,
      rowLimit: this.env.csvMaxRows,
    };
  }

  async createAndEnqueue(
    user: StoreUserRef,
    input: ProcessOrderCsvDto,
  ): Promise<BulkOrderUploadView> {
    const buffer = await this.loadOwnedCsv(user, input.spacesKey);
    const head = await this.spaces.headObject(input.spacesKey);
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = resolveMapping(parsed.headers, detected.mapping, input.mappingOverride);
    const missing = ORDER_CSV_STORE_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'MISSING_REQUIRED_MAPPING',
        message: `Cannot process: unmapped required field(s): ${missing.join(', ')}`,
      });
    }
    if (parsed.rowCount > this.env.csvMaxRows) {
      throw new BadRequestException({
        code: 'TOO_MANY_ROWS',
        message: `CSV has ${parsed.rowCount} rows; the limit is ${this.env.csvMaxRows}`,
      });
    }
    const created = await this.prisma.client.bulkOrderUpload.create({
      data: {
        sellerId: user.sellerId,
        resellerStoreId: user.storeId,
        uploadedByStoreUserId: user.id,
        fileName: input.fileName,
        spacesKey: input.spacesKey,
        fileSizeBytes: head?.size ?? buffer.byteLength,
        rowCount: parsed.rowCount,
        status: BulkUploadStatus.PENDING,
      },
      select: UPLOAD_VIEW_SELECT,
    });
    const jobId = await this.queue.enqueueProcess({ uploadId: created.id, mapping });
    await this.prisma.client.bulkOrderUpload.update({
      where: { id: created.id },
      data: { jobId },
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'order.csv_import.enqueued',
      entityType: 'bulk_order_upload',
      entityId: created.id,
      metadata: {
        fileName: input.fileName,
        rowCount: parsed.rowCount,
        jobId,
        resellerStoreId: user.storeId,
      },
    });
    return created;
  }

  async listUploads(
    storeId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: BulkOrderUploadView[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.BulkOrderUploadWhereInput = { resellerStoreId: storeId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.client.bulkOrderUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: UPLOAD_VIEW_SELECT,
      }),
      this.prisma.client.bulkOrderUpload.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getUpload(storeId: string, id: string): Promise<BulkOrderUploadView> {
    const row = await this.prisma.client.bulkOrderUpload.findFirst({
      where: { id, resellerStoreId: storeId, deletedAt: null },
      select: UPLOAD_VIEW_SELECT,
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Order CSV import not found',
      });
    }
    return row;
  }

  async getErrorReport(storeId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const upload = await this.prisma.client.bulkOrderUpload.findFirst({
      where: { id, resellerStoreId: storeId, deletedAt: null },
      select: { fileName: true, errorReportKey: true },
    });
    if (upload === null) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Order CSV import not found',
      });
    }
    if (upload.errorReportKey === null) {
      throw new NotFoundException({
        code: 'NO_ERROR_REPORT',
        message: 'This import has no error report (no failed rows)',
      });
    }
    const buffer = await this.spaces.getObject(upload.errorReportKey);
    if (!buffer) {
      throw new NotFoundException({
        code: 'ERROR_REPORT_UNREADABLE',
        message: 'Error report could not be read from storage',
      });
    }
    return { buffer, fileName: `${upload.fileName.replace(/\.csv$/i, '')}-errors.csv` };
  }

  /** The key must be THIS store's (not merely this seller's) and the file must exist. */
  private async loadOwnedCsv(user: StoreUserRef, spacesKey: string): Promise<Buffer> {
    const parsed = parseStoreOrderCsvKey(spacesKey);
    if (parsed === null) {
      throw new BadRequestException({
        code: 'INVALID_CSV_KEY',
        message: 'spacesKey does not match the store order-imports layout',
      });
    }
    if (parsed.storeId !== user.storeId || parsed.sellerId !== user.sellerId) {
      throw new ForbiddenException({
        code: 'KEY_OWNERSHIP_MISMATCH',
        message: 'spacesKey does not belong to this store',
      });
    }
    const head = await this.spaces.headObject(spacesKey);
    const buffer = head === null ? null : await this.spaces.getObject(spacesKey);
    if (!buffer) {
      throw new BadRequestException({
        code: 'OBJECT_NOT_FOUND',
        message: 'No uploaded CSV found at spacesKey — upload before preview/process',
      });
    }
    return buffer;
  }
}

function resolveMapping(
  headers: string[],
  detected: Partial<Record<OrderCsvField, string>>,
  override: Record<string, string> | undefined,
): Partial<Record<OrderCsvField, string>> {
  const mapping = { ...detected };
  if (override) {
    for (const [field, header] of Object.entries(override)) {
      if (headers.includes(header)) mapping[field as OrderCsvField] = header;
    }
  }
  return mapping;
}
