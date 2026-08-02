import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, StagedRowStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrderService } from '../../order/services/order.service';

/**
 * The queue of CSV rows that could not become orders on their own.
 *
 * A bulk upload used to end in a downloadable error report, which is a
 * dead end: the seller learns WHAT was wrong and has nowhere to fix it.
 * Their only route back was to edit the spreadsheet and re-upload the
 * whole file — re-running every row that had already imported, and
 * relying on idempotency to make that safe rather than merely survivable.
 *
 * Rows that import cleanly still import. This holds the remainder, and a
 * row leaves it one of two ways: the seller fills the gaps and it
 * becomes an order, or they look at it and throw it away.
 *
 * ── Why the row is JSON and not columns ───────────────────────────────
 * A staged row is a HALF-FORMED order. The reason it could not be stored
 * as one is that `orders` requires a recipient name, a phone, a city —
 * and the row is here precisely because one of those is missing. Giving
 * the staging table those same constraints would reproduce the problem
 * it exists to solve.
 */

/** The fields a CSV row maps to. Mirrors CoercedOrderRow. */
const REQUIRED_FIELDS = [
  'productSku',
  'quantity',
  'customerName',
  'customerPhone',
  'addressLine1',
  'city',
  'state',
  'pinCode',
  'externalRef',
] as const;

const E164 = /^\+[1-9]\d{7,14}$/;
const PIN = /^\d{6}$/;

export interface RowProblem {
  readonly field: string;
  readonly reason: string;
}

export interface StagedRowView {
  readonly id: string;
  readonly uploadId: string;
  readonly rowNumber: number;
  readonly status: StagedRowStatus;
  readonly data: Record<string, unknown>;
  readonly problems: readonly RowProblem[];
  readonly duplicateOf: unknown;
  readonly resolvedOrderId: string | null;
  readonly createdAt: Date;
}

@Injectable()
export class StagedOrderRowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  /**
   * What is wrong with a row, all of it at once.
   *
   * Every problem is reported together rather than the first one: a
   * seller fixing rows one field per round-trip is the reason people go
   * back to editing the spreadsheet instead.
   */
  validate(data: Record<string, unknown>): RowProblem[] {
    const problems: RowProblem[] = [];
    const str = (k: string): string => String(data[k] ?? '').trim();

    for (const field of REQUIRED_FIELDS) {
      if (str(field).length === 0) {
        problems.push({ field, reason: 'Required — the file did not supply this' });
      }
    }
    const phone = str('customerPhone');
    if (phone.length > 0 && !E164.test(phone)) {
      problems.push({
        field: 'customerPhone',
        reason: 'Must be E.164, e.g. +919876543210 — a local format will not match or dial',
      });
    }
    const pin = str('pinCode');
    if (pin.length > 0 && !PIN.test(pin)) {
      problems.push({ field: 'pinCode', reason: 'Must be six digits' });
    }
    const qty = Number(data['quantity']);
    if (str('quantity').length > 0 && (!Number.isInteger(qty) || qty <= 0)) {
      problems.push({ field: 'quantity', reason: 'Must be a whole number above zero' });
    }
    const cod = data['codAmount'];
    if (cod !== undefined && cod !== null && String(cod).trim() !== '' && Number(cod) < 0) {
      problems.push({ field: 'codAmount', reason: 'Cannot be negative' });
    }
    return problems;
  }

  /**
   * Park a row for the seller to deal with.
   *
   * Upserts on (upload, rowNumber): re-processing the same file must
   * update the row, never accumulate copies of it.
   */
  async stage(input: {
    uploadId: string;
    sellerId: string;
    rowNumber: number;
    data: Record<string, unknown>;
    problems: readonly RowProblem[];
    duplicateOf?: unknown;
  }): Promise<void> {
    const status =
      input.duplicateOf !== undefined && input.duplicateOf !== null
        ? StagedRowStatus.DUPLICATE_SUSPECTED
        : StagedRowStatus.NEEDS_INPUT;

    await this.prisma.client.stagedOrderRow.upsert({
      where: {
        uploadId_rowNumber: { uploadId: input.uploadId, rowNumber: input.rowNumber },
      },
      create: {
        uploadId: input.uploadId,
        sellerId: input.sellerId,
        rowNumber: input.rowNumber,
        data: input.data as Prisma.InputJsonValue,
        problems: input.problems as unknown as Prisma.InputJsonValue,
        duplicateOf: (input.duplicateOf ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status,
      },
      update: {
        data: input.data as Prisma.InputJsonValue,
        problems: input.problems as unknown as Prisma.InputJsonValue,
        duplicateOf: (input.duplicateOf ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status,
      },
    });
  }

  async list(sellerId: string, uploadId?: string): Promise<StagedRowView[]> {
    const rows = await this.prisma.client.stagedOrderRow.findMany({
      where: {
        sellerId,
        ...(uploadId ? { uploadId } : {}),
        // Resolved rows stay for the record but are not the queue.
        status: { in: [StagedRowStatus.NEEDS_INPUT, StagedRowStatus.DUPLICATE_SUSPECTED] },
      },
      orderBy: [{ createdAt: 'asc' }, { rowNumber: 'asc' }],
      take: 500,
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Edit the row in place.
   *
   * Re-validates everything after the edit rather than only the field
   * that changed: fixing a city can reveal that the PIN never matched
   * it, and reporting one problem at a time is how a queue stops being
   * worked.
   */
  async patch(
    sellerId: string,
    rowId: string,
    patch: Record<string, unknown>,
  ): Promise<StagedRowView> {
    const row = await this.require(sellerId, rowId);
    const data = { ...(row.data as Record<string, unknown>), ...patch };
    const problems = this.validate(data);

    const updated = await this.prisma.client.stagedOrderRow.update({
      where: { id: rowId },
      data: {
        data: data as Prisma.InputJsonValue,
        problems: problems as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toView(updated);
  }

  /**
   * Turn a staged row into a real order.
   *
   * The row must be clean first — this refuses rather than importing a
   * half-formed order and leaving the seller to discover the gaps later.
   *
   * A DUPLICATE_SUSPECTED row imports with the acknowledgement set: the
   * seller looking at this queue and pressing import IS the deliberate
   * act the flag records.
   */
  async importRow(sellerId: string, rowId: string): Promise<{ orderId: string }> {
    const row = await this.require(sellerId, rowId);
    if (row.status === StagedRowStatus.IMPORTED) {
      throw new ConflictException({
        code: 'STAGED_ROW_ALREADY_IMPORTED',
        message: 'That row is already an order',
      });
    }
    const data = row.data as Record<string, unknown>;
    const problems = this.validate(data);
    if (problems.length > 0) {
      throw new BadRequestException({
        code: 'STAGED_ROW_INCOMPLETE',
        message: `Still missing ${problems.length} value(s)`,
        details: { problems },
      });
    }

    const str = (k: string): string => String(data[k] ?? '').trim();
    const variant = await this.prisma.client.productVariant.findFirst({
      where: { sellerId, skuCode: str('productSku'), deletedAt: null },
      select: { id: true },
    });
    if (!variant) {
      throw new BadRequestException({
        code: 'STAGED_ROW_SKU_NOT_FOUND',
        message: `No variant with SKU "${str('productSku')}"`,
      });
    }

    const codRaw = data['codAmount'];
    const cod =
      codRaw === undefined || codRaw === null || String(codRaw).trim() === ''
        ? null
        : Number(codRaw);

    const created = await this.orders.create(
      sellerId,
      {
        sellerOrderRef: str('externalRef'),
        recipientName: str('customerName'),
        recipientPhoneE164: str('customerPhone'),
        recipientAddressLine1: str('addressLine1'),
        recipientCity: str('city'),
        recipientStateProvince: str('state'),
        recipientPostalCode: str('pinCode'),
        paymentMode: cod !== null && cod > 0 ? 'COD' : 'PREPAID',
        ...(cod !== null && cod > 0 ? { codAmountInr: cod } : {}),
        ...(str('addressLine2') ? { recipientAddressLine2: str('addressLine2') } : {}),
        ...(str('landmark') ? { recipientLandmark: str('landmark') } : {}),
        ...(str('customerEmail') ? { recipientEmail: str('customerEmail') } : {}),
        items: [{ variantId: variant.id, quantity: Number(data['quantity']) }],
        // Pressing import on a row the queue has already told them is a
        // suspected duplicate IS the acknowledgement.
        ...(row.status === StagedRowStatus.DUPLICATE_SUSPECTED
          ? { acknowledgeDuplicate: true }
          : {}),
      } as Parameters<OrderService['create']>[1],
      { type: ActorType.SELLER, id: sellerId },
      { ipAddress: null, userAgent: null, requestId: `staged:${rowId}` },
      { bulkUploadId: row.uploadId },
    );

    await this.prisma.client.stagedOrderRow.update({
      where: { id: rowId },
      data: {
        status: StagedRowStatus.IMPORTED,
        resolvedOrderId: created.id,
        resolvedAt: new Date(),
      },
    });
    return { orderId: created.id };
  }

  /** The seller looked and does not want it. Kept, not deleted. */
  async discard(sellerId: string, rowId: string): Promise<StagedRowView> {
    await this.require(sellerId, rowId);
    const updated = await this.prisma.client.stagedOrderRow.update({
      where: { id: rowId },
      data: { status: StagedRowStatus.DISCARDED, resolvedAt: new Date() },
    });
    return this.toView(updated);
  }

  // ── internal ──────────────────────────────────────────────────────

  private async require(
    sellerId: string,
    rowId: string,
  ): Promise<Prisma.StagedOrderRowGetPayload<Record<string, never>>> {
    const row = await this.prisma.client.stagedOrderRow.findFirst({
      where: { id: rowId, sellerId },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'STAGED_ROW_NOT_FOUND',
        message: 'Row not found',
      });
    }
    return row;
  }

  private toView(row: Prisma.StagedOrderRowGetPayload<Record<string, never>>): StagedRowView {
    return {
      id: row.id,
      uploadId: row.uploadId,
      rowNumber: row.rowNumber,
      status: row.status,
      data: row.data as Record<string, unknown>,
      problems: (row.problems ?? []) as unknown as readonly RowProblem[],
      duplicateOf: row.duplicateOf ?? null,
      resolvedOrderId: row.resolvedOrderId,
      createdAt: row.createdAt,
    };
  }
}
