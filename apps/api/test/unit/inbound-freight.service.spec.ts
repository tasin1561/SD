import {
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  SettingValueType,
  WalletEntryDirection,
} from '@skydrop/db';
import { InboundFreightService } from '../../src/modules/inbound-freight/services/inbound-freight.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;

const STAFF = 'staff-1';
const SELLER = 'seller-1';
const RECEIPT = 'gr-1';
const CHARGE = 'fc-1';

function chargeRow(over: AnyArgs = {}): AnyArgs {
  return {
    id: CHARGE,
    sellerId: SELLER,
    goodsReceiptId: RECEIPT,
    amountInr: new Prisma.Decimal('4500.00'),
    mode: InboundFreightMode.PAY_LATER,
    serviceChargePercent: null,
    serviceChargeInr: null,
    totalInr: new Prisma.Decimal('4500.00'),
    status: InboundFreightStatus.PENDING,
    settledAt: null,
    settledByStaffId: null,
    walletEntryId: null,
    note: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    goodsReceipt: { receiptNumber: 'GR-2026-07-0001' },
    ...over,
  };
}

function makeSut(
  opts: {
    receipt?: AnyArgs | null;
    existing?: AnyArgs | null;
    mode?: string;
    servicePercent?: string;
    settingsThrows?: boolean;
    loaded?: AnyArgs | null;
    claimCount?: number;
  } = {},
) {
  const receiptFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.receipt === undefined
      ? { id: RECEIPT, sellerId: SELLER, receiptNumber: 'GR-2026-07-0001' }
      : opts.receipt,
  );
  const chargeFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => opts.existing ?? null,
  );
  const created: AnyArgs[] = [];
  const chargeCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    const data = args['data'] as AnyArgs;
    created.push(data);
    return { ...chargeRow(), ...data, goodsReceipt: { receiptNumber: 'GR-2026-07-0001' } };
  });
  const chargeUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.claimCount ?? 1 }),
  );
  const chargeUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => ({
    ...(opts.loaded ?? chargeRow()),
    ...((args['data'] as AnyArgs | undefined) ?? {}),
  }));
  const chargeFindUniqueOrThrow = jest.fn<Promise<AnyArgs>, [AnyArgs]>(
    async () => opts.loaded ?? chargeRow(),
  );

  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    goodsReceipt: { findFirst: receiptFindFirst },
    inboundFreightCharge: {
      findUnique: jest.fn(async () =>
        opts.loaded === undefined ? (opts.existing ?? null) : opts.loaded,
      ),
      findUniqueOrThrow: chargeFindUniqueOrThrow,
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({ _sum: { totalInr: null } })),
      create: chargeCreate,
      update: chargeUpdate,
      updateMany: chargeUpdateMany,
    },
  };
  // `record`'s pre-flight duplicate check goes through findUnique too, so
  // keep the two lookups distinguishable for the tests that need it.
  if (opts.existing !== undefined && opts.loaded === undefined) {
    (client['inboundFreightCharge'] as AnyArgs)['findUnique'] = chargeFindUnique;
  }
  const prisma = { client } as unknown as PrismaService;

  const applyEntry = jest.fn<Promise<{ id: string; runningBalanceAfter: Prisma.Decimal }>, [unknown, AnyArgs]>(
    async () => ({ id: 'we-1', runningBalanceAfter: new Prisma.Decimal('-4500.00') }),
  );
  const wallet = { applyEntry } as unknown as WalletService;

  const resolve = jest.fn(async (_s: string, key: string) => {
    if (opts.settingsThrows) throw new Error('settings down');
    if (key === 'wallet.inbound_freight_mode') {
      return {
        key,
        valueType: SettingValueType.STRING,
        value: opts.mode ?? 'PAY_NOW',
        source: 'SYSTEM_DEFAULT' as const,
      };
    }
    return {
      key,
      valueType: SettingValueType.DECIMAL,
      value: opts.servicePercent ?? '0.00',
      source: 'SYSTEM_DEFAULT' as const,
    };
  });
  const settings = { resolve } as unknown as SettingsResolverService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  return {
    svc: new InboundFreightService(prisma, audit, settings, wallet),
    applyEntry,
    auditLog,
    created,
    chargeUpdateMany,
  };
}

describe('InboundFreightService.record', () => {
  const input = { goodsReceiptId: RECEIPT, amountInr: '4500.00' };

  it('PAY_NOW debits the wallet in the SAME transaction and lands SETTLED', async () => {
    const sut = makeSut({ mode: 'PAY_NOW' });
    const view = await sut.svc.record(STAFF, input);

    expect(view.mode).toBe(InboundFreightMode.PAY_NOW);
    expect(view.status).toBe(InboundFreightStatus.SETTLED);
    expect(view.totalInr).toBe('4500');
    expect(sut.applyEntry).toHaveBeenCalledTimes(1);
    const entry = sut.applyEntry.mock.calls[0]![1];
    expect(entry).toMatchObject({
      sellerId: SELLER,
      currency: 'INR',
      direction: WalletEntryDirection.INBOUND_FREIGHT,
    });
    // The row records WHICH wallet entry charged the seller — the
    // once-only evidence.
    expect(sut.created[0]).toMatchObject({ walletEntryId: 'we-1' });
  });

  it('PAY_LATER records a PENDING receivable and does NOT touch the wallet', async () => {
    const sut = makeSut({ mode: 'PAY_LATER' });
    const view = await sut.svc.record(STAFF, input);
    expect(view.status).toBe(InboundFreightStatus.PENDING);
    expect(sut.applyEntry).not.toHaveBeenCalled();
    // No settlement fields written at all — not "written as null".
    expect(sut.created[0]).not.toHaveProperty('walletEntryId');
    expect(sut.created[0]).not.toHaveProperty('settledAt');
  });

  it('PAY_LATER applies + snapshots the service charge', async () => {
    const sut = makeSut({ mode: 'PAY_LATER', servicePercent: '2.00' });
    const view = await sut.svc.record(STAFF, input);
    expect(view.serviceChargePercent).toBe('2');
    expect(view.serviceChargeInr).toBe('90');
    expect(view.totalInr).toBe('4590');
  });

  it('PAY_NOW never carries a service charge — credit terms are what is being charged for', async () => {
    const sut = makeSut({ mode: 'PAY_NOW', servicePercent: '2.00' });
    const view = await sut.svc.record(STAFF, input);
    expect(view.serviceChargeInr).toBeNull();
    expect(view.totalInr).toBe('4500');
  });

  it('an explicit mode on the request overrides the seller setting', async () => {
    const sut = makeSut({ mode: 'PAY_NOW' });
    const view = await sut.svc.record(STAFF, {
      ...input,
      mode: InboundFreightMode.PAY_LATER,
    });
    expect(view.mode).toBe(InboundFreightMode.PAY_LATER);
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('is idempotent per consignment: a second record is a 409, never a second bill', async () => {
    const sut = makeSut({ existing: chargeRow() });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_ALREADY_RECORDED' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('404s on an unknown goods receipt', async () => {
    const sut = makeSut({ receipt: null });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'GOODS_RECEIPT_NOT_FOUND' },
    });
  });

  it.each(['0', '-5', 'abc'])('rejects the invalid amount %s', async (amt) => {
    const sut = makeSut();
    await expect(
      sut.svc.record(STAFF, { ...input, amountInr: amt }),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_AMOUNT_INVALID' } });
  });

  it('unreadable settings degrade to PAY_NOW with NO service charge, never a surprise fee', async () => {
    const sut = makeSut({ settingsThrows: true });
    const view = await sut.svc.record(STAFF, input);
    expect(view.mode).toBe(InboundFreightMode.PAY_NOW);
    expect(view.serviceChargeInr).toBeNull();
  });

  it('audits the recording at MEDIUM with the money on the row', async () => {
    const sut = makeSut({ mode: 'PAY_NOW' });
    await sut.svc.record(STAFF, input);
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.inbound_freight.recorded',
        severity: 'MEDIUM',
        metadata: expect.objectContaining({ totalInr: '4500', mode: 'PAY_NOW' }),
      }),
      expect.anything(),
    );
  });
});

describe('InboundFreightService.settle', () => {
  it('debits the wallet once and stamps the entry id', async () => {
    const sut = makeSut({ loaded: chargeRow() });
    const view = await sut.svc.settle(STAFF, CHARGE);
    expect(sut.applyEntry).toHaveBeenCalledTimes(1);
    expect(sut.applyEntry.mock.calls[0]![1]).toMatchObject({
      direction: WalletEntryDirection.INBOUND_FREIGHT,
    });
    expect(view.walletEntryId).toBe('we-1');
  });

  it('refuses to settle an already-settled bill', async () => {
    const sut = makeSut({
      loaded: chargeRow({ status: InboundFreightStatus.SETTLED }),
    });
    await expect(sut.svc.settle(STAFF, CHARGE)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_PENDING' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('loses the in-tx race without debiting — two operators cannot double-charge', async () => {
    const sut = makeSut({ loaded: chargeRow(), claimCount: 0 });
    await expect(sut.svc.settle(STAFF, CHARGE)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_PENDING' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });
});

describe('InboundFreightService.waive', () => {
  const REASON = 'Our warehouse mis-routed the consignment';

  it('forgives a PENDING bill with NO wallet movement, audited HIGH', async () => {
    const sut = makeSut({ loaded: chargeRow() });
    await sut.svc.waive(STAFF, CHARGE, REASON);
    expect(sut.applyEntry).not.toHaveBeenCalled();
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.inbound_freight.waived',
        severity: 'HIGH',
      }),
      expect.anything(),
    );
  });

  it('requires a substantive reason', async () => {
    const sut = makeSut({ loaded: chargeRow() });
    await expect(sut.svc.waive(STAFF, CHARGE, 'oops')).rejects.toMatchObject({
      response: { code: 'FREIGHT_WAIVE_REASON_TOO_SHORT' },
    });
  });

  it('cannot waive a settled bill', async () => {
    const sut = makeSut({
      loaded: chargeRow({ status: InboundFreightStatus.SETTLED }),
    });
    await expect(sut.svc.waive(STAFF, CHARGE, REASON)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_PENDING' },
    });
  });
});
