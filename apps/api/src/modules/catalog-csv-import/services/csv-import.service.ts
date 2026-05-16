import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EnvService } from '../../../config/env.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { CsvParserService } from './csv-parser.service';
import {
  CSV_REQUIRED_FIELDS,
  type CsvTargetField,
} from '../csv-fields';
import { buildCsvKey, parseCsvKey } from '../csv-import-key';
import type { PresignCsvDto, PreviewCsvDto } from '../dto/csv-import.dto';

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

@Injectable()
export class CsvImportService {
  constructor(
    private readonly env: EnvService,
    private readonly spaces: SpacesService,
    private readonly parser: CsvParserService,
  ) {}

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

    // Merge a seller override (catalog field -> header) on top of
    // auto-detection. Only accept overrides that point at a real header.
    const mapping = { ...detected.mapping };
    if (input.mappingOverride) {
      for (const [field, header] of Object.entries(input.mappingOverride)) {
        if (parsed.headers.includes(header)) {
          mapping[field as CsvTargetField] = header;
        }
      }
    }
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
