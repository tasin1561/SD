import { Injectable, Logger } from '@nestjs/common';
import { ActorType, BulkUploadStatus, Prisma } from '@skydrop/db';
import Papa from 'papaparse';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { AttributeResolutionService } from '../../catalog-attribute/services/attribute-resolution.service';
import { VariantAttributeValidatorService } from '../../catalog-variant/services/variant-attribute-validator.service';
import { CsvParserService, type CoercedVariantRow } from './csv-parser.service';
import type { CsvTargetField } from '../csv-fields';
import { errorReportKeyFor } from '../csv-import-key';

interface ErrorRow {
  rowNumber: number;
  errorField: string;
  errorReason: string;
  original: Record<string, string>;
}

function num(n: number | undefined): Prisma.Decimal | null | undefined {
  return n === undefined ? undefined : new Prisma.Decimal(n);
}

/** CSV-injection hygiene for values we write back into the error report. */
function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

@Injectable()
export class CsvImportProcessorService {
  private readonly logger = new Logger(CsvImportProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly parser: CsvParserService,
    private readonly resolution: AttributeResolutionService,
    private readonly validator: VariantAttributeValidatorService,
  ) {}

  /**
   * Process an uploaded CSV. Per-row, idempotent (PATCH semantics):
   *  - variant dedup by (sellerId, skuCode); product dedup by
   *    (sellerId, externalRef) — variant-first so a re-upload never
   *    orphans a product.
   *  - identical re-upload ⇒ no diff ⇒ row counted as skipped.
   *  - any row that fails coercion / category / attribute validation is
   *    written to an error-report CSV; other rows still import (partial
   *    success ⇒ COMPLETED_WITH_ERRORS).
   * Each row commits in its own transaction so a failing row never
   * half-writes.
   */
  async process(uploadId: string, mapping: Partial<Record<CsvTargetField, string>>): Promise<void> {
    const upload = await this.prisma.client.bulkProductUpload.findUnique({
      where: { id: uploadId },
      select: { id: true, sellerId: true, spacesKey: true, status: true },
    });
    if (!upload) {
      this.logger.warn({ uploadId }, 'CSV upload row not found; skipping');
      return;
    }
    if (
      upload.status === BulkUploadStatus.COMPLETED ||
      upload.status === BulkUploadStatus.COMPLETED_WITH_ERRORS
    ) {
      return; // already terminal — idempotent against duplicate jobs
    }

    await this.prisma.client.bulkProductUpload.update({
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

    const counters = {
      productsCreated: 0,
      productsUpdated: 0,
      variantsCreated: 0,
      variantsUpdated: 0,
      rowsFailed: 0,
      rowsSkipped: 0,
    };
    const errorRows: ErrorRow[] = [];
    const categoryCache = new Map<string, { id: string } | null>();

    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      if (!raw) continue;
      const rowNumber = i + 2; // 1 header line + 1-based data row

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
        counters.rowsFailed += 1;
        continue;
      }

      // Resolve category by slug (cached per run).
      let categoryId: string | null = null;
      if (row.categorySlug) {
        let cat = categoryCache.get(row.categorySlug);
        if (cat === undefined) {
          cat = await this.prisma.client.category.findFirst({
            where: { slug: row.categorySlug, deletedAt: null },
            select: { id: true },
          });
          categoryCache.set(row.categorySlug, cat);
        }
        if (!cat) {
          errorRows.push({
            rowNumber,
            errorField: 'categorySlug',
            errorReason: `Category slug "${row.categorySlug}" not found`,
            original: raw,
          });
          counters.rowsFailed += 1;
          continue;
        }
        categoryId = cat.id;
      }

      // Validate attributes against the category's effective schema.
      const effective = categoryId
        ? await this.resolution.resolveEffectiveAttributes(categoryId)
        : [];
      const attrErrors = this.validator.collect(effective, row.attributes ?? {});
      if (attrErrors.length > 0) {
        for (const reason of attrErrors) {
          errorRows.push({
            rowNumber,
            errorField: 'attributes',
            errorReason: reason,
            original: raw,
          });
        }
        counters.rowsFailed += 1;
        continue;
      }

      try {
        const outcome = await this.upsertRow(sellerId, categoryId, row);
        counters.productsCreated += outcome.productCreated ? 1 : 0;
        counters.productsUpdated += outcome.productUpdated ? 1 : 0;
        counters.variantsCreated += outcome.variantCreated ? 1 : 0;
        counters.variantsUpdated += outcome.variantUpdated ? 1 : 0;
        if (
          !outcome.productCreated &&
          !outcome.productUpdated &&
          !outcome.variantCreated &&
          !outcome.variantUpdated
        ) {
          counters.rowsSkipped += 1;
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

    await this.prisma.client.bulkProductUpload.update({
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
      action: 'catalog.csv_import.processed',
      entityType: 'bulk_product_upload',
      entityId: uploadId,
      metadata: { status, ...counters, rowCount: parsed.rowCount },
    });
  }

  // ---------- internal ----------

  private async upsertRow(
    sellerId: string,
    categoryId: string | null,
    row: CoercedVariantRow,
  ): Promise<{
    productCreated: boolean;
    productUpdated: boolean;
    variantCreated: boolean;
    variantUpdated: boolean;
  }> {
    return this.prisma.client.$transaction(async (tx) => {
      const existingVariant = await tx.productVariant.findFirst({
        where: { sellerId, skuCode: row.variantSkuCode, deletedAt: null },
        select: { id: true, productId: true, attributes: true },
      });

      let productCreated = false;
      let productUpdated = false;
      let variantCreated = false;
      let variantUpdated = false;
      let productId: string;

      if (existingVariant) {
        productId = existingVariant.productId;
        productUpdated = await this.patchProduct(tx, productId, categoryId, row);
      } else if (row.productExternalRef) {
        const existingProduct = await tx.product.findFirst({
          where: { sellerId, externalRef: row.productExternalRef, deletedAt: null },
          select: { id: true },
        });
        if (existingProduct) {
          productId = existingProduct.id;
          productUpdated = await this.patchProduct(tx, productId, categoryId, row);
        } else {
          productId = await this.createProduct(tx, sellerId, categoryId, row);
          productCreated = true;
        }
      } else {
        productId = await this.createProduct(tx, sellerId, categoryId, row);
        productCreated = true;
      }

      if (existingVariant) {
        variantUpdated = await this.patchVariant(
          tx,
          existingVariant.id,
          existingVariant.attributes,
          row,
        );
      } else {
        await tx.productVariant.create({
          data: {
            productId,
            sellerId,
            skuCode: row.variantSkuCode,
            attributes: (row.attributes ?? {}) as Prisma.InputJsonValue,
            weightGrams: row.weightGrams ?? null,
            lengthCm: num(row.lengthCm) ?? null,
            widthCm: num(row.widthCm) ?? null,
            heightCm: num(row.heightCm) ?? null,
            declaredValueInr: num(row.declaredValueInr) ?? null,
            hsCode: row.hsCode ?? null,
            barcode: row.barcode ?? null,
          },
        });
        variantCreated = true;
      }

      return { productCreated, productUpdated, variantCreated, variantUpdated };
    });
  }

  private async createProduct(
    tx: Prisma.TransactionClient,
    sellerId: string,
    categoryId: string | null,
    row: CoercedVariantRow,
  ): Promise<string> {
    const p = await tx.product.create({
      data: {
        sellerId,
        categoryId,
        name: row.productName,
        externalRef: row.productExternalRef ?? null,
        defaultWeightGrams: row.weightGrams ?? null,
        defaultLengthCm: num(row.lengthCm) ?? null,
        defaultWidthCm: num(row.widthCm) ?? null,
        defaultHeightCm: num(row.heightCm) ?? null,
        defaultDeclaredValueInr: num(row.declaredValueInr) ?? null,
        defaultHsCode: row.hsCode ?? null,
      },
      select: { id: true },
    });
    return p.id;
  }

  private async patchProduct(
    tx: Prisma.TransactionClient,
    productId: string,
    categoryId: string | null,
    row: CoercedVariantRow,
  ): Promise<boolean> {
    const cur = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, categoryId: true, defaultHsCode: true },
    });
    const data: Prisma.ProductUpdateInput = {};
    if (row.productName !== cur.name) data.name = row.productName;
    if (categoryId !== null && categoryId !== cur.categoryId) {
      data.category = { connect: { id: categoryId } };
    }
    if (row.hsCode !== undefined && row.hsCode !== cur.defaultHsCode) {
      data.defaultHsCode = row.hsCode;
    }
    if (Object.keys(data).length === 0) return false;
    await tx.product.update({ where: { id: productId }, data });
    return true;
  }

  private async patchVariant(
    tx: Prisma.TransactionClient,
    variantId: string,
    currentAttributes: Prisma.JsonValue | null,
    row: CoercedVariantRow,
  ): Promise<boolean> {
    const cur = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: {
        weightGrams: true,
        hsCode: true,
        barcode: true,
      },
    });
    const data: Prisma.ProductVariantUpdateInput = {};
    if (row.weightGrams !== undefined && row.weightGrams !== cur.weightGrams) {
      data.weightGrams = row.weightGrams;
    }
    if (row.hsCode !== undefined && row.hsCode !== cur.hsCode) {
      data.hsCode = row.hsCode;
    }
    if (row.barcode !== undefined && row.barcode !== cur.barcode) {
      data.barcode = row.barcode;
    }
    if (row.attributes !== undefined) {
      const before = JSON.stringify(currentAttributes ?? {});
      const after = JSON.stringify(row.attributes);
      if (before !== after) data.attributes = row.attributes as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length === 0) return false;
    await tx.productVariant.update({ where: { id: variantId }, data });
    return true;
  }

  private async writeErrorReport(
    sourceKey: string,
    headers: string[],
    errorRows: ErrorRow[],
  ): Promise<string | null> {
    const key = errorReportKeyFor(sourceKey);
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
    await this.prisma.client.bulkProductUpload.update({
      where: { id: uploadId },
      data: {
        status: BulkUploadStatus.FAILED,
        completedAt: new Date(),
      },
    });
    this.logger.warn({ uploadId, reason }, 'CSV import failed');
  }
}
