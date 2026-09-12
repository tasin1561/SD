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

function makeSut(opts: { taken?: string[] } = {}) {
  const update = jest.fn(
    async (_a: { where: { id: string }; data: Record<string, unknown> }) => ({}),
  );
  const createMany = jest.fn(async (_a: { data: Array<Record<string, unknown>> }) => ({
    count: 1,
  }));
  // The parcel's stored charges, by waybill: ₹40 under the waybill we hold
  // and ₹60 under the one Shiprocket replaced.
  const groupBy = jest.fn(async (a: { where: Record<string, unknown> }) => {
    const inList = (a.where['awbNumber'] as { in?: string[] } | undefined)?.in ?? [];
    return [
      { awbNumber: 'NEW-AWB', amount: '40.00' },
      { awbNumber: 'OLD-AWB', amount: '60.00' },
    ]
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
      return [
        {
          id: 'sh-1',
          awbNumber: 'NEW-AWB',
          courierOrderId: 'SR-ORDER-1',
          actualCourierCostInr: null,
          actualRtoCostInr: null,
          courierAccountId: 'acct-sr',
          orderShipments: [],
        },
      ];
    }
    // The guard: is a would-be alias some shipment's own waybill?
    return (opts.taken ?? []).map((awbNumber) => ({ awbNumber }));
  });
  const client = {
    courierWalletTransaction: {
      findMany: jest.fn(async (a: { where: Record<string, unknown> }) =>
        a.where['courierOrderRef'] !== undefined
          ? [
              { awbNumber: 'OLD-AWB', courierOrderRef: 'SR-ORDER-1' },
              { awbNumber: 'NEW-AWB', courierOrderRef: 'SR-ORDER-1' },
            ]
          : [],
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

const run = (svc: WalletImportService) =>
  svc.importTransactions({
    courierCode: 'shiprocket',
    courierAccountId: 'acct-sr',
    txns: [TXN],
    periodFrom: new Date('2026-09-01T00:00:00Z'),
    periodTo: new Date('2026-09-08T12:00:00Z'),
    rowsRead: 1,
    rowsSkipped: 0,
    sumInr: '40.00',
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
});
