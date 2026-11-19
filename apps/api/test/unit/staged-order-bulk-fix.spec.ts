import { BadRequestException } from '@nestjs/common';
import { StagedRowStatus } from '@skydrop/db';
import { runEach } from '../../src/common/bulk/bulk-runner.service';
import { StagedOrderBulkFixService } from '../../src/modules/order-csv-import/services/staged-order-bulk-fix.service';
import { StagedOrderRowService } from '../../src/modules/order-csv-import/services/staged-order-row.service';

type AnyArgs = any;

const GOOD = {
  externalRef: 'R1',
  productSku: 'COFFEE-1',
  quantity: '1',
  customerName: 'A B',
  customerPhone: '+919845011068',
  addressLine1: '1 Road',
  addressLine2: 'Near the temple',
  city: 'Pune',
  state: 'Maharashtra',
  pinCode: '411001',
};

interface FakeRow {
  id: string;
  sellerId: string;
  uploadId: string;
  rowNumber: number;
  status: StagedRowStatus;
  data: Record<string, unknown>;
  problems: unknown[];
  createdAt: Date;
}

const VARIANTS = [
  { skuCode: 'COFFEE-1', productName: 'Coffee', variantLabel: null },
  { skuCode: 'TEA-1', productName: 'Green Tea', variantLabel: '250g' },
];

function setup(rows: FakeRow[]) {
  const importRow = jest.fn(async (_s: string, id: string) => ({ orderId: `order-${id}` }));
  const prisma = {
    client: {
      stagedOrderRow: {
        findMany: jest.fn(async ({ where }: AnyArgs) =>
          rows.filter(
            (r) =>
              r.sellerId === where.sellerId &&
              where.status.in.includes(r.status) &&
              (!where.id || where.id.in.includes(r.id)),
          ),
        ),
        findFirst: jest.fn(
          async ({ where }: AnyArgs) =>
            rows.find(
              (r) =>
                r.id === where.id &&
                r.sellerId === where.sellerId &&
                where.status.in.includes(r.status),
            ) ?? null,
        ),
        updateMany: jest.fn(async ({ where, data }: AnyArgs) => {
          const r = rows.find(
            (x) =>
              x.id === where.id &&
              x.sellerId === where.sellerId &&
              where.status.in.includes(x.status),
          );
          if (r) Object.assign(r, data);
          return { count: r ? 1 : 0 };
        }),
      },
      $transaction: async (fn: AnyArgs) => fn(prisma.client),
    },
  } as AnyArgs;
  const real = new StagedOrderRowService(prisma, {} as AnyArgs);
  const staged = {
    validate: real.validate.bind(real),
    importRow,
  } as unknown as StagedOrderRowService;
  const catalog = {
    getVariantBySku: jest.fn(async (_s: string, sku: string) =>
      VARIANTS.some((v) => v.skuCode === sku) ? { id: 'v' } : null,
    ),
    suggestSkus: jest.fn(async (_s: string, typed: string) => {
      const n = (v: string) => v.toLowerCase().replace(/[\s_\-./]+/g, '');
      return VARIANTS.filter(
        (v) =>
          n(v.skuCode) === n(typed) ||
          n(`${v.productName}${v.variantLabel ?? ''}`) === n(typed) ||
          n(v.productName) === n(typed),
      );
    }),
  } as AnyArgs;
  const address = {
    validate: jest.fn(async ({ recipientStateProvince }: AnyArgs) => ({
      ok: ['Maharashtra', 'Odisha'].includes(recipientStateProvince),
      errors: [],
    })),
    suggestStates: jest.fn(async (t: string) => (t === 'Maharastra' ? ['Maharashtra'] : [])),
  } as AnyArgs;
  const discard = jest.fn(async () => ({}));
  (staged as AnyArgs).discard = discard;
  // The real loop, minus Redis: a refusal is SKIPPED, anything else FAILED.
  const bulk = {
    run: jest.fn(async (input: AnyArgs, each: AnyArgs) => {
      const results = await runEach(input.ids, each);
      return {
        action: input.action,
        results,
        done: results.filter((r) => r.outcome === 'DONE').length,
        skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
        failed: results.filter((r) => r.outcome === 'FAILED').length,
        replayed: false,
      };
    }),
  } as AnyArgs;
  const svc = new StagedOrderBulkFixService(prisma, staged, catalog, address, bulk);
  return { svc, importRow, discard, rows, bulk };
}

let n = 0;
function row(over: Partial<FakeRow> & { data?: Record<string, unknown> } = {}): FakeRow {
  n += 1;
  return {
    id: `row-${n}`,
    sellerId: 's1',
    uploadId: 'u1',
    rowNumber: n,
    status: StagedRowStatus.NEEDS_INPUT,
    problems: [],
    createdAt: new Date(2026, 0, n),
    ...over,
    data: { ...GOOD, ...(over.data ?? {}) },
  };
}

describe('StagedOrderBulkFixService.summary', () => {
  it('groups the same SKU problem and suggests the real SKU, max 3', async () => {
    const rows = [
      row({ data: { productSku: 'Elite Collagen' } }),
      row({ data: { productSku: 'Elite Collagen' } }),
      row({ data: { productSku: 'coffee 1' } }),
      row(),
    ];
    const { svc } = setup(rows);
    const { groups } = await svc.summary('s1');
    const elite = groups.find((g) => g.badValue === 'Elite Collagen')!;
    expect(elite).toMatchObject({ field: 'productSku', kind: 'SKU_NOT_FOUND', rowCount: 2 });
    expect(elite.rowIds).toEqual([rows[0]!.id, rows[1]!.id]);
    const spaced = groups.find((g) => g.badValue === 'coffee 1')!;
    expect(spaced.suggestions[0]).toEqual({ value: 'COFFEE-1', label: 'Coffee' });
    expect(spaced.suggestions.length).toBeLessThanOrEqual(3);
  });

  it('suggests by product name + variant label', async () => {
    const { svc } = setup([row({ data: { productSku: 'green tea 250g' } })]);
    const { groups } = await svc.summary('s1');
    expect(groups[0]!.suggestions[0]).toEqual({ value: 'TEA-1', label: 'Green Tea — 250g' });
  });

  it('groups state, phone, pin and landmark problems with normalised suggestions', async () => {
    const { svc } = setup([
      row({ data: { state: 'Maharastra' } }),
      row({ data: { customerPhone: '9845011068' } }),
      row({ data: { pinCode: '411 001' } }),
      row({ data: { addressLine2: '' } }),
    ]);
    const { groups } = await svc.summary('s1');
    const by = (k: string) => groups.find((g) => g.kind === k)!;
    expect(by('STATE_NOT_RECOGNISED').suggestions).toEqual([
      { value: 'Maharashtra', label: 'Maharashtra' },
    ]);
    expect(by('PHONE_FORMAT').suggestions[0]!.value).toBe('+919845011068');
    expect(by('PIN_FORMAT').suggestions[0]!.value).toBe('411001');
    expect(by('LANDMARK_MISSING')).toMatchObject({ badValue: '', suggestions: [] });
  });

  it('groups a payment-mode problem without suggesting', async () => {
    const { svc } = setup([
      row({
        data: { paymentMode: 'COD' },
        problems: [{ field: 'paymentMode', reason: 'COD with no amount' }],
      }),
    ]);
    const { groups } = await svc.summary('s1');
    expect(groups[0]).toMatchObject({ kind: 'PAYMENT_MODE', badValue: 'COD', suggestions: [] });
  });

  it("never lists another seller's or resolved rows", async () => {
    const { svc } = setup([
      row({ sellerId: 's2', data: { productSku: 'Nope' } }),
      row({ status: StagedRowStatus.IMPORTED, data: { productSku: 'Nope' } }),
    ]);
    expect((await svc.summary('s1')).groups).toEqual([]);
  });
});

describe('StagedOrderBulkFixService.apply', () => {
  it('fixes every matching row, re-validates and reports per row', async () => {
    const rows = [
      row({ data: { productSku: 'Elite Collagen' } }),
      row({ data: { productSku: 'Elite Collagen', customerName: '' } }),
      row({ data: { productSku: 'Other' } }),
    ];
    const { svc } = setup(rows);
    const res = await svc.apply('s1', {
      field: 'productSku',
      fromValue: 'Elite Collagen',
      toValue: 'COFFEE-1',
    });
    expect(res.matched).toBe(2);
    expect(res.results.map((r) => r.outcome)).toEqual(['fixed', 'stillHasProblems']);
    expect(res.results[1]!.problems.map((p) => p.field)).toEqual(['customerName']);
    expect(rows[0]!.data['productSku']).toBe('COFFEE-1');
    expect(rows[2]!.data['productSku']).toBe('Other');
  });

  it('flags rows when the new SKU does not exist either', async () => {
    const { svc } = setup([row({ data: { productSku: 'X' } })]);
    const res = await svc.apply('s1', { field: 'productSku', fromValue: 'X', toValue: 'NOPE' });
    expect(res.results[0]!.outcome).toBe('stillHasProblems');
  });

  it("never touches another seller's rows, even when their ids are sent", async () => {
    const mine = row({ data: { productSku: 'X' } });
    const theirs = row({ sellerId: 's2', data: { productSku: 'X' } });
    const { svc } = setup([mine, theirs]);
    const res = await svc.apply('s1', {
      field: 'productSku',
      fromValue: 'X',
      toValue: 'COFFEE-1',
      rowIds: [mine.id, theirs.id],
    });
    expect(res.matched).toBe(1);
    expect(theirs.data['productSku']).toBe('X');
  });

  it('never touches resolved (imported / discarded) rows', async () => {
    const done = row({ status: StagedRowStatus.IMPORTED, data: { productSku: 'X' } });
    const { svc } = setup([done]);
    const res = await svc.apply('s1', { field: 'productSku', fromValue: 'X', toValue: 'COFFEE-1' });
    expect(res.matched).toBe(0);
    expect(done.data['productSku']).toBe('X');
  });

  it('is idempotent: applying again matches nothing', async () => {
    const { svc, rows } = setup([row({ data: { productSku: 'X' } })]);
    const input = { field: 'productSku', fromValue: 'X', toValue: 'COFFEE-1' } as const;
    expect((await svc.apply('s1', input)).matched).toBe(1);
    const again = await svc.apply('s1', input);
    expect(again).toEqual({ matched: 0, results: [] });
    expect(rows[0]!.data['productSku']).toBe('COFFEE-1');
  });

  it('fixes a missing landmark across rows', async () => {
    const rows = [row({ data: { addressLine2: '' } }), row({ data: { addressLine2: '' } })];
    const { svc } = setup(rows);
    const res = await svc.apply('s1', {
      field: 'addressLine2',
      fromValue: '',
      toValue: 'Near the temple',
    });
    expect(res.matched).toBe(2);
    expect(rows[0]!.data['addressLine2']).toBe('Near the temple');
  });

  it('importAfterFix imports only rows that became clean, through importRow', async () => {
    const rows = [
      row({ data: { productSku: 'X' } }),
      row({ data: { productSku: 'X', customerName: '' } }),
      row({ status: StagedRowStatus.DUPLICATE_SUSPECTED, data: { productSku: 'X' } }),
    ];
    const { svc, importRow } = setup(rows);
    const res = await svc.apply('s1', {
      field: 'productSku',
      fromValue: 'X',
      toValue: 'COFFEE-1',
      importAfterFix: true,
    });
    expect(importRow).toHaveBeenCalledTimes(1);
    expect(importRow).toHaveBeenCalledWith('s1', rows[0]!.id);
    expect(res.results.map((r) => r.imported)).toEqual([true, false, false]);
    expect(res.results[0]!.orderId).toBe(`order-${rows[0]!.id}`);
  });

  it('reports an import refusal per row without failing the batch', async () => {
    const { svc, importRow } = setup([row({ data: { productSku: 'X' } })]);
    importRow.mockRejectedValueOnce(new Error('boom'));
    const res = await svc.apply('s1', {
      field: 'productSku',
      fromValue: 'X',
      toValue: 'COFFEE-1',
      importAfterFix: true,
    });
    expect(res.results[0]).toMatchObject({
      outcome: 'fixed',
      imported: false,
      importError: 'boom',
    });
  });

  it('refuses an empty value and a bad payment mode', async () => {
    const { svc } = setup([]);
    await expect(
      svc.apply('s1', { field: 'state', fromValue: 'a', toValue: '  ' }),
    ).rejects.toMatchObject({ response: { code: 'BULK_FIX_EMPTY_VALUE' } });
    await expect(
      svc.apply('s1', { field: 'paymentMode', fromValue: 'a', toValue: 'cash' }),
    ).rejects.toMatchObject({ response: { code: 'BULK_FIX_PAYMENT_MODE' } });
  });
});

describe('StagedOrderBulkFixService selection actions', () => {
  const seller = { id: 's1', userId: 'u1' };

  it('set-field saves, re-validates and says what is still missing', async () => {
    const a = row({ data: { productSku: 'X' } });
    const b = row({ data: { productSku: 'X', customerName: '' } });
    const { svc } = setup([a, b]);
    const res = await svc.setFieldMany(seller, {
      rowIds: [a.id, b.id],
      field: 'productSku',
      value: 'COFFEE-1',
      idempotencyKey: 'key-12345',
    });
    expect(res.done).toBe(2);
    expect(res.results[0]).toMatchObject({ rowId: a.id, outcome: 'DONE', message: 'Saved' });
    expect(res.results[1]!.message).toContain('still needs');
    expect(a.data['productSku']).toBe('COFFEE-1');
  });

  it("skips another seller's, resolved and unknown rows without touching them", async () => {
    const theirs = row({ sellerId: 's2', data: { city: 'Old' } });
    const done = row({ status: StagedRowStatus.IMPORTED, data: { city: 'Old' } });
    const { svc } = setup([theirs, done]);
    const res = await svc.setFieldMany(seller, {
      rowIds: [theirs.id, done.id],
      field: 'city',
      value: 'New',
      idempotencyKey: 'key-12345',
    });
    expect(res.skipped).toBe(2);
    expect(res.results[0]!.code).toBe('STAGED_ROW_NOT_FOUND');
    expect(theirs.data['city']).toBe('Old');
    expect(done.data['city']).toBe('Old');
  });

  it('import goes through importRow per row; a refusal is a per-row SKIPPED', async () => {
    const a = row();
    const b = row();
    const { svc, importRow } = setup([a, b]);
    importRow.mockRejectedValueOnce(
      new BadRequestException({
        code: 'STAGED_ROW_INCOMPLETE',
        message: 'Still missing 1 value(s)',
      }),
    );
    const res = await svc.importMany(seller, { rowIds: [a.id, b.id], idempotencyKey: 'key-12345' });
    expect(importRow).toHaveBeenCalledTimes(2);
    expect(res.results[0]).toMatchObject({ outcome: 'SKIPPED', code: 'STAGED_ROW_INCOMPLETE' });
    expect(res.results[1]!.outcome).toBe('DONE');
  });

  it('discard uses the existing discard and never an already-imported row', async () => {
    const a = row();
    const done = row({ status: StagedRowStatus.IMPORTED });
    const { svc, discard } = setup([a, done]);
    const res = await svc.discardMany(seller, {
      rowIds: [a.id, done.id],
      idempotencyKey: 'key-12345',
    });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(res.results.map((r) => r.outcome)).toEqual(['DONE', 'SKIPPED']);
  });

  it('refuses an empty value', async () => {
    const { svc } = setup([]);
    await expect(
      (async () =>
        svc.setFieldMany(seller, {
          rowIds: ['x'],
          field: 'city',
          value: ' ',
          idempotencyKey: 'key-12345',
        }))(),
    ).rejects.toMatchObject({ response: { code: 'BULK_FIX_EMPTY_VALUE' } });
  });
});
