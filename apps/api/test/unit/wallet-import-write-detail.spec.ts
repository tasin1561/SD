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

const charge = (
  awb: string,
  amount: string,
  rto = false,
  kind: 'DEBIT' | 'CREDIT' = 'DEBIT',
): parser.LedgerTxn => ({
  txnId: `txn-${awb}-${kind}-${amount}`,
  awbNumber: awb,
  kind,
  category: 'PARCEL',
  leg: rto ? 'RTO' : 'FORWARD',
  amountInr: amount,
  occurredAt: new Date('2026-09-08T10:00:00Z'),
  status: 'success',
  shipmentStatus: rto ? 'RTO' : 'Delivered',
  detail: null,
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
  // Typed so the assertions below can read the data it was called with.
  const update = jest.fn(async (_args: { data: Record<string, Prisma.Decimal> }) => ({}));
  const createMany = jest.fn(async () => ({ count: LEDGER.length }));
  const client = {
    /*
      The stored ledger, standing in for the table.

      `netFromLedger` reads back what was just inserted rather than
      netting the file, because a 90-day window can hold a credit whose
      debit is older. The fake therefore answers from the same
      transactions the test handed in — which is what the table WOULD
      hold for an account seeing them for the first time.
    */
    courierWalletTransaction: {
      findMany: async () => [],
      createMany,
      groupBy: async () => {
        const acc = new Map<
          string,
          { awbNumber: string; leg: string; kind: string; sum: number }
        >();
        for (const t of LEDGER) {
          if (t.awbNumber === null || t.category !== 'PARCEL') continue;
          const key = `${t.awbNumber}|${t.leg}|${t.kind}`;
          const e = acc.get(key) ?? { awbNumber: t.awbNumber, leg: t.leg, kind: t.kind, sum: 0 };
          e.sum += Number(t.amountInr);
          acc.set(key, e);
        }
        return [...acc.values()].map((e) => ({
          awbNumber: e.awbNumber,
          leg: e.leg,
          kind: e.kind,
          _sum: { amountInr: new Prisma.Decimal(e.sum.toFixed(2)) },
          _max: { occurredAt: new Date('2026-09-08T10:00:00Z') },
        }));
      },
    },
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

/** What the ledger holds for the current test. */
let LEDGER: parser.LedgerTxn[] = [];

function parsed(forward: parser.LedgerTxn[], rto: parser.LedgerTxn[] = []): void {
  const txns = [...forward, ...rto];
  LEDGER = txns;
  (parser.parseWalletLedger as jest.Mock).mockReturnValue({
    txns,
    summary: {
      totalDeductionsInr: '100.00',
      totalRefundsInr: '0.00',
      totalRechargesInr: '0.00',
      openingBalanceInr: '0.00',
    },
    rowsRead: txns.length,
    rowsSkipped: 0,
    netInr: '100.00',
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

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    expect(r.forwardWritten).toBe(1);
    expect(r.writes).toEqual([
      {
        awbNumber: 'DL111',
        orderNumber: 'SD-2026-26-000001',
        leg: 'forward',
        amountInr: '42.5',
        revised: false,
        // A first reading had nothing before it.
        previousInr: null,
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

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

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

    const r = await svc.importDelhiveryWallet(FILE, null, {
      dryRun: true,
      courierAccountId: 'acct-1',
    });

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

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

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

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    expect(r.rtoWritten).toBe(1);
    expect(r.writes.find((w) => w.leg === 'rto')).toMatchObject({ amountInr: '30' });
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

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

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
        awbNumber: c.awbNumber ?? '',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: `SD-X-${i}`,
      })),
    );

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    expect(r.forwardWritten).toBe(105);
    expect(r.writes).toHaveLength(100);
    expect(r.writesTruncated).toBe(5);
  });
});

/**
 * A parcel costs the NET of its transactions.
 *
 * The import used to write the latest successful debit. On 90 days of
 * real data that was wrong for 705 of 11,389 parcels — always
 * OVERSTATING, ₹843,191 against a true ₹775,577 — because Delhivery
 * charges, reverses and re-charges the same waybill.
 */
describe('the cost is debits minus credits', () => {
  it('a fully reversed charge costs ZERO, not the debit', () => {
    // The case that used to be booked at full freight.
    parsed([charge('DL1', '60.04'), charge('DL1', '60.04', false, 'CREDIT')]);
    const { svc, update } = makeSut([
      {
        id: 's1',
        awbNumber: 'DL1',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-1',
      },
    ]);

    return svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' }).then(() => {
      const data = (
        update.mock.calls[0]?.[0] as { data: Record<string, Prisma.Decimal> } | undefined
      )?.data;
      expect(data?.['actualCourierCostInr']?.toString()).toBe('0');
    });
  });

  it('a re-cut charge costs what is left after the reversal', async () => {
    // ₹100 charged, ₹100 refunded, ₹85.65 charged again.
    parsed([
      charge('DL2', '100.00'),
      charge('DL2', '100.00', false, 'CREDIT'),
      charge('DL2', '85.65'),
    ]);
    const { svc, update } = makeSut([
      {
        id: 's2',
        awbNumber: 'DL2',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-2',
      },
    ]);

    await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });
    const data = (update.mock.calls[0]?.[0] as { data: Record<string, Prisma.Decimal> } | undefined)
      ?.data;
    expect(data?.['actualCourierCostInr']?.toString()).toBe('85.65');
  });

  it('two debits on one leg ADD UP', async () => {
    // Not "the latest wins": a surcharge billed after the freight is a
    // second charge for the same parcel, and taking the later one alone
    // would lose the first.
    parsed([charge('DL3', '80.00'), charge('DL3', '20.00')]);
    const { svc, update } = makeSut([
      {
        id: 's3',
        awbNumber: 'DL3',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-3',
      },
    ]);

    await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });
    const data = (update.mock.calls[0]?.[0] as { data: Record<string, Prisma.Decimal> } | undefined)
      ?.data;
    expect(data?.['actualCourierCostInr']?.toString()).toBe('100');
  });

  it('an ADJUSTMENT never touches a parcel’s cost, even carrying its waybill', async () => {
    // 36 of 37 on the real sample carried an AWB. A fraud credit note
    // landing on a parcel would quietly make it look profitable.
    const adj: parser.LedgerTxn = {
      ...charge('DL4', '58.83'),
      txnId: 'adj-1',
      category: 'ADJUSTMENT',
    };
    parsed([charge('DL4', '40.00'), adj]);
    const { svc, update } = makeSut([
      {
        id: 's4',
        awbNumber: 'DL4',
        actualCourierCostInr: null,
        actualRtoCostInr: null,
        orderNumber: 'SD-4',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });
    const data = (update.mock.calls[0]?.[0] as { data: Record<string, Prisma.Decimal> } | undefined)
      ?.data;
    expect(data?.['actualCourierCostInr']?.toString()).toBe('40');
    // …and it is reported on its own line rather than vanishing.
    expect(r.adjustments).toBe(1);
    expect(r.adjustmentsNetInr).toBe('58.83');
  });
});

/**
 * A parcel that came BACK.
 *
 * When a parcel turns round Delhivery refunds the delivery charge and
 * bills one combined return charge, and both rows carry the status
 * "RTO". Netted per leg, that refund landed on the return leg: 301
 * parcels on the 90-day sample read a NEGATIVE return cost, and the P&L —
 * which reads a returned parcel from the return column — reported
 * ₹73.51 for a parcel that cost ₹151.91.
 */
describe('a returned parcel is costed as a whole', () => {
  const ours = (awb: string) => ({
    id: `s-${awb}`,
    awbNumber: awb,
    actualCourierCostInr: null,
    actualRtoCostInr: null,
    orderNumber: null,
  });

  it('the refund of its delivery charge does not come off the return cost', async () => {
    // 38061110524086, as it really happened.
    parsed(
      [charge('DL524086', '78.40')],
      [charge('DL524086', '151.91', true), charge('DL524086', '78.40', true, 'CREDIT')],
    );
    const { svc, update } = makeSut([ours('DL524086')]);

    await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    const data = update.mock.calls.map((c) => c[0].data);
    // Delivery refunded, so ₹0 forward; the whole cost on the return.
    expect(
      data.find((d) => 'actualCourierCostInr' in d)?.['actualCourierCostInr']?.toString(),
    ).toBe('0');
    expect(data.find((d) => 'actualRtoCostInr' in d)?.['actualRtoCostInr']?.toString()).toBe(
      '151.91',
    );
  });

  it('the two columns ADD UP to what it cost, refund or not', async () => {
    // A manual-style bill: both legs charged, nothing refunded.
    parsed([charge('DL777', '57.46')], [charge('DL777', '56.28', true)]);
    const { svc, update } = makeSut([ours('DL777')]);

    await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    const data = update.mock.calls.map((c) => c[0].data);
    const fwd = data.find((d) => 'actualCourierCostInr' in d)?.['actualCourierCostInr'];
    const rto = data.find((d) => 'actualRtoCostInr' in d)?.['actualRtoCostInr'];
    expect(fwd?.add(rto ?? 0).toString()).toBe('113.74');
  });
});

describe('a parcel that nets below zero is never stamped', () => {
  it('leaves the old figure, and names the parcel when it is OURS', async () => {
    // A refund with its debit missing — dated before our ledger began, or
    // vanished. Stamping −₹60 would subtract money from the P&L.
    parsed([charge('DL-NEG', '60.00', false, 'CREDIT')]);
    const { svc, update } = makeSut([
      {
        id: 's-neg',
        awbNumber: 'DL-NEG',
        actualCourierCostInr: new Prisma.Decimal('60'),
        actualRtoCostInr: null,
        orderNumber: 'SD-2026-26-000009',
      },
    ]);

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    expect(update).not.toHaveBeenCalled();
    expect(r.incompleteHistory).toBe(1);
    expect(r.incomplete).toEqual([{ awbNumber: 'DL-NEG', netInr: '-60.00' }]);
  });

  it('says nothing about somebody else’s parcel', async () => {
    parsed([charge('NOT-OURS', '60.00', false, 'CREDIT')]);
    const { svc } = makeSut([]);

    const r = await svc.importDelhiveryWallet(FILE, null, { courierAccountId: 'acct-1' });

    expect(r.incompleteHistory).toBe(0);
  });
});
