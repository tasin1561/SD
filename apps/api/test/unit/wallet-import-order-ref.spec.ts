import { Prisma } from '@skydrop/db';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { LedgerTxn } from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * A parcel's charges follow Shiprocket's ORDER id, not only its waybill.
 *
 * Shiprocket reassigns a parcel a courier will not pick up and issues a
 * new waybill under the same order, so its freight is split across two
 * waybills — order 318478638 was booked ₹… under 80123681105 and the rest
 * under SRSC8592054921. Matched on waybill alone, the half under the old
 * one belonged to no parcel.
 */
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const AT = new Date('2026-09-08T10:00:00Z');

const TXN: LedgerTxn = {
  txnId: 'SRPB-new-1',
  awbNumber: 'NEW-AWB',
  courierOrderRef: 'SR-ORDER-1',
  kind: 'DEBIT',
  category: 'PARCEL',
  leg: 'FORWARD',
  amountInr: '40.00',
  occurredAt: AT,
  status: 'success',
  shipmentStatus: 'Freight Charges · Freight Forward',
  detail: null,
};

type Ship = {
  id: string;
  awbNumber: string;
  courierOrderId: string | null;
  reverseAwbNumber?: string | null;
  supersededAt?: Date | null;
};

const SHIP: Ship = { id: 'sh-1', awbNumber: 'NEW-AWB', courierOrderId: 'SR-ORDER-1' };

function makeSut(
  opts: {
    taken?: string[];
    shipments?: Ship[];
    /** The stored charges, by waybill. */
    stored?: Array<{ awbNumber: string; amount: string }>;
    /** Other waybills filed under our parcels' order ids. */
    filed?: Array<{ awbNumber: string; courierOrderRef: string }>;
  } = {},
) {
  const update = jest.fn(
    async (_a: { where: { id: string }; data: Record<string, unknown> }) => ({}),
  );
  const createMany = jest.fn(async (_a: { data: Array<Record<string, unknown>> }) => ({
    count: 1,
  }));
  // By default ₹40 under the waybill we hold and ₹60 under the one
  // Shiprocket replaced.
  const stored = opts.stored ?? [
    { awbNumber: 'NEW-AWB', amount: '40.00' },
    { awbNumber: 'OLD-AWB', amount: '60.00' },
  ];
  const groupBy = jest.fn(async (a: { where: Record<string, unknown> }) => {
    const inList = (a.where['awbNumber'] as { in?: string[] } | undefined)?.in ?? [];
    return stored
      .filter((r) => inList.includes(r.awbNumber))
      .map((r) => ({
        awbNumber: r.awbNumber,
        leg: 'FORWARD',
        kind: 'DEBIT',
        _sum: { amountInr: D(r.amount) },
        _max: { occurredAt: AT },
      }));
  });
  const shipmentFind = jest.fn(async (a: { where: Record<string, unknown> }) => {
    if (a.where['AND'] !== undefined) {
      return (opts.shipments ?? [SHIP]).map((s) => ({
        id: s.id,
        awbNumber: s.awbNumber,
        courierOrderId: s.courierOrderId,
        reverseAwbNumber: s.reverseAwbNumber ?? null,
        supersededAt: s.supersededAt ?? null,
        deletedAt: null,
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        courierAccountId: 'acct-sr',
        orderShipments: [],
      }));
    }
    // The guard: is a would-be alias some shipment's own waybill?
    return (opts.taken ?? []).map((awbNumber) => ({ awbNumber }));
  });
  const filed = opts.filed ?? [
    { awbNumber: 'OLD-AWB', courierOrderRef: 'SR-ORDER-1' },
    { awbNumber: 'NEW-AWB', courierOrderRef: 'SR-ORDER-1' },
  ];
  const client = {
    courierWalletTransaction: {
      findMany: jest.fn(async (a: { where: Record<string, unknown> }) =>
        a.where['courierOrderRef'] !== undefined ? filed : [],
      ),
      createMany,
      updateMany: jest.fn(async () => ({ count: 0 })),
      groupBy,
    },
    shipment: { findMany: shipmentFind, update },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
  );
  return { svc, update, createMany };
}

const run = (svc: WalletImportService, txns: LedgerTxn[] = [TXN]) =>
  svc.importTransactions({
    courierCode: 'shiprocket',
    courierAccountId: 'acct-sr',
    txns,
    periodFrom: new Date('2026-09-01T00:00:00Z'),
    periodTo: new Date('2026-09-08T12:00:00Z'),
    rowsRead: txns.length,
    rowsSkipped: 0,
    sumInr: txns.reduce((t, x) => t.add(D(x.amountInr)), D('0')).toFixed(2),
    statedTotalInr: null,
    totalsAgree: true,
    impliedClosingInr: '0.00',
    dryRun: false,
    staffId: null,
  });

const forwardWritten = (update: ReturnType<typeof makeSut>['update']): string | undefined =>
  (update.mock.calls[0]?.[0].data['actualCourierCostInr'] as Prisma.Decimal | undefined)?.toFixed(
    2,
  );

/** Every cost written to one shipment, merged. */
const written = (
  update: ReturnType<typeof makeSut>['update'],
  id: string,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [a] of update.mock.calls) {
    if (a.where.id !== id) continue;
    for (const [k, v] of Object.entries(a.data)) {
      if (v instanceof Prisma.Decimal) out[k] = v.toFixed(2);
    }
  }
  return out;
};

describe('a parcel whose waybill Shiprocket replaced', () => {
  it('nets the charges under BOTH waybills into the one parcel', async () => {
    const { svc, update } = makeSut();
    await run(svc);
    expect(update.mock.calls[0]?.[0].where).toEqual({ id: 'sh-1' });
    expect(forwardWritten(update)).toBe('100.00');
  });

  it('never merges a waybill another shipment holds as its own — that is two parcels', async () => {
    const { svc, update } = makeSut({ taken: ['OLD-AWB'] });
    await run(svc);
    expect(forwardWritten(update)).toBe('40.00');
  });

  it('stores their order id with each charge', async () => {
    const { svc, createMany } = makeSut();
    await run(svc);
    expect(createMany.mock.calls[0]?.[0].data[0]).toMatchObject({
      awbNumber: 'NEW-AWB',
      courierOrderRef: 'SR-ORDER-1',
    });
  });

  it('when a retired shipment shares the order id, the LIVE one is the parcel', async () => {
    // sh-old was superseded and holds OLD-AWB; sh-1 is live on NEW-AWB. A
    // third waybill under the same order (₹25) is this parcel's — merged
    // into the retired row, it disappeared from the parcel that shipped.
    const { svc, update } = makeSut({
      shipments: [
        SHIP,
        { id: 'sh-old', awbNumber: 'OLD-AWB', courierOrderId: 'SR-ORDER-1', supersededAt: AT },
      ],
      stored: [
        { awbNumber: 'NEW-AWB', amount: '40.00' },
        { awbNumber: 'OLD-AWB', amount: '60.00' },
        { awbNumber: 'THIRD-AWB', amount: '25.00' },
      ],
      filed: [
        { awbNumber: 'OLD-AWB', courierOrderRef: 'SR-ORDER-1' },
        { awbNumber: 'THIRD-AWB', courierOrderRef: 'SR-ORDER-1' },
      ],
      taken: ['OLD-AWB'],
    });
    await run(svc, [{ ...TXN, txnId: 'SRPB-third', awbNumber: 'THIRD-AWB', amountInr: '25.00' }]);
    expect(written(update, 'sh-1')['actualCourierCostInr']).toBe('65.00');
    // Nothing of the retired booking was in this file, so it is untouched.
    expect(written(update, 'sh-old')).toEqual({});
  });
});

describe('a reverse pickup’s own waybill', () => {
  // Delhivery books a reverse pickup on a waybill of its own. Every charge
  // under it is this parcel coming back.
  const REVERSE: Ship = {
    id: 'sh-1',
    awbNumber: 'FWD-AWB',
    courierOrderId: null,
    reverseAwbNumber: 'REV-AWB',
  };

  it('is netted into the parcel as its return leg — even when the file names only the reverse', async () => {
    // The file carries only the ₹30 reverse charge. The ₹40 forward charge
    // is already stored under the parcel's own waybill; netting the file's
    // waybills alone would write ₹30 as the parcel's whole cost.
    const { svc, update } = makeSut({
      shipments: [REVERSE],
      stored: [
        { awbNumber: 'FWD-AWB', amount: '40.00' },
        { awbNumber: 'REV-AWB', amount: '30.00' },
      ],
      filed: [],
    });
    await run(svc, [
      {
        ...TXN,
        txnId: 'DLV-rev-1',
        awbNumber: 'REV-AWB',
        courierOrderRef: null,
        amountInr: '30.00',
      },
    ]);
    // Returned: the whole net on the return column, ₹0 forward.
    expect(written(update, 'sh-1')).toMatchObject({
      actualCourierCostInr: '0.00',
      actualRtoCostInr: '70.00',
    });
  });

  it('is left alone when another shipment holds it as its own waybill', async () => {
    const { svc, update } = makeSut({
      shipments: [REVERSE],
      stored: [
        { awbNumber: 'FWD-AWB', amount: '40.00' },
        { awbNumber: 'REV-AWB', amount: '30.00' },
      ],
      filed: [],
      taken: ['REV-AWB'],
    });
    await run(svc, [{ ...TXN, txnId: 'DLV-fwd-1', awbNumber: 'FWD-AWB', courierOrderRef: null }]);
    expect(written(update, 'sh-1')).toEqual({ actualCourierCostInr: '40.00' });
  });
});
