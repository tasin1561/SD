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
import { buildOrderCsvKey, parseOrderCsvKey } from '../order-csv-key';
import { OrderCsvImportQueue } from '../queue/order-csv-import.queue';
import type {
  PresignOrderCsvDto,
  PreviewOrderCsvDto,
  ProcessOrderCsvDto,
} from '../dto/order-csv-import.dto';

const CSV_PRESIGN_CONTENT_TYPE = 'text/csv';

/** Canonical template columns (header → example value). */
const TEMPLATE_COLUMNS: Array<[string, string]> = [
  ['Product SKU', 'TSHIRT-001-RED-M'],
  ['Quantity', '2'],
  ['Customer Name', 'Asha Verma'],
  ['Customer Phone', '+919876543210'],
  ['Customer Email', 'asha@example.com'],
  ['Address Line1', '12 MG Road'],
  ['Address Line2', 'Near Metro'],
  ['Landmark', 'Opp. City Mall'],
  ['City', 'Bengaluru'],
  ['State', 'Karnataka'],
  ['Pin Code', '560001'],
  ['COD Amount', '999'],
  ['External Ref', 'SELLER-ORD-1001'],
];

export interface CsvPresignResult {
  spacesKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface OrderCsvPreviewResult {
  rowCount: number;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  mapping: Partial<Record<OrderCsvField, string>>;
  missingRequired: OrderCsvField[];
  unmatchedHeaders: Array<{ header: string; suggestion: OrderCsvField | null }>;
  exceedsRowLimit: boolean;
  rowLimit: number;
}

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

  buildTemplate(): string {
    const headers = TEMPLATE_COLUMNS.map(([h]) => h).join(',');
    const example = TEMPLATE_COLUMNS.map(([, v]) =>
      v.includes(',') ? `"${v}"` : v,
    ).join(',');
    return `${headers}\n${example}\n`;
  }

  async presign(
    sellerId: string,
    _input: PresignOrderCsvDto,
  ): Promise<CsvPresignResult> {
    const key = buildOrderCsvKey(sellerId);
    const ttl = this.env.csvPresignTtlSeconds;
    const uploadUrl = await this.spaces.presignPutUrl(
      key,
      CSV_PRESIGN_CONTENT_TYPE,
      ttl,
    );
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

  async preview(
    sellerId: string,
    input: PreviewOrderCsvDto,
  ): Promise<OrderCsvPreviewResult> {
    const buffer = await this.loadOwnedCsv(sellerId, input.spacesKey);
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = this.resolveMapping(
      parsed.headers,
      detected.mapping,
      input.mappingOverride,
    );
    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter(
      (f) => mapping[f] === undefined,
    );
    return {
      rowCount: parsed.rowCount,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 5),
      mapping,
      missingRequired,
      unmatchedHeaders: detected.unmatchedHeaders,
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
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);
    const mapping = this.resolveMapping(
      parsed.headers,
      detected.mapping,
      input.mappingOverride,
    );

    const missingRequired = ORDER_CSV_REQUIRED_FIELDS.filter(
      (f) => mapping[f] === undefined,
    );
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
    const where: Prisma.BulkOrderUploadWhereInput = { sellerId, deletedAt: null };
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
      where: { id, sellerId, deletedAt: null },
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
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const upload = await this.prisma.client.bulkOrderUpload.findFirst({
      where: { id, sellerId, deletedAt: null },
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
    const buffer = await this.spaces.getObject(upload.errorReportKey);
    if (!buffer) {
      throw new NotFoundException({
        code: 'ERROR_REPORT_UNREADABLE',
        message: 'Error report could not be read from storage',
      });
    }
    const base = upload.fileName.replace(/\.csv$/i, '');
    return { buffer, fileName: `${base}-errors.csv` };
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
        message: 'spacesKey does not belong to the authenticated seller',
      });
    }
    const head = await this.spaces.headObject(spacesKey);
    if (!head) {
      throw new BadRequestException({
        code: 'OBJECT_NOT_FOUND',
        message: 'No uploaded CSV found at spacesKey — upload before preview/process',
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
