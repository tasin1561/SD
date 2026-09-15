import {
  Prisma,
  SellerStoreKind,
  StoreExpenseCategory,
  StoreWalletEntryDirection as D,
  WalletEntryDirection as W,
} from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { StorePnlService } from '../../src/modules/reseller-reports/services/store-pnl.service';
import { FakeDb, type Row, type Tables } from './pnl-fake-db';

/** RS-8 — one reseller store's ledger, orders and expense book, shared by the store P&L specs. */

/**
 * The fake applies no column defaults; the real tables stamp these. Wraps
 * create / createMany for the models the store P&L writes.
 */
const DEFAULTS: Record<string, () => Row> = {
  storePnlPeriod: () => ({ closedAt: new Date() }),
  storePnlCarryForward: () => ({ detectedAt: new Date() }),
};

export class DefaultsDb extends FakeDb {
  override delegate(
    model: string,
  ): Record<string, (args?: Record<string, unknown>) => Promise<unknown>> {
    const d = super.delegate(model);
    const defaults = DEFAULTS[model];
    const create = d['create'];
    const createMany = d['createMany'];
    if (defaults === undefined || create === undefined || createMany === undefined) return d;
    return {
      ...d,
      create: (args = {}) => create({ ...args, data: { ...defaults(), ...(args['data'] as Row) } }),
      createMany: (args = {}) =>
        createMany({
          ...args,
          data: (args['data'] as Row[]).map((r) => ({ ...defaults(), ...r })),
        }),
    };
  }
}

const d = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
/** An instant given as IST wall-clock. */
const ist = (s: string): Date => new Date(`${s}+05:30`);

let seq = 0;
function entry(
  storeId: string,
  direction: D,
  amount: number,
  at: string,
  extra: Partial<Row> = {},
): Row {
  seq += 1;
  return {
    id: `e-${String(seq).padStart(4, '0')}`,
    storeId,
    direction,
    amount: d(amount),
    shareOf: null,
    linkedOrderId: null,
    linkedEntryId: null,
    createdAt: ist(at),
    ...extra,
  };
}

export function storeTables(): Tables {
  seq = 0;
  const feeShare = entry('store-1', D.FEE_SHARE, 20, '2026-08-05T12:00:00', {
    shareOf: W.ORDER_CHARGES,
    linkedOrderId: 'o1',
  });
  const rtoShare = entry('store-1', D.FEE_SHARE, 15, '2026-09-02T10:00:00', {
    shareOf: W.RTO_FEE,
    linkedOrderId: 'o1',
  });
  return {
    sellerStore: [
      {
        id: 'store-1',
        sellerId: 'x1',
        kind: SellerStoreKind.RESELLER,
        createdAt: ist('2026-07-10T09:00:00'),
      },
      {
        id: 'store-2',
        sellerId: 'x1',
        kind: SellerStoreKind.RESELLER,
        createdAt: ist('2026-07-10T09:00:00'),
      },
    ],
    order: [
      { id: 'o1', orderNumber: 'SD-1', storeId: 'store-1' },
      { id: 'o2', orderNumber: 'SD-2', storeId: 'store-1' },
      { id: 'o9', orderNumber: 'SD-9', storeId: 'store-2' },
    ],
    orderItem: [
      {
        orderId: 'o1',
        quantity: 2,
        resellerRetailUnitInr: d(150),
        resellerTransferPriceInr: d(100),
      },
      {
        orderId: 'o2',
        quantity: 1,
        resellerRetailUnitInr: d(400),
        resellerTransferPriceInr: d(230),
      },
      { orderId: 'o9', quantity: 1, resellerRetailUnitInr: d(999), resellerTransferPriceInr: d(1) },
    ],
    storeWalletEntry: [
      entry('store-1', D.ORDER_CREDIT, 100, '2026-08-05T12:00:00', { linkedOrderId: 'o1' }),
      feeShare,
      entry('store-1', D.COD_TAX_SHARE, 5, '2026-08-05T12:00:00', { linkedOrderId: 'o1' }),
      // Gives the fee share back: comes off the line that counted it, by its link.
      entry('store-1', D.SHARE_REFUND, 20, '2026-08-20T12:00:00', {
        linkedOrderId: 'o1',
        linkedEntryId: feeShare['id'],
      }),
      // One second before midnight IST on 31 Aug: August.
      entry('store-1', D.PREPAID_DEBIT, 250, '2026-08-31T23:59:59', { linkedOrderId: 'o2' }),
      entry('store-1', D.TOPUP, 1000, '2026-08-10T10:00:00'),
      rtoShare,
      entry('store-1', D.ORDER_CREDIT_REVERSAL, 100, '2026-09-02T10:00:00', {
        linkedOrderId: 'o1',
      }),
      // A refund whose own share_of says nothing — its LINK says it is a return fee.
      entry('store-1', D.SHARE_REFUND, 5, '2026-09-03T10:00:00', {
        linkedOrderId: 'o1',
        linkedEntryId: rtoShare['id'],
      }),
      entry('store-1', D.PREPAID_REFUND, 250, '2026-09-10T10:00:00', { linkedOrderId: 'o2' }),
      entry('store-1', D.WITHDRAWAL, 300, '2026-09-15T10:00:00'),
      // Another store's money never reaches this store's report.
      entry('store-2', D.ORDER_CREDIT, 777, '2026-08-05T12:00:00', { linkedOrderId: 'o9' }),
    ],
    storeExpense: [
      {
        id: 'x-ad',
        storeId: 'store-1',
        category: StoreExpenseCategory.AD_SPEND,
        amountInr: d(500),
        expenseDate: new Date('2026-08-31T00:00:00.000Z'),
        description: 'Meta ads',
        deletedAt: null,
      },
      {
        id: 'x-sep',
        storeId: 'store-1',
        category: StoreExpenseCategory.OTHER,
        amountInr: d(100),
        expenseDate: new Date('2026-09-01T00:00:00.000Z'),
        description: 'Boxes',
        deletedAt: null,
      },
      {
        id: 'x-gone',
        storeId: 'store-1',
        category: StoreExpenseCategory.RENT,
        amountInr: d(9999),
        expenseDate: new Date('2026-08-15T00:00:00.000Z'),
        description: 'Typed by mistake',
        deletedAt: new Date('2026-08-16T00:00:00.000Z'),
      },
      {
        id: 'x-other',
        storeId: 'store-2',
        category: StoreExpenseCategory.OTHER,
        amountInr: d(1),
        expenseDate: new Date('2026-08-15T00:00:00.000Z'),
        description: 'Other store',
        deletedAt: null,
      },
    ],
  };
}

export function serviceOver(tables: Tables): StorePnlService {
  const db = new FakeDb(tables);
  return new StorePnlService({ client: db.client() } as unknown as PrismaService);
}
