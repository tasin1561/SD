import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StagedRowStatus } from '@skydrop/db';
import { BulkRunnerService, type BulkItemResult } from '../../../common/bulk/bulk-runner.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CatalogReadService,
  suggestSkusSafe,
} from '../../catalog-read/services/catalog-read.service';
import { AddressValidationService } from '../../order/services/address-validation.service';
import { normalizeIndianPhone } from './order-csv-parser.service';
import { StagedOrderRowService, type RowProblem } from './staged-order-row.service';

/**
 * Fix one problem across many pending CSV rows at once.
 *
 * Fifteen rows that all say SKU "Elite Collagen" are ONE mistake made
 * fifteen times, and fixing them a row at a time is the reason a queue
 * stops being worked. This groups rows by (problem, bad value) and
 * applies one correction to every row in a group.
 *
 * It owns no import logic and no validation rules of its own:
 *   - re-validation is `StagedOrderRowService.validate` (what the
 *     single-row edit runs), plus two existence checks that edit cannot
 *     see until import (SKU in the catalogue, state recognised);
 *   - importing is `StagedOrderRowService.importRow`, the very method
 *     behind "Import as order".
 *
 * Only staged rows (NEEDS_INPUT / DUPLICATE_SUSPECTED) of THIS seller are
 * ever read or written; the seller id is in every query, so another
 * seller's rows are unreachable whatever ids are sent. A placed order is
 * never touched here.
 */

export type BulkFixField =
  | 'productSku'
  | 'state'
  | 'customerPhone'
  | 'pinCode'
  | 'paymentMode'
  | 'addressLine2';

export type BulkFixKind =
  | 'SKU_NOT_FOUND'
  | 'STATE_NOT_RECOGNISED'
  | 'PHONE_FORMAT'
  | 'PIN_FORMAT'
  | 'PAYMENT_MODE'
  | 'LANDMARK_MISSING';

export const BULK_FIX_FIELDS: readonly BulkFixField[] = [
  'productSku',
  'state',
  'customerPhone',
  'pinCode',
  'paymentMode',
  'addressLine2',
];

export interface BulkFixSuggestion {
  readonly value: string;
  readonly label: string;
}

export interface BulkFixGroup {
  readonly field: BulkFixField;
  readonly kind: BulkFixKind;
  readonly badValue: string;
  readonly reason: string;
  readonly rowCount: number;
  readonly rowIds: readonly string[];
  readonly suggestions: readonly BulkFixSuggestion[];
}

export interface BulkFixRowResult {
  readonly rowId: string;
  readonly rowNumber: number;
  readonly outcome: 'fixed' | 'stillHasProblems';
  readonly problems: readonly RowProblem[];
  readonly imported: boolean;
  readonly orderId: string | null;
  readonly importError: string | null;
}

export interface BulkFixApplyInput {
  readonly field: BulkFixField;
  readonly fromValue: string;
  readonly toValue: string;
  readonly rowIds?: readonly string[] | undefined;
  readonly importAfterFix?: boolean | undefined;
}

export const SELECTION_FIELDS = [
  'productSku',
  'quantity',
  'customerPhone',
  'state',
  'pinCode',
  'city',
  'codAmount',
  'landmark',
  'addressLine2',
] as const;
export type SelectionField = (typeof SELECTION_FIELDS)[number];

export interface StagedCompactRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly externalRef: string;
  readonly customerName: string;
  readonly phone: string;
  readonly pinCode: string;
  readonly sku: string;
  readonly qty: string;
  readonly codAmount: string;
  readonly problemCount: number;
  readonly status: StagedRowStatus;
}

export interface SelectionResult {
  readonly action: string;
  readonly results: ReadonlyArray<Omit<BulkItemResult, 'orderId'> & { readonly rowId: string }>;
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly replayed: boolean;
}

const PENDING = [StagedRowStatus.NEEDS_INPUT, StagedRowStatus.DUPLICATE_SUSPECTED];
const E164 = /^\+[1-9]\d{7,14}$/;
const MAX_ROWS = 500;

type Row = Prisma.StagedOrderRowGetPayload<Record<string, never>>;

@Injectable()
export class StagedOrderBulkFixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staged: StagedOrderRowService,
    private readonly catalog: CatalogReadService,
    private readonly address: AddressValidationService,
    private readonly bulk: BulkRunnerService,
  ) {}

  // ── summary ────────────────────────────────────────────────────────

  async summary(sellerId: string): Promise<{ groups: BulkFixGroup[] }> {
    const rows = await this.pendingRows(sellerId);
    const skuOk = await this.skuExistence(
      sellerId,
      rows.map((r) => this.val(r, 'productSku')),
    );
    const stateOk = new Map<string, boolean>();
    const buckets = new Map<
      string,
      { field: BulkFixField; kind: BulkFixKind; bad: string; reason: string; ids: string[] }
    >();
    const add = (
      field: BulkFixField,
      kind: BulkFixKind,
      bad: string,
      reason: string,
      id: string,
    ): void => {
      const key = `${kind}\u0000${bad}`;
      const b = buckets.get(key);
      if (b) b.ids.push(id);
      else buckets.set(key, { field, kind, bad, reason, ids: [id] });
    };

    for (const r of rows) {
      const sku = this.val(r, 'productSku');
      if (sku !== '' && skuOk.get(sku) === false) {
        add(
          'productSku',
          'SKU_NOT_FOUND',
          sku,
          `No product with SKU "${sku}" in your catalogue`,
          r.id,
        );
      }
      const state = this.val(r, 'state');
      if (state !== '') {
        if (!stateOk.has(state)) stateOk.set(state, await this.stateRecognised(state));
        if (stateOk.get(state) === false) {
          add(
            'state',
            'STATE_NOT_RECOGNISED',
            state,
            `"${state}" is not a state we deliver to`,
            r.id,
          );
        }
      }
      const phone = this.val(r, 'customerPhone');
      if (phone !== '' && !E164.test(phone)) {
        add(
          'customerPhone',
          'PHONE_FORMAT',
          phone,
          'Phone must start with +91 and have 10 digits',
          r.id,
        );
      }
      const pin = this.val(r, 'pinCode');
      if (pin !== '' && !/^\d{6}$/.test(pin)) {
        add('pinCode', 'PIN_FORMAT', pin, 'PIN code must be six digits', r.id);
      }
      const modeProblem = this.storedProblems(r).find((p) => p.field === 'paymentMode');
      if (modeProblem) {
        add('paymentMode', 'PAYMENT_MODE', this.val(r, 'paymentMode'), modeProblem.reason, r.id);
      }
      if (this.val(r, 'addressLine2') === '' && this.val(r, 'landmark') === '') {
        add('addressLine2', 'LANDMARK_MISSING', '', 'Landmark is missing', r.id);
      }
    }

    const groups: BulkFixGroup[] = [];
    for (const b of buckets.values()) {
      groups.push({
        field: b.field,
        kind: b.kind,
        badValue: b.bad,
        reason: b.reason,
        rowCount: b.ids.length,
        rowIds: b.ids,
        suggestions: await this.suggest(sellerId, b.kind, b.bad),
      });
    }
    groups.sort((a, b) => b.rowCount - a.rowCount || a.badValue.localeCompare(b.badValue));
    return { groups };
  }

  private async suggest(
    sellerId: string,
    kind: BulkFixKind,
    bad: string,
  ): Promise<BulkFixSuggestion[]> {
    switch (kind) {
      case 'SKU_NOT_FOUND':
        // The catalogue's own suggester (also behind the order-create hint).
        return (await suggestSkusSafe(this.catalog, sellerId, bad)).slice(0, 3).map((x) => ({
          value: x.skuCode,
          label: x.variantLabel ? `${x.productName} — ${x.variantLabel}` : x.productName,
        }));
      case 'STATE_NOT_RECOGNISED':
        return (await this.address.suggestStates(bad)).map((s) => ({ value: s, label: s }));
      case 'PHONE_FORMAT': {
        const fixed = normalizeIndianPhone(bad);
        return fixed !== bad && E164.test(fixed) ? [{ value: fixed, label: fixed }] : [];
      }
      case 'PIN_FORMAT': {
        const fixed = bad.replace(/\s+/g, '');
        return /^\d{6}$/.test(fixed) ? [{ value: fixed, label: fixed }] : [];
      }
      default:
        return [];
    }
  }

  // ── selection-based actions ────────────────────────────────────────

  /** The compact table row the list-first page shows. */
  async compactList(sellerId: string, uploadId?: string): Promise<StagedCompactRow[]> {
    const rows = await this.staged.list(sellerId, uploadId);
    return rows.map((r) => {
      const d = r.data;
      const str = (k: string): string => String(d[k] ?? '').trim();
      return {
        id: r.id,
        rowNumber: r.rowNumber,
        externalRef: str('externalRef'),
        customerName: str('customerName'),
        phone: str('customerPhone'),
        pinCode: str('pinCode'),
        sku: str('productSku'),
        qty: str('quantity'),
        codAmount: str('codAmount'),
        problemCount: r.problems.length,
        status: r.status,
      };
    });
  }

  /** Set one field on the selected pending rows; each is re-validated. */
  setFieldMany(
    seller: { id: string; userId: string },
    input: {
      rowIds: readonly string[];
      field: SelectionField;
      value: string;
      idempotencyKey: string;
    },
  ): Promise<SelectionResult> {
    const value = input.value.trim();
    if (!SELECTION_FIELDS.includes(input.field)) {
      throw new BadRequestException({
        code: 'BULK_FIX_FIELD',
        message: 'That field cannot be set in bulk',
      });
    }
    if (value === '') {
      throw new BadRequestException({
        code: 'BULK_FIX_EMPTY_VALUE',
        message: 'Enter the value to use',
      });
    }
    const stateCache = new Map<string, boolean>();
    return this.runSelection(
      seller,
      'pending.set-field',
      input,
      { field: input.field, value },
      async (id) => {
        const row = await this.pendingRow(seller.id, id);
        const data = { ...(row.data as Record<string, unknown>), [input.field]: value };
        const problems = await this.revalidate(
          seller.id,
          data,
          input.field === 'productSku'
            ? (await this.skuExistence(seller.id, [value])).get(value)
            : undefined,
          stateCache,
          input.field,
        );
        await this.prisma.client.stagedOrderRow.updateMany({
          where: { id, sellerId: seller.id, status: { in: PENDING } },
          data: {
            data: data as Prisma.InputJsonValue,
            problems: problems as unknown as Prisma.InputJsonValue,
          },
        });
        return problems.length === 0
          ? 'Saved'
          : `Saved, but still needs: ${problems.map((p) => p.reason).join('; ')}`;
      },
    );
  }

  /** Import the selected rows, each exactly as "Import as order" does. */
  importMany(
    seller: { id: string; userId: string },
    input: { rowIds: readonly string[]; idempotencyKey: string },
  ): Promise<SelectionResult> {
    return this.runSelection(seller, 'pending.import', input, null, async (id) => {
      await this.pendingRow(seller.id, id);
      const { orderId } = await this.staged.importRow(seller.id, id);
      return `Imported as order ${orderId}`;
    });
  }

  /** Discard the selected rows (kept for the record, as the single button does). */
  discardMany(
    seller: { id: string; userId: string },
    input: { rowIds: readonly string[]; idempotencyKey: string },
  ): Promise<SelectionResult> {
    return this.runSelection(seller, 'pending.discard', input, null, async (id) => {
      await this.pendingRow(seller.id, id);
      await this.staged.discard(seller.id, id);
    });
  }

  private async runSelection(
    seller: { id: string; userId: string },
    action: string,
    input: { rowIds: readonly string[]; idempotencyKey: string },
    params: unknown,
    step: (id: string) => Promise<string | void>,
  ): Promise<SelectionResult> {
    const res = await this.bulk.run(
      {
        actor: { type: 'SELLER', id: seller.userId },
        action,
        idempotencyKey: input.idempotencyKey,
        ids: input.rowIds,
        params,
      },
      step,
    );
    return {
      action: res.action,
      results: res.results.map(({ orderId, ...rest }: BulkItemResult) => ({
        rowId: orderId,
        ...rest,
      })),
      done: res.done,
      skipped: res.skipped,
      failed: res.failed,
      replayed: res.replayed,
    };
  }

  /** The seller's own PENDING row, or a 404 that says nothing about other sellers' rows. */
  private async pendingRow(sellerId: string, id: string): Promise<Row> {
    const row = await this.prisma.client.stagedOrderRow.findFirst({
      where: { id, sellerId, status: { in: PENDING } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'STAGED_ROW_NOT_FOUND',
        message: 'That row is not waiting in your pending list',
      });
    }
    return row;
  }

  // ── apply ──────────────────────────────────────────────────────────

  async apply(
    sellerId: string,
    input: BulkFixApplyInput,
  ): Promise<{ matched: number; results: BulkFixRowResult[] }> {
    const field = input.field;
    const from = input.fromValue.trim();
    const to = input.toValue.trim();
    if (!BULK_FIX_FIELDS.includes(field)) {
      throw new BadRequestException({
        code: 'BULK_FIX_FIELD',
        message: 'That field cannot be fixed in bulk',
      });
    }
    if (to === '') {
      throw new BadRequestException({
        code: 'BULK_FIX_EMPTY_VALUE',
        message: 'Enter the value to use',
      });
    }
    if (field === 'paymentMode' && !['COD', 'PREPAID'].includes(to.toUpperCase())) {
      throw new BadRequestException({
        code: 'BULK_FIX_PAYMENT_MODE',
        message: 'Payment mode must be COD or Prepaid',
      });
    }
    const wanted = input.rowIds ? new Set(input.rowIds) : null;

    // Existence facts are read once, outside the transaction: they are
    // catalogue / settings reads, and the per-row verdict below is what
    // gets persisted.
    const toSkuOk =
      field === 'productSku' ? (await this.skuExistence(sellerId, [to])).get(to) : true;
    const stateCache = new Map<string, boolean>();

    const changed = await this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.stagedOrderRow.findMany({
        where: {
          sellerId,
          status: { in: PENDING },
          ...(wanted ? { id: { in: [...wanted] } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { rowNumber: 'asc' }],
        take: MAX_ROWS,
      });
      const out: Array<{ row: Row; data: Record<string, unknown>; problems: RowProblem[] }> = [];
      for (const row of rows) {
        if (!this.matches(row, field, from)) continue;
        const data = { ...(row.data as Record<string, unknown>) };
        data[field] = field === 'paymentMode' ? to.toUpperCase() : to;
        const problems = await this.revalidate(sellerId, data, toSkuOk, stateCache, field);
        // Scoped again at the write: id + seller + still pending.
        await tx.stagedOrderRow.updateMany({
          where: { id: row.id, sellerId, status: { in: PENDING } },
          data: {
            data: data as Prisma.InputJsonValue,
            problems: problems as unknown as Prisma.InputJsonValue,
          },
        });
        out.push({ row, data, problems });
      }
      return out;
    });

    const results: BulkFixRowResult[] = [];
    for (const c of changed) {
      let imported = false;
      let orderId: string | null = null;
      let importError: string | null = null;
      // A suspected duplicate is never imported on the seller's behalf:
      // pressing import on it one by one IS the acknowledgement.
      if (
        input.importAfterFix === true &&
        c.problems.length === 0 &&
        c.row.status === StagedRowStatus.NEEDS_INPUT
      ) {
        try {
          orderId = (await this.staged.importRow(sellerId, c.row.id)).orderId;
          imported = true;
        } catch (err) {
          importError = err instanceof Error ? err.message : 'Import failed';
        }
      }
      results.push({
        rowId: c.row.id,
        rowNumber: c.row.rowNumber,
        outcome: c.problems.length === 0 ? 'fixed' : 'stillHasProblems',
        problems: c.problems,
        imported,
        orderId,
        importError,
      });
    }
    return { matched: changed.length, results };
  }

  // ── internal ───────────────────────────────────────────────────────

  private matches(row: Row, field: BulkFixField, from: string): boolean {
    const cur = this.val(row, field);
    if (field === 'addressLine2' && from === '') {
      return cur === '' && this.val(row, 'landmark') === '';
    }
    return cur === from;
  }

  private async revalidate(
    sellerId: string,
    data: Record<string, unknown>,
    toSkuOk: boolean | undefined,
    stateCache: Map<string, boolean>,
    field: string,
  ): Promise<RowProblem[]> {
    const problems = this.staged.validate(data);
    const sku = String(data['productSku'] ?? '').trim();
    if (sku !== '') {
      const ok =
        field === 'productSku' ? toSkuOk : (await this.skuExistence(sellerId, [sku])).get(sku);
      if (ok === false) {
        problems.push({
          field: 'productSku',
          reason: `No product with SKU "${sku}" in your catalogue`,
        });
      }
    }
    const state = String(data['state'] ?? '').trim();
    if (state !== '') {
      if (!stateCache.has(state)) stateCache.set(state, await this.stateRecognised(state));
      if (stateCache.get(state) === false) {
        problems.push({ field: 'state', reason: `"${state}" is not a state we deliver to` });
      }
    }
    return problems;
  }

  private async pendingRows(sellerId: string): Promise<Row[]> {
    return this.prisma.client.stagedOrderRow.findMany({
      where: { sellerId, status: { in: PENDING } },
      orderBy: [{ createdAt: 'asc' }, { rowNumber: 'asc' }],
      take: MAX_ROWS,
    });
  }

  private val(row: Row, key: string): string {
    return String((row.data as Record<string, unknown>)[key] ?? '').trim();
  }

  private storedProblems(row: Row): RowProblem[] {
    return Array.isArray(row.problems) ? (row.problems as unknown as RowProblem[]) : [];
  }

  /** sku → exists in this seller's catalogue. Blank skus are skipped. */
  private async skuExistence(
    sellerId: string,
    skus: readonly string[],
  ): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    for (const sku of new Set(skus.filter((s) => s !== ''))) {
      out.set(sku, (await this.catalog.getVariantBySku(sellerId, sku)) !== null);
    }
    return out;
  }

  private async stateRecognised(state: string): Promise<boolean> {
    const res = await this.address.validate({
      recipientPhoneE164: '+919000000000', // placeholder: only the state verdict is read
      recipientPostalCode: '110001',
      recipientStateProvince: state,
    });
    return res.ok;
  }
}
