import { Prisma } from '@skydrop/db';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import * as parser from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * A transaction their ledger DROPPED, and one they CHANGED.
 *
 * Mutation detection compares a transaction against itself, so it cannot
 * see one that is simply gone — and on 2026-09-11 four debits dated 7 Sep
 * were in that night's export and absent from a 90-day export covering
 * the same day. Only the span the file actually covers is judged; a row
 * dated outside it is not "missing", the file just does not reach it.
 *
 * The real-database half (that a stamped row stops counting in the cost)
 * is `wallet-import.e2e-spec.ts`; this pins the decisions.
 */
jest.mock('../../src/modules/wallet-ledger/services/wallet-ledger-parser', () => ({
  ...jest.requireActual('../../src/modules/wallet-ledger/services/wallet-ledger-parser'),
  parseWalletLedger: jest.fn(),
}));

const ACCT = 'acct-1';
const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-09-08T00:00:00Z');

const txn = (txnId: string, amount = '40.00'): parser.LedgerTxn => ({
  txnId,
  awbNumber: 'DL1',
  kind: 'DEBIT',
  category: 'PARCEL',
  leg: 'FORWARD',
  amountInr: amount,
  occurredAt: new Date('2026-09-05T10:00:00Z'),
  status: 'success',
  shipmentStatus: 'Delivered',
  detail: null,
});

interface HeldRow {
  id: string;
  courierAccountId: string;
  txnId: string;
  awbNumber: string | null;
  kind: string;
  amountInr: Prisma.Decimal;
  occurredAt: Date;
  missingFromExportAt: Date | null;
}

const held = (txnId: string, occurredAt: Date, extra: Partial<HeldRow> = {}): HeldRow => ({
  id: `row-${txnId}`,
  courierAccountId: ACCT,
  txnId,
  awbNumber: 'DL1',
  kind: 'DEBIT',
  amountInr: new Prisma.Decimal('40.00'),
  occurredAt,
  missingFromExportAt: null,
  ...extra,
});

interface FindManyArgs {
  where: {
    courierAccountId: string;
    txnId?: { in: string[] };
    occurredAt?: { gte: Date; lte: Date };
  };
}

function makeSut(
  file: parser.LedgerTxn[],
  table: HeldRow[],
  ships: Array<Record<string, unknown>> = [],
) {
  (parser.parseWalletLedger as jest.Mock).mockReturnValue({
    txns: file,
    summary: {
      totalDeductionsInr: null,
      totalRefundsInr: null,
      totalRechargesInr: null,
      openingBalanceInr: null,
    },
    rowsRead: file.length,
    rowsSkipped: 0,
    netInr: '0.00',
    sumInr: '0.00',
    statedTotalInr: null,
    periodFrom: FROM,
    periodTo: TO,
  });

  // Honours the two query shapes the service uses, so a row outside the
  // span is genuinely not returned rather than filtered by the test.
  const findMany = jest.fn(async ({ where }: FindManyArgs) =>
    table.filter(
      (r) =>
        r.courierAccountId === where.courierAccountId &&
        (where.txnId === undefined || where.txnId.in.includes(r.txnId)) &&
        (where.occurredAt === undefined ||
          (r.occurredAt >= where.occurredAt.gte && r.occurredAt <= where.occurredAt.lte)),
    ),
  );
  const updateMany = jest.fn(
    async (_args: {
      where: { id: { in: string[] } };
      data: { missingFromExportAt: Date | null };
    }) => ({
      count: 0,
    }),
  );
  const groupBy = jest.fn(async (_args: { where: Record<string, unknown> }) => []);
  const shipUpdate = jest.fn(async (_args: { where: { id: string }; data: unknown }) => ({}));
  const client = {
    courierWalletTransaction: {
      findMany,
      updateMany,
      groupBy,
      createMany: jest.fn(async () => ({ count: 0 })),
    },
    shipment: { findMany: async () => ships, update: shipUpdate },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
  );
  return { svc, updateMany, groupBy, shipUpdate };
}

const FILE = Buffer.from('parser is mocked');

describe('a transaction the export no longer contains', () => {
  it('is reported and STAMPED — kept as evidence, not deleted', async () => {
    const { svc, updateMany } = makeSut(
      [txn('MTX-KEPT')],
      [
        held('MTX-KEPT', new Date('2026-09-05T10:00:00Z')),
        held('MTX-GONE', new Date('2026-09-07T10:00:00Z')),
      ],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(r.txnsMissing).toBe(1);
    expect(r.missing).toEqual([
      expect.objectContaining({ txnId: 'MTX-GONE', amountInr: '40', kind: 'DEBIT' }),
    ]);
    const stamp = updateMany.mock.calls.find((c) => c[0].data.missingFromExportAt !== null);
    expect(stamp?.[0].where.id.in).toEqual(['row-MTX-GONE']);
  });

  it('a row dated OUTSIDE the file’s span is not missing — the file just does not reach it', async () => {
    const { svc, updateMany } = makeSut(
      [txn('MTX-KEPT')],
      [
        held('MTX-KEPT', new Date('2026-09-05T10:00:00Z')),
        held('MTX-JUNE', new Date('2026-06-15T10:00:00Z')),
      ],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(r.txnsMissing).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a transaction that REAPPEARS has its stamp cleared', async () => {
    // A transient omission corrects itself instead of haunting the ledger.
    const { svc, updateMany } = makeSut(
      [txn('MTX-BACK')],
      [held('MTX-BACK', new Date('2026-09-05T10:00:00Z'), { missingFromExportAt: new Date() })],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(r.txnsMissing).toBe(0);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-MTX-BACK'] } },
      data: { missingFromExportAt: null },
    });
  });

  it('is not stamped TWICE — the first sighting is the date that matters', async () => {
    const { svc, updateMany } = makeSut(
      [txn('MTX-KEPT')],
      [
        held('MTX-KEPT', new Date('2026-09-05T10:00:00Z')),
        held('MTX-GONE', new Date('2026-09-07T10:00:00Z'), {
          missingFromExportAt: new Date('2026-09-09T00:00:00Z'),
        }),
      ],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    // Still reported, every run, until it comes back.
    expect(r.txnsMissing).toBe(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a dry run reports it and stamps nothing', async () => {
    const { svc, updateMany } = makeSut(
      [txn('MTX-KEPT')],
      [
        held('MTX-KEPT', new Date('2026-09-05T10:00:00Z')),
        held('MTX-GONE', new Date('2026-09-07T10:00:00Z')),
      ],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT, dryRun: true });

    expect(r.txnsMissing).toBe(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a parcel whose EVERY transaction vanished has its cost cleared to unknown', async () => {
    // DL2's only debit is gone from a file whose span covers it, and the
    // file no longer names DL2 at all. Left alone, its ₹40 stood with
    // nothing behind it; it is cleared to null (uncovered), never ₹0.
    const { svc, shipUpdate } = makeSut(
      [txn('MTX-KEPT')],
      [
        held('MTX-KEPT', new Date('2026-09-05T10:00:00Z')),
        held('MTX-GONE', new Date('2026-09-07T10:00:00Z'), { awbNumber: 'DL2' }),
      ],
      [
        {
          id: 'ship-2',
          awbNumber: 'DL2',
          actualCourierCostInr: new Prisma.Decimal('40.00'),
          actualRtoCostInr: null,
          courierAccountId: ACCT,
          orderShipments: [],
        },
      ],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(r.costsCleared).toBe(1);
    expect(shipUpdate).toHaveBeenCalledWith({
      where: { id: 'ship-2' },
      data: { actualCourierCostInr: null, actualRtoCostInr: null },
    });
  });

  it('the cost is netted WITHOUT stamped rows', async () => {
    const { svc, groupBy } = makeSut([txn('MTX-KEPT')], []);

    await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(groupBy.mock.calls[0]?.[0].where).toMatchObject({ missingFromExportAt: null });
  });
});

describe('a transaction the export CHANGED', () => {
  it('names ours against theirs, and never rewrites our copy', async () => {
    const { svc } = makeSut(
      [txn('MTX-EDITED', '35.00')],
      [held('MTX-EDITED', new Date('2026-09-05T10:00:00Z'))],
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: ACCT });

    expect(r.txnsMutated).toBe(1);
    expect(r.mutated).toEqual([
      {
        txnId: 'MTX-EDITED',
        awbNumber: 'DL1',
        ourKind: 'DEBIT',
        theirKind: 'DEBIT',
        ourAmountInr: '40',
        theirAmountInr: '35.00',
      },
    ]);
    // Already held, so not inserted again either.
    expect(r.txnsNew).toBe(0);
  });
});
