import { BadRequestException } from '@nestjs/common';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import * as parser from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * An import must know WHOSE ledger it is.
 *
 * Every transaction is stored under a courier account, and a parcel's
 * cost is then netted from what the TABLE holds. So an import with no
 * account stored nothing and netted a ledger that did not contain the
 * file — silently writing costs from whatever was already there. The
 * manual upload was exactly that shape: its controller never passed an
 * account.
 */
jest.mock('../../src/modules/wallet-ledger/services/wallet-ledger-parser', () => ({
  ...jest.requireActual('../../src/modules/wallet-ledger/services/wallet-ledger-parser'),
  parseWalletLedger: jest.fn(),
}));

const TXN: parser.LedgerTxn = {
  txnId: 'MTX1',
  awbNumber: 'DL1',
  kind: 'DEBIT',
  category: 'PARCEL',
  leg: 'FORWARD',
  amountInr: '40.00',
  occurredAt: new Date('2026-09-08T10:00:00Z'),
  status: 'success',
  shipmentStatus: 'Delivered',
  detail: null,
};

function makeSut(defaultAccount: { id: string } | null) {
  (parser.parseWalletLedger as jest.Mock).mockReturnValue({
    txns: [TXN],
    summary: {
      totalDeductionsInr: '40.00',
      totalRefundsInr: '0.00',
      totalRechargesInr: '0.00',
      openingBalanceInr: '0.00',
    },
    rowsRead: 1,
    rowsSkipped: 0,
    netInr: '40.00',
    sumInr: '40.00',
    statedTotalInr: '40.00',
    periodFrom: new Date('2026-09-01T00:00:00Z'),
    periodTo: new Date('2026-09-08T00:00:00Z'),
  });

  const findFirst = jest.fn(async () => defaultAccount);
  const createMany = jest.fn(async (_args: { data: Array<{ courierAccountId: string }> }) => ({
    count: 1,
  }));
  const client = {
    courierAccount: { findFirst },
    courierWalletTransaction: {
      findMany: async () => [],
      createMany,
      groupBy: async () => [],
    },
    shipment: { findMany: async () => [], update: jest.fn() },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
  );
  return { svc, findFirst, createMany };
}

const FILE = Buffer.from('parser is mocked');

describe('an import is filed under an account', () => {
  it('uses the default Delhivery account when the caller does not say', async () => {
    const { svc, createMany } = makeSut({ id: 'acct-default' });

    await svc.importDelhiveryWallet(FILE, 'staff-1', {});

    // The transaction was STORED — and under the default account.
    expect(createMany.mock.calls[0]?.[0].data[0]?.courierAccountId).toBe('acct-default');
  });

  it('REFUSES rather than guessing when there is no default account', async () => {
    // Filing one company's ledger under another's would make "not ours"
    // meaningless on both — so no account is an error, not a shrug.
    const { svc, createMany } = makeSut(null);

    await expect(svc.importDelhiveryWallet(FILE, 'staff-1', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it('an explicit account wins, and the default is never looked up', async () => {
    const { svc, findFirst, createMany } = makeSut({ id: 'acct-default' });

    await svc.importDelhiveryWallet(FILE, 'staff-1', { courierAccountId: 'acct-chosen' });

    expect(findFirst).not.toHaveBeenCalled();
    expect(createMany.mock.calls[0]?.[0].data[0]?.courierAccountId).toBe('acct-chosen');
  });
});
