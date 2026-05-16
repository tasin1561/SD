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
import { CsvParserService } from './csv-parser.service';
import {
  CSV_REQUIRED_FIELDS,
  type CsvTargetField,
} from '../csv-fields';
import { buildCsvKey, parseCsvKey } from '../csv-import-key';
import { CsvImportQueue } from '../queue/csv-import.queue';
import { CsvMappingService } from './csv-mapping.service';
import type {
  PresignCsvDto,
  PreviewCsvDto,
  ProcessCsvDto,
} from '../dto/csv-import.dto';

const CSV_PRESIGN_CONTENT_TYPE = 'text/csv';

/** Canonical template columns (header → example value). */
const TEMPLATE_COLUMNS: Array<[string, string]> = [
  ['Product Name', 'Classic T-Shirt'],
  ['Product ID', 'TSHIRT-001'],
  ['SKU', 'TSHIRT-001-RED-M'],
  ['Weight (g)', '200'],
  ['Length (cm)', '25'],
  ['Width (cm)', '20'],
  ['Height (cm)', '2'],
  ['Declared Value', '499'],
  ['HS Code', '6109'],
  ['Barcode', '8901234567890'],
  ['Attributes', 'color=Red;size=M'],
  ['Category Slug', 't-shirts'],
];

export interface CsvPresignResult {
  spacesKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface CsvPreviewResult {
  rowCount: number;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
  mapping: Partial<Record<CsvTargetField, string>>;
  missingRequired: CsvTargetField[];
  unmatchedHeaders: Array<{ header: string; suggestion: CsvTargetField | null }>;
  exceedsRowLimit: boolean;
  rowLimit: number;
}

export interface BulkUploadView {
  id: string;
  fileName: string;
  status: BulkUploadStatus;
  rowCount: number | null;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
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
  productsCreated: true,
  productsUpdated: true,
  variantsCreated: true,
  variantsUpdated: true,
  rowsFailed: true,
  rowsSkipped: true,
  errorReportKey: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class CsvImportService {
  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly parser: CsvParserService,
    private readonly audit: AuditLogService,
    private readonly queue: CsvImportQueue,
    private readonly mappings: CsvMappingService,
  ) {}

  /**
   * Effective mapping precedence (lowest → highest):
   * auto-detection < saved mapping (mappingId) < explicit mappingOverride.
   * A layer only sets a field if the target header actually exists in the
   * uploaded CSV, so a stale saved mapping can't point at a missing column.
   * Throws 404 if mappingId is given but doesn't belong to the seller.
   */
  private async resolveMapping(
    sellerId: string,
    headers: string[],
    detected: Partial<Record<CsvTargetField, string>>,
    mappingId: string | undefined,
    override: Record<string, string> | undefined,
  ): Promise<Partial<Record<CsvTargetField, string>>> {
    const mapping = { ...detected };
    const apply = (pairs: Record<string, string>): void => {
      for (const [field, header] of Object.entries(pairs)) {
        if (headers.includes(header)) {
          mapping[field as CsvTargetField] = header;
        }
      }
    };
    if (mappingId) {
      apply(await this.mappings.resolveColumnMap(sellerId, mappingId));
    }
    if (override) apply(override);
    return mapping;
  }

  /** A ready-to-fill CSV with canonical headers + one example row. */
  buildTemplate(): string {
    const headers = TEMPLATE_COLUMNS.map(([h]) => h).join(',');
    const example = TEMPLATE_COLUMNS.map(([, v]) =>
      v.includes(',') ? `"${v}"` : v,
    ).join(',');
    return `${headers}\n${example}\n`;
  }

  async presign(sellerId: string, _input: PresignCsvDto): Promise<CsvPresignResult> {
    const key = buildCsvKey(sellerId);
    const ttl = this.env.csvPresignTtlSeconds;
    const uploadUrl = await this.spaces.presignPutUrl(
      key,
      CSV_PRESIGN_CONTENT_TYPE,
      ttl,
    );
    return { spacesKey: key, uploadUrl, expiresInSeconds: ttl };
  }

  async preview(
    sellerId: string,
    input: PreviewCsvDto,
  ): Promise<CsvPreviewResult> {
    const buffer = await this.loadOwnedCsv(sellerId, input.spacesKey);
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);

    const mapping = await this.resolveMapping(
      sellerId,
      parsed.headers,
      detected.mapping,
      input.mappingId,
      input.mappingOverride,
    );
    const missingRequired = CSV_REQUIRED_FIELDS.filter(
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
   * Create the BulkProductUpload row and enqueue the process job. The
   * resolved (auto-detect + override) mapping is computed here and
   * carried in the job payload. Rejects up front if required fields
   * (productName, variantSkuCode) are unmapped or the row count exceeds
   * the limit — no point queuing a doomed job.
   */
  async createAndEnqueue(
    sellerId: string,
    input: ProcessCsvDto,
  ): Promise<BulkUploadView> {
    const buffer = await this.loadOwnedCsv(sellerId, input.spacesKey);
    const head = await this.spaces.headObject(input.spacesKey);
    const parsed = this.parser.parse(buffer);
    const detected = this.parser.detectMapping(parsed.headers);

    const mapping = await this.resolveMapping(
      sellerId,
      parsed.headers,
      detected.mapping,
      input.mappingId,
      input.mappingOverride,
    );
    const missingRequired = CSV_REQUIRED_FIELDS.filter(
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

    const created = await this.prisma.client.bulkProductUpload.create({
      data: {
        sellerId,
        mappingId: input.mappingId ?? null,
        fileName: input.fileName,
        spacesKey: input.spacesKey,
        fileSizeBytes: head?.size ?? buffer.byteLength,
        rowCount: parsed.rowCount,
        status: BulkUploadStatus.PENDING,
        uploadedBySellerId: sellerId,
      },
      select: { ...UPLOAD_VIEW_SELECT, sellerId: true },
    });
    if (input.mappingId) {
      await this.mappings.markUsed(sellerId, input.mappingId);
    }

    const jobId = await this.queue.enqueueProcess({
      uploadId: created.id,
      mapping,
    });
    await this.prisma.client.bulkProductUpload.update({
      where: { id: created.id },
      data: { jobId },
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'catalog.csv_import.enqueued',
      entityType: 'bulk_product_upload',
      entityId: created.id,
      metadata: { fileName: input.fileName, rowCount: parsed.rowCount, jobId },
    });

    return this.toView(created);
  }

  async listUploads(
    sellerId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: BulkUploadView[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.BulkProductUploadWhereInput = { sellerId };
    const [rows, total] = await Promise.all([
      this.prisma.client.bulkProductUpload.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: UPLOAD_VIEW_SELECT,
      }),
      this.prisma.client.bulkProductUpload.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  async getUpload(sellerId: string, id: string): Promise<BulkUploadView> {
    const row = await this.prisma.client.bulkProductUpload.findFirst({
      where: { id, sellerId },
      select: UPLOAD_VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'CSV import not found',
      });
    }
    return this.toView(row);
  }

  private toView(r: BulkUploadView): BulkUploadView {
    return {
      id: r.id,
      fileName: r.fileName,
      status: r.status,
      rowCount: r.rowCount,
      productsCreated: r.productsCreated,
      productsUpdated: r.productsUpdated,
      variantsCreated: r.variantsCreated,
      variantsUpdated: r.variantsUpdated,
      rowsFailed: r.rowsFailed,
      rowsSkipped: r.rowsSkipped,
      errorReportKey: r.errorReportKey,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }

  /**
   * Stream the generated error-report CSV for a seller's import. Streamed
   * through the API (not a presigned URL) so it works identically in
   * mock and real Spaces. 404 if the import has no error report.
   */
  async getErrorReport(
    sellerId: string,
    id: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const upload = await this.prisma.client.bulkProductUpload.findFirst({
      where: { id, sellerId },
      select: { id: true, fileName: true, errorReportKey: true },
    });
    if (!upload) {
      throw new NotFoundException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'CSV import not found',
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

  /**
   * HEAD-checks + downloads a CSV the seller owns. Strict key ownership:
   * the key's seller segment must equal the authenticated seller.
   */
  async loadOwnedCsv(sellerId: string, spacesKey: string): Promise<Buffer> {
    const parsed = parseCsvKey(spacesKey);
    if (!parsed) {
      throw new BadRequestException({
        code: 'INVALID_CSV_KEY',
        message: 'spacesKey does not match the expected csv-imports layout',
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
}
