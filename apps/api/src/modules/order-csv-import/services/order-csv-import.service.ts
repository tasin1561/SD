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
import { OrderCsvParserService } from './order-csv-parser.service';
import { ORDER_CSV_REQUIRED_FIELDS, type OrderCsvField } from '../order-csv-fields';
import { buildOrderCsvKey, parseOrderCsvKey, xlsxReportKeyFor } from '../order-csv-key';
import { OrderCsvImportQueue } from '../queue/order-csv-import.queue';
import type {
  PresignOrderCsvDto,
  PreviewOrderCsvDto,
  ProcessOrderCsvDto,
} from '../dto/order-csv-import.dto';
import { buildTemplateXlsx, XLSX_CONTENT_TYPE } from '../order-xlsx';
import { CSV_TEMPLATE_PREFIX } from '../../../common/text/csv-separator-hint';

const CSV_PRESIGN_CONTENT_TYPE = 'text/csv';

/** The content type a presigned PUT is signed for: the file name decides, the bytes are re-checked on read. */
export function presignContentType(input: PresignOrderCsvDto): string {
  return /\.xlsx$/i.test(input.fileName) ? XLSX_CONTENT_TYPE : CSV_PRESIGN_CONTENT_TYPE;
}

/**
 * The order template, exactly as the owner supplied it (2026-10-27).
 *
 * The column names are THEIRS and are not to be tidied: `Customer Email(Optional)`
 * and `Advanced Amount(Optional)` keep their suffix, which the importer strips
 * on read (`normalizeHeader`). Several columns are ones we deliberately do not
 * use (`ORDER_CSV_IGNORED_HEADERS`); they stay so a seller sees the same sheet
 * their courier hands them.
 *
 * `SD-1003` carries two rows: one order, two lines (ORD-9). `SD-1002` is
 * Prepaid with an empty COD Amount; `SD-1003` states its COD on both rows.
 */
export const TEMPLATE_HEADERS: readonly string[] = [
  'Order ID',
  'Payment Mode',
  'Pickup Location',
  'Transport Mode',
  'Customer Name',
  'Customer Phone',
  'Customer Email(Optional)',
  'Address Line1',
  'Address Line2',
  'City',
  'State',
  'Pin Code',
  'Product SKU',
  'Quantity',
  'Unit Price',
  'Advanced Amount(Optional)',
  'COD Amount',
  'Packaging Type',
  'Length (cm)',
  'Breadth (cm)',
  'Height (cm)',
  'Volumetric Product Weight (gm)',
  'Billing Address same as Shipping Address',
  'Billing Address Line1',
  'Billing Address Line2',
  'Billing City',
  'Billing State',
  'Billing Pincode',
];

export const TEMPLATE_ROWS: ReadonlyArray<readonly string[]> = [
  [
    'SD-1001',
    'COD',
    'Skydrop',
    'Surface',
    'Asha Verma',
    '9876543210',
    'asha@example.com',
    '12 MG Road',
    'Near City Hospital',
    'Bengaluru',
    'Karnataka',
    '560001',
    'TSHIRT-001-RED-M',
    '1',
    '1500',
    '',
    '1500',
    'Flyer',
    '18',
    '13',
    '3',
    '170',
    'YES',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'SD-1002',
    'Prepaid',
    'Skydrop',
    'Surface',
    'Rahul Nair',
    '9812345678',
    'rahul@example.com',
    '44 Linking Road',
    'Opposite Bata Showroom',
    'Mumbai',
    'Maharashtra',
    '400050',
    'CAP-001-NAVY',
    '2',
    '850',
    '',
    '',
    'Flyer',
    '15',
    '10',
    '5',
    '110',
    'YES',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'SD-1003',
    'COD',
    'Skydrop',
    'Surface',
    'Priya Menon',
    '9700112233',
    'priya@example.com',
    '8 Residency Road',
    'Beside Jyothi Theatre',
    'Kochi',
    'Kerala',
    '682016',
    'TSHIRT-001-RED-M',
    '1',
    '1500',
    '',
    '2350',
    'Flyer',
    '18',
    '13',
    '3',
    '170',
    'YES',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'SD-1003',
    'COD',
    'Skydrop',
    'Surface',
    'Priya Menon',
    '9700112233',
    'priya@example.com',
    '8 Residency Road',
    'Beside Jyothi Theatre',
    'Kochi',
    'Kerala',
    '682016',
    'CAP-001-NAVY',
    '1',
    '850',
    '',
    '2350',
    'Flyer',
    '15',
    '10',
    '5',
    '110',
    'YES',
    '',
    '',
    '',
    '',
    '',
  ],
];

/** `[header, sample row 1, sample row 2, …]` per column — derived, never restated. */
export const TEMPLATE_COLUMNS: Array<[string, ...string[]]> = TEMPLATE_HEADERS.map((h, i) => [
  h,
  ...TEMPLATE_ROWS.map((r) => r[i] ?? ''),
]);

export interface CsvPresignResult {
  spacesKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface OrderCsvPreviewResult {
  rowCount: number;
  /**
   * How many ORDERS those rows make. Rows sharing a reference are lines
   * of one order (ORD-9), so "50 rows" and "43 orders" are both true and
   * only one of them is what gets placed.
   */
  orderCount: number;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  mapping: Partial<Record<OrderCsvField, string>>;
  missingRequired: OrderCsvField[];
  unmatchedHeaders: Array<{ header: string; suggestion: OrderCsvField | null }>;
  /** Columns we recognise and deliberately do not use, with the reason. */
  ignoredHeaders: Array<{ header: string; reason: string }>;
  /**
   * Rows this file would FAIL on, found by running the importer's own
   * grouping over the whole file rather than guessing from the headers.
   *
   * Column mapping was the only thing preview ever checked, and that is
   * not what a file from another system gets wrong: Delhivery's template
   * maps every required column and then leaves `Shipping Address Line2`
   * — our landmark, required — empty on most rows, so the upload
   * previewed perfectly and failed every row. A preview that cannot see
   * that is not honest about what pressing Import will do.
   */
  rowsWithProblems: number;
  problems: Array<{ rowNumber: number; field: string; reason: string }>;
  exceedsRowLimit: boolean;
  rowLimit: number;
}

/** At most this many problem rows come back — it is a warning, not the report. */
const PREVIEW_PROBLEM_LIMIT = 10;

export interface BulkOrderUploadView {
  id: string;
  fileName: string;
  status: BulkUploadStatus;
  rowCount: number;
  ordersCreated: number;
  rowsFailed: number;
  rowsSkipped: number;
  errorReportKey: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

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

/**
 * Order CSV import — presign / template / preview / enqueue / status /
 * error-report. Backed by `bulk_order_uploads`. Mirrors the Module-4
 * CsvImportService; no saved-mapping CRUD in Phase 1A (mappingOverride
 * only). The row processor + worker land in commits 19–20.
 */
@Injectable()
export class OrderCsvImportService {
  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly parser: OrderCsvParserService,
    private readonly audit: AuditLogService,
    private readonly queue: OrderCsvImportQueue,
  ) {}

  /** The same sheet as the CSV, as `.xlsx`, with the phone column formatted as Text. */
  buildTemplateXlsx(): Promise<Buffer> {
    return buildTemplateXlsx(TEMPLATE_HEADERS, TEMPLATE_ROWS);
  }

  buildTemplate(): string {
    const cell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const line = (cells: readonly string[]): string => cells.map(cell).join(',');
    return `${CSV_TEMPLATE_PREFIX}${[TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map(line).join('\n')}\n`;
  }

  async presign(sellerId: string, input: PresignOrderCsvDto): Promise<CsvPresignResult> {
    const key = buildOrderCsvKey(sellerId);
    const ttl = this.env.csvPresignTtlSeconds;
    const uploadUrl = await this.spaces.presignPutUrl(key, presignContentType(input), ttl);
    return { spacesKey: key, uploadUrl, expiresInSeconds: ttl };
  }

  private resolveMapping(
    headers: string[],
    detected: Partial<Record<OrderCsvField, string>>,
    override: Record<string, string> | undefined,
  ): Partial<Record<OrderCsvField, string>> {
    const mapping = { ...detected };
    if (override) {
      for (const [field, header] of Object.entries(override)) {
        if (headers.includes(header)) {
          mapping[field as OrderCsvField] = header;
        }
      }
    }
    return mapping;
  }

  async preview(sellerId: string, input: PreviewOrderCsvDto): Promise<OrderCsvPreviewResult> {
    const buffer = await this.loadOwnedCsv(sellerId, input.spacesKey);
    const parsed = await this.parser.parseUpload(buffer, this.env.csvMaxRows);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = this.resolveMapping(parsed.headers, detected.mapping, input.mappingOverride);
    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    const dry = this.parser.groupRows(parsed.rows, mapping);
    return {
      rowCount: parsed.rowCount,
      orderCount: dry.groups.length,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 5),
      mapping,
      missingRequired,
      unmatchedHeaders: detected.unmatchedHeaders,
      ignoredHeaders: detected.ignoredHeaders,
      rowsWithProblems: dry.rowErrors.length,
      problems: dry.rowErrors.slice(0, PREVIEW_PROBLEM_LIMIT).map((r) => ({
        rowNumber: r.rowNumber,
        field: r.errors[0]?.field ?? '',
        reason: r.errors[0]?.reason ?? 'This row could not be read',
      })),
      exceedsRowLimit: parsed.rowCount > this.env.csvMaxRows,
      rowLimit: this.env.csvMaxRows,
    };
  }

  /**
   * Create the BulkOrderUpload row and enqueue the process job. Rejects
   * up front if a required field is unmapped or the row count exceeds
   * the limit — no point queuing a doomed job.
   */
  async createAndEnqueue(
    sellerId: string,
    input: ProcessOrderCsvDto,
    actor: { type: ActorType; sellerId?: string; staffId?: string },
  ): Promise<BulkOrderUploadView> {
    const buffer = await this.loadOwnedCsv(sellerId, input.spacesKey);
    const head = await this.spaces.headObject(input.spacesKey);
    const parsed = await this.parser.parseUpload(buffer, this.env.csvMaxRows);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = this.resolveMapping(parsed.headers, detected.mapping, input.mappingOverride);

    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    if (missingRequired.length > 0) {
      throw new BadRequestException({
        code: 'MISSING_REQUIRED_MAPPING',
        message: `Cannot process: unmapped required field(s): ${missingRequired.join(', ')}`,
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
        sellerId,
        fileName: input.fileName,
        spacesKey: input.spacesKey,
        fileSizeBytes: head?.size ?? buffer.byteLength,
        rowCount: parsed.rowCount,
        status: BulkUploadStatus.PENDING,
        uploadedBySellerId: actor.sellerId ?? null,
        uploadedByStaffId: actor.staffId ?? null,
      },
      select: UPLOAD_VIEW_SELECT,
    });

    const jobId = await this.queue.enqueueProcess({
      uploadId: created.id,
      mapping,
    });
    await this.prisma.client.bulkOrderUpload.update({
      where: { id: created.id },
      data: { jobId },
    });

    await this.audit.log({
      actorType: actor.type,
      sellerId,
      action: 'order.csv_import.enqueued',
      entityType: 'bulk_order_upload',
      entityId: created.id,
      metadata: { fileName: input.fileName, rowCount: parsed.rowCount, jobId },
    });

    return this.toView(created);
  }

  async listUploads(
    sellerId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: BulkOrderUploadView[]; total: number; page: number; pageSize: number }> {
    // RS-5: the seller's OWN uploads — never a reseller store's, whose rows
    // are the store's customers.
    const where: Prisma.BulkOrderUploadWhereInput = {
      sellerId,
      resellerStoreId: null,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.bulkOrderUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: UPLOAD_VIEW_SELECT,
      }),
      this.prisma.client.bulkOrderUpload.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  async getUpload(sellerId: string, id: string): Promise<BulkOrderUploadView> {
    const row = await this.prisma.client.bulkOrderUpload.findFirst({
      where: { id, sellerId, resellerStoreId: null, deletedAt: null },
      select: UPLOAD_VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Order CSV import not found',
      });
    }
    return this.toView(row);
  }

  async getErrorReport(
    sellerId: string,
    id: string,
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const upload = await this.prisma.client.bulkOrderUpload.findFirst({
      where: { id, sellerId, resellerStoreId: null, deletedAt: null },
      select: { id: true, fileName: true, errorReportKey: true },
    });
    if (!upload) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Order CSV import not found',
      });
    }
    if (!upload.errorReportKey) {
      throw new NotFoundException({
        code: 'NO_ERROR_REPORT',
        message: 'This import has no error report (no failed rows)',
      });
    }
    const base = upload.fileName.replace(/\.(csv|xlsx)$/i, '');
    // The `.xlsx` report sits beside the CSV one; an import that predates it
    // simply has none, and the CSV is returned instead rather than a 404.
    if (format === 'xlsx') {
      const x = await this.spaces.getObject(xlsxReportKeyFor(upload.errorReportKey));
      if (x) return { buffer: x, fileName: `${base}-errors.xlsx`, contentType: XLSX_CONTENT_TYPE };
    }
    const buffer = await this.spaces.getObject(upload.errorReportKey);
    if (!buffer) {
      throw new NotFoundException({
        code: 'ERROR_REPORT_UNREADABLE',
        message: 'Error report could not be read from storage',
      });
    }
    return { buffer, fileName: `${base}-errors.csv`, contentType: 'text/csv; charset=utf-8' };
  }

  async loadOwnedCsv(sellerId: string, spacesKey: string): Promise<Buffer> {
    const parsed = parseOrderCsvKey(spacesKey);
    if (!parsed) {
      throw new BadRequestException({
        code: 'INVALID_CSV_KEY',
        message: 'spacesKey does not match the expected order-imports layout',
      });
    }
    if (parsed.sellerId !== sellerId) {
      throw new ForbiddenException({
        code: 'KEY_OWNERSHIP_MISMATCH',
        message: 'spacesKey does not belong to the authenticated client',
      });
    }
    const head = await this.spaces.headObject(spacesKey);
    if (!head) {
      throw new BadRequestException({
        code: 'OBJECT_NOT_FOUND',
        message: 'No uploaded CSV found at spacesKey — upload before preview/process',
      });
    }
    /*
      Size before download — CSV_MAX_ROWS is judged after parsing, so
      without this the object is buffered and fully parsed before anything
      says it was too big, in the process that also serves HTTP and runs
      every BullMQ worker (SCALE-1). This helper is the choke point for
      preview and `createAndEnqueue`, so an oversized object never gets an
      upload row and the worker never meets one.
    */
    if (head.size > this.env.csvMaxBytes) {
      throw new BadRequestException({
        code: 'CSV_TOO_LARGE',
        message: `Uploaded CSV is ${head.size} bytes; the limit is ${this.env.csvMaxBytes}`,
      });
    }
    const buffer = await this.spaces.getObject(spacesKey);
    if (!buffer) {
      throw new BadRequestException({
        code: 'OBJECT_UNREADABLE',
        message: 'Uploaded CSV could not be read from storage',
      });
    }
    return buffer;
  }

  private toView(r: BulkOrderUploadView): BulkOrderUploadView {
    return {
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      rowCount: r.rowCount,
      ordersCreated: r.ordersCreated,
      rowsFailed: r.rowsFailed,
      rowsSkipped: r.rowsSkipped,
      errorReportKey: r.errorReportKey,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }
}
