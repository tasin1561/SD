import { Prisma } from '@skydrop/db';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { LedgerTxn } from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * A dry run must preview what the real import WILL write — which nets
 * from our stored ledger, not from the file. It used to net the file
 * alone, so a preview of a file naming only a parcel's return charge
 * showed that charge as the parcel's whole cost.
 */
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const BEFORE = new Date('2026-08-01T10:00:00Z');
const IN_WINDOW = new Date('2026-09-05T10:00:00Z');

interface StoredRow {
  txnId: string;
  awbNumber: string;
  leg: 'FORWARD' | 'RTO';
  kind: 'DEBIT' | 'CREDIT';
  amount: string;
  occurredAt: Date;
  missing: Date | null;
}

const FWD_DEBIT: StoredRow = {
  txnId: 'T-fwd',
  awbNumber: 'AWB-1',
  leg: 'FORWARD',
  kind: 'DEBIT',
  amount: '40.00',
  occurredAt: BEFORE,
  missing: null,
};

const RTO_TXN: LedgerTxn = {
  txnId: 'T-rto',
  awbNumber: 'AWB-1',
  courierOrderRef: null,
  kind: 'DEBIT',
  category: 'PARCEL',
  leg: 'RTO',
  amountInr: '30.00',
  occurredAt: IN_WINDOW,
  status: 'success',
  shipmentStatus: 'RTO',
  detail: null,
};

function makeSut(stored: StoredRow[]) {
  const update = jest.fn(async () => ({}));
  const createMany = jest.fn(async () => ({ count: 1 }));
  const updateMany = jest.fn(async () => ({ count: 0 }));
  // Applies the where-clause the way Postgres would: waybill, the
  // missing stamp (or a reinstated id), and any excluded ids.
  const groupBy = jest.fn(async (a: { where: Record<string, unknown> }) => {
    const w = a.where;
    const awbs = (w['awbNumber'] as { in: string[] }).in;
    const notIn = (w['txnId'] as { notIn?: string[] } | undefined)?.notIn ?? [];
    const or = w['OR'] as Array<Record<string, unknown>> | undefined;
    const reinstate = (or?.[1]?.['txnId'] as { in?: string[] } | undefined)?.in ?? [];
    const rows = stored.filter(
      (r) =>
        awbs.includes(r.awbNumber) &&
        !notIn.includes(r.txnId) &&
        (r.missing === null || reinstate.includes(r.txnId)),
    );
    const groups = new Map<string, { sum: Prisma.Decimal; max: Date; r: StoredRow }>();
    for (const r of rows) {
      const k = `${r.awbNumber}|${r.leg}|${r.kind}`;
      const g = groups.get(k);
      groups.set(k, {
        sum: (g?.sum ?? D('0')).add(D(r.amount)),
        max: g === undefined || r.occurredAt > g.max ? r.occurredAt : g.max,
        r,
      });
    }
    return [...groups.values()].map((g) => ({
      awbNumber: g.r.awbNumber,
      leg: g.r.leg,
      kind: g.r.kind,
      _sum: { amountInr: g.sum },
      _max: { occurredAt: g.max },
    }));
  });
  const findMany = jest.fn(async (a: { where: Record<string, unknown> }) => {
    const w = a.where;
    if (w['txnId'] !== undefined) {
      const ids = (w['txnId'] as { in: string[] }).in;
      return stored
        .filter((r) => ids.includes(r.txnId))
        .map((r) => ({
          txnId: r.txnId,
          amountInr: D(r.amount),
          kind: r.kind,
          awbNumber: r.awbNumber,
        }));
    }
    if (w['occurredAt'] !== undefined) {
      const { gte, lte } = w['occurredAt'] as { gte: Date; lte: Date };
      return stored
        .filter((r) => r.occurredAt >= gte && r.occurredAt <= lte)
        .map((r) => ({
          id: `id-${r.txnId}`,
          txnId: r.txnId,
          awbNumber: r.awbNumber,
          kind: r.kind,
          amountInr: D(r.amount),
          occurredAt: r.occurredAt,
          missingFromExportAt: r.missing,
        }));
    }
    return [];
  });
  const client = {
    courierWalletTransaction: { findMany, createMany, updateMany, groupBy },
    shipment: {
      findMany: jest.fn(async (a: { where: Record<string, unknown> }) =>
        a.where['AND'] === undefined
          ? []
          : [
              {
                id: 'sh-1',
                awbNumber: 'AWB-1',
                courierOrderId: null,
                reverseAwbNumber: null,
                supersededAt: null,
                deletedAt: null,
                actualCourierCostInr: D('40.00'),
                actualRtoCostInr: null,
                courierAccountId: 'acct-1',
                orderShipments: [],
              },
            ],
      ),
      update,
    },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
  );
  return { svc, update, createMany, updateMany };
}

const run = (svc: WalletImportService, txns: LedgerTxn[], dryRun: boolean) =>
  svc.importTransactions({
    courierCode: 'delhivery',
    courierAccountId: 'acct-1',
    txns,
    periodFrom: new Date('2026-09-01T00:00:00Z'),
    periodTo: new Date('2026-09-08T00:00:00Z'),
    rowsRead: txns.length,
    rowsSkipped: 0,
    sumInr: '0.00',
    statedTotalInr: null,
    totalsAgree: true,
    impliedClosingInr: '0.00',
    dryRun,
    staffId: null,
  });

const planned = (writes: ReadonlyArray<{ leg: string; amountInr: string }>) =>
  Object.fromEntries(writes.map((w) => [w.leg, D(w.amountInr).toFixed(2)]));

describe('a wallet-import dry run', () => {
  it('nets the STORED ledger plus the file’s new rows — never the file alone', async () => {
    // Stored: the ₹40 forward charge. File: only the new ₹30 return charge.
    // The real import would write ₹0 forward and ₹70 return.
    const { svc, update, createMany } = makeSut([FWD_DEBIT]);
    const result = await run(svc, [RTO_TXN], true);
    expect(planned(result.writes)).toEqual({ forward: '0.00', rto: '70.00' });
    // And it wrote nothing.
    expect(update).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('never counts a row twice when the file repeats one we already hold', async () => {
    const { svc } = makeSut([{ ...FWD_DEBIT, occurredAt: IN_WINDOW }]);
    const again: LedgerTxn = {
      ...RTO_TXN,
      txnId: 'T-fwd',
      leg: 'FORWARD',
      amountInr: '40.00',
      shipmentStatus: 'In Transit',
    };
    const result = await run(svc, [again, RTO_TXN], true);
    expect(planned(result.writes)).toEqual({ forward: '0.00', rto: '70.00' });
  });

  it('leaves out a held row the file shows has vanished, as the real run would', async () => {
    const gone: StoredRow = {
      txnId: 'T-gone',
      awbNumber: 'AWB-1',
      leg: 'FORWARD',
      kind: 'DEBIT',
      amount: '25.00',
      occurredAt: IN_WINDOW,
      missing: null,
    };
    const { svc, updateMany } = makeSut([FWD_DEBIT, gone]);
    const result = await run(svc, [RTO_TXN], true);
    expect(planned(result.writes)).toEqual({ forward: '0.00', rto: '70.00' });
    expect(result.txnsMissing).toBe(1);
    // The stamp itself is not written in a dry run.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('counts a held row the file shows has REAPPEARED', async () => {
    const back: StoredRow = {
      txnId: 'T-back',
      awbNumber: 'AWB-1',
      leg: 'FORWARD',
      kind: 'DEBIT',
      amount: '5.00',
      occurredAt: IN_WINDOW,
      missing: new Date('2026-09-06T00:00:00Z'),
    };
    const { svc } = makeSut([FWD_DEBIT, back]);
    const reappeared: LedgerTxn = {
      ...RTO_TXN,
      txnId: 'T-back',
      leg: 'FORWARD',
      amountInr: '5.00',
      shipmentStatus: 'In Transit',
    };
    const result = await run(svc, [reappeared, RTO_TXN], true);
    expect(planned(result.writes)).toEqual({ forward: '0.00', rto: '75.00' });
  });
});
