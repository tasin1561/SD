import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { LedgerTxn } from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * A waybill is unique only WITHIN a courier.
 *
 * An Xpressbees waybill routed through Shiprocket (14112364794902) has the
 * same fourteen-digit shape as a Delhivery one. Netting a parcel across
 * every account's transactions, or matching a shipment of another courier,
 * would move money between two parcels that merely share a number — so
 * both are scoped, and a Shiprocket passbook reaches only Shiprocket's.
 */
const TXN: LedgerTxn = {
  txnId: 'SRPB-abc-1',
  awbNumber: '14112364794902',
  kind: 'DEBIT',
  category: 'PARCEL',
  leg: 'FORWARD',
  amountInr: '90.36',
  occurredAt: new Date('2026-09-08T10:00:00Z'),
  status: 'success',
  shipmentStatus: 'Freight Charges · Freight Forward',
  detail: null,
};

function makeSut() {
  const groupBy = jest.fn(async (_a: { where: Record<string, unknown> }) => [] as unknown[]);
  const shipmentFind = jest.fn(async (_a: { where: Record<string, unknown> }) => [] as unknown[]);
  const log = jest.fn(async (_a: Record<string, unknown>) => 'a1');
  const client = {
    courierWalletTransaction: {
      findMany: async () => [],
      createMany: jest.fn(async () => ({ count: 1 })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      groupBy,
    },
    shipment: { findMany: shipmentFind, update: jest.fn() },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log } as unknown as AuditLogService,
  );
  return { svc, groupBy, shipmentFind, log };
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
    sumInr: '90.36',
    statedTotalInr: null,
    totalsAgree: true,
    impliedClosingInr: '1646.63',
    dryRun: false,
    staffId: null,
  });

describe('importTransactions — the courier and the account both scope it', () => {
  it('nets a parcel from THIS account’s ledger only', async () => {
    const s = makeSut();
    await run(s.svc);
    expect(s.groupBy.mock.calls[0]?.[0].where).toMatchObject({
      courierAccountId: 'acct-sr',
      awbNumber: { in: ['14112364794902'] },
    });
  });

  it('matches only a shipment the SAME courier carried', async () => {
    const s = makeSut();
    await run(s.svc);
    expect(s.shipmentFind.mock.calls[0]?.[0].where).toMatchObject({ courierCode: 'shiprocket' });
  });

  it('records which courier’s ledger it was', async () => {
    const s = makeSut();
    const out = await run(s.svc);
    expect(out).toMatchObject({ txnsNew: 1, totalsAgree: true, impliedClosingInr: '1646.63' });
    expect(s.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.wallet_ledger.imported',
        metadata: expect.objectContaining({ courierCode: 'shiprocket' }),
      }),
    );
  });
});
