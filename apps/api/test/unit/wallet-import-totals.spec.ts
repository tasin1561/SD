import { BadRequestException } from '@nestjs/common';
import { WalletImportService } from '../../src/modules/wallet-ledger/services/wallet-import.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import * as parser from '../../src/modules/wallet-ledger/services/wallet-ledger-parser';

/**
 * The file's refunds must add up to its own Summary, as its deductions do.
 *
 * Only deductions were checked, so a credit the parse dropped — a refund,
 * a credit note, a courier expense given back — went missing with the
 * totals still reading "agree", and the cost it should have reduced was
 * overstated.
 */
jest.mock('../../src/modules/wallet-ledger/services/wallet-ledger-parser', () => ({
  ...jest.requireActual('../../src/modules/wallet-ledger/services/wallet-ledger-parser'),
  parseWalletLedger: jest.fn(),
}));

function makeSut(refundsInr: string, statedRefundsInr: string | null) {
  (parser.parseWalletLedger as jest.Mock).mockReturnValue({
    txns: [],
    summary: {
      totalDeductionsInr: '40.00',
      totalRefundsInr: statedRefundsInr,
      totalRechargesInr: null,
      openingBalanceInr: null,
    },
    rowsRead: 0,
    rowsSkipped: 0,
    netInr: '0.00',
    sumInr: '40.00',
    statedTotalInr: '40.00',
    refundsInr,
    statedRefundsInr,
    periodFrom: null,
    periodTo: null,
  });
  const createMany = jest.fn(async () => ({ count: 0 }));
  const client = {
    courierAccount: { findFirst: async () => ({ id: 'acct-1' }) },
    courierWalletTransaction: { findMany: async () => [], createMany, groupBy: async () => [] },
    shipment: { findMany: async () => [], update: jest.fn() },
  };
  const svc = new WalletImportService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a1') } as unknown as AuditLogService,
  );
  return { svc };
}

const FILE = Buffer.from('parser is mocked');

describe('the refunds total is checked, as the deductions total is', () => {
  it('REFUSES a file whose refund rows do not add up to its Summary', async () => {
    const { svc } = makeSut('90.00', '100.00');

    const err = await svc.importDelhiveryWallet(FILE, null, {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'LEDGER_REFUNDS_DISAGREE',
    });
  });

  it('agrees when they match', async () => {
    const { svc } = makeSut('100.00', '100.00');
    const r = await svc.importDelhiveryWallet(FILE, null, {});
    expect(r.totalsAgree).toBe(true);
  });

  it('force lets a known partial file through, and says the totals disagree', async () => {
    const { svc } = makeSut('90.00', '100.00');
    const r = await svc.importDelhiveryWallet(FILE, null, { force: true });
    expect(r.totalsAgree).toBe(false);
  });
});
