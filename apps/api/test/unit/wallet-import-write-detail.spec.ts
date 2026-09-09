import { Prisma } from '@skydrop/db';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import * as parser from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * WHICH parcels a run wrote a cost against.
 *
 * The import reported counts and nothing else, so a run that said it
 * wrote sixteen could not tell anybody which sixteen orders had just
 * changed cost — and therefore which margins had moved. The detail
 * rides on the result because the result is what the audit row already
 * records: no new table, and so no second copy of a fact to drift.
 */
jest.mock('../../src/modules/wallet-ledger/services/wallet-ledger-parser', () => ({
  ...jest.requireActual('../../src/modules/wallet-ledger/services/wallet-ledger-parser'),
  parseWalletLedger: jest.fn(),
}));

const charge = (awb: string, amount: string, rto = false): parser.LedgerCharge => ({
  awbNumber: awb,
  amountInr: amount,
  txnId: `txn-${awb}`,
  chargedAt: new Date('2026-09-08T10:00:00Z'),
  shipmentStatus: rto ? 'RTO' : 'Delivered',
  isRto: rto,
});

function makeSut(
  shipments: Array<{
    id: string;
    awbNumber: string;
    actualCourierCostInr: Prisma.Decimal | null;
    actualRtoCostInr: Prisma.Decimal | null;
    orderNumber: string | null;
  }>,
) {
  const update = jest.fn(async () => ({}));
  const client = {
    shipment: {
      findMany: async () =>
        shipments.map((s) => ({
          id: s.id,
          awbNumber: s.awbNumber,
          actualCourierCostInr: s.actualCourierCostInr,
          actualRtoCostInr: s.actualRtoCostInr,
          courierAccountId: null,
          orderShipments: s.orderNumber === null ? [] : [{ order: { orderNumber: s.orderNumber } }],
        })),
      update,
    },
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { svc, update };
}

function parsed(forward: parser.LedgerCharge[], rto: parser.LedgerCharge[] = []): void {
  (parser.parseWalletLedger as jest.Mock).mockReturnValue({
    forward: new Map(forward.map((c) => [c.awbNumber, c])),
    rto: new Map(rto.map((c) => [c.awbNumber, c])),
    rowsRead: forward.length + rto.length,
    rowsSkipped: 0,
    sumInr: '100.00',
    statedTotalInr: '100.00',
    periodFrom: new Date('2026-09-01T00:00:00Z'),
    periodTo: new Date('2026-09-08T00:00:00Z'),
  });
}

const FILE = Buffer.from('not really a spreadsheet — the parser is mocked');

describe('an import says which parcels it wrote', () => {
  it('names the order and the waybill, with the amount', async () => {
    parsed([charge('DL111', '42.50')]);
    const { svc } = makeSut([
      {
        id: 's1',
        awbNumber: 'DL111',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000001',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.forwardWritten).toBe(1);
    expect(r.writes).toEqual([
      {
        awbNumber: 'DL111',
        orderNumber: 'SD-2026-26-000001',
        leg: 'forward',
        amountInr: '42.5',
        revised: false,
      },
    ]);
  });

  it('marks a figure that MOVED as revised', async () => {
    // The normal case on a later export, and a different fact from a
    // first reading: it means a margin changed under somebody.
    parsed([charge('DL222', '60.00')]);
    const { svc } = makeSut([
      {
        id: 's2',
        awbNumber: 'DL222',
        actualCourierCostInr: new Prisma.Decimal('42.50'),
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000002',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.revised).toBe(1);
    expect(r.writes[0]).toMatchObject({ revised: true, amountInr: '60' });
  });

  it('lists the parcels a DRY RUN would have written', async () => {
    // The point of a dry run is showing what it WOULD change, so a list
    // that emptied itself here would be missing from the one mode that
    // exists to preview.
    parsed([charge('DL333', '15.00')]);
    const { svc, update } = makeSut([
      {
        id: 's3',
        awbNumber: 'DL333',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000003',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, { dryRun: true });

    expect(r.writes).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('says nothing about a parcel whose cost did not change', async () => {
    // An unchanged row is not a write, and listing it would make a
    // re-import of the same file look like sixteen things happening.
    parsed([charge('DL444', '42.50')]);
    const { svc } = makeSut([
      {
        id: 's4',
        awbNumber: 'DL444',
        actualCourierCostInr: new Prisma.Decimal('42.50'),
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000004',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.unchanged).toBe(1);
    expect(r.writes).toEqual([]);
  });

  it('tells the return leg apart from the delivery', async () => {
    parsed([], [charge('DL555', '30.00', true)]);
    const { svc } = makeSut([
      {
        id: 's5',
        awbNumber: 'DL555',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000005',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.rtoWritten).toBe(1);
    expect(r.writes[0]).toMatchObject({ leg: 'rto' });
  });

  it('an unlinked parcel is listed by waybill rather than dropped', async () => {
    // The courier charged for it either way; hiding it would understate
    // what the run did.
    parsed([charge('DL666', '20.00')]);
    const { svc } = makeSut([
      {
        id: 's6',
        awbNumber: 'DL666',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: null,
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.writes[0]).toMatchObject({ awbNumber: 'DL666', orderNumber: null });
  });

  it('caps the list and says how many it left out', async () => {
    // The list travels inside an audit row's JSON; unbounded, one huge
    // import could bloat the largest table we keep. The COUNT stays
    // exact.
    const charges = Array.from({ length: 105 }, (_, i) => charge(`DL${i}`, '10.00'));
    parsed(charges);
    const { svc } = makeSut(
      charges.map((c, i) => ({
        id: `s${i}`,
        awbNumber: c.awbNumber,
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: `SD-X-${i}`,
      })),
    );

    const r = await svc.importDelhiveryWallet(FILE, null, {});

    expect(r.forwardWritten).toBe(105);
    expect(r.writes).toHaveLength(100);
    expect(r.writesTruncated).toBe(5);
  });
});
