import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  InboundFreightBasis,
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
import type { InboundFreightAmortisationService } from '../../src/modules/inbound-freight/services/inbound-freight-amortisation.service';
import type { BankLedgerService } from '../../src/modules/treasury/services/bank-ledger.service';

type AnyArgs = Record<string, unknown>;

const STAFF = 'staff-1';
const SELLER = 'seller-1';
const RECEIPT = 'gr-1';
const CONSIGNMENT = 'cn-1';
const CHARGE = 'fc-1';

function chargeRow(over: AnyArgs = {}): AnyArgs {
  return {
    id: CHARGE,
    sellerId: SELLER,
    consignmentId: CONSIGNMENT,
    goodsReceiptId: RECEIPT,
    amountInr: new Prisma.Decimal('4500.00'),
    mode: InboundFreightMode.PAY_LATER,
    serviceChargePercent: null,
    serviceChargeInr: null,
    totalInr: new Prisma.Decimal('4500.00'),
    totalUnits: 10,
    unitsSettled: 0,
    amountSettledInr: new Prisma.Decimal('0.00'),
    status: InboundFreightStatus.PENDING,
    settledAt: null,
    settledByStaffId: null,
    walletEntryId: null,
    note: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    consignment: { consignmentNumber: 'CN-2026-07-000001' },
    goodsReceipt: { receiptNumber: 'CN-2026-07-000001-000002' },
    ...over,
  };
}

function makeSut(
  opts: {
    receipt?: AnyArgs | null;
    leg?: string;
    receiptStatus?: string;
    route?: string;
    existing?: AnyArgs | null;
    mode?: string;
    servicePercent?: string;
    settingsThrows?: boolean;
    /** INR by default; 'BDT' drives the cross-currency payment path. */
    bankCurrency?: 'INR' | 'BDT';
    /** An already-recorded expense, for the attribution cases. */
    bankEntry?: AnyArgs | null;
    loaded?: AnyArgs | null;
    claimCount?: number;
    /** Payments already attached to the bill, before the one under test. */
    linkedPayments?: Array<{
      id: string;
      currency: 'INR' | 'BDT';
      signedAmount: Prisma.Decimal;
      occurredAt: Date;
    }>;
    /** The rate history row in force; null = none recorded that early. */
    fxHistory?: AnyArgs | null;
    /** Today's rate row (fx_rates); null = no rate at all. */
    fxCurrent?: AnyArgs | null;
    /** What an idempotency key already created, per lookup (in order). */
    priorByKey?: Array<AnyArgs | null>;
    /** Thrown by the ledger's post(). */
    postThrows?: unknown;
  } = {},
) {
  // The bill hangs off ONE ARRIVAL, and the consignment is derived from
  // it. Only a VIA_BD consignment is billable — a seller who shipped
  // straight to India paid their own freight.
  const receiptFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.receipt === undefined
      ? {
          id: RECEIPT,
          receiptNumber: 'CN-2026-07-000001-000002',
          leg: opts.leg ?? 'IN_FINAL',
          status: opts.receiptStatus ?? 'COMPLETED',
          consignment: {
            id: CONSIGNMENT,
            sellerId: SELLER,
            consignmentNumber: 'CN-2026-07-000001',
            route: opts.route ?? 'VIA_BD',
            deletedAt: null,
          },
        }
      : opts.receipt,
  );
  const chargeFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => opts.existing ?? null,
  );
  const created: AnyArgs[] = [];
  const chargeCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => {
    const data = args['data'] as AnyArgs;
    created.push(data);
    return {
      ...chargeRow(),
      ...data,
      consignment: { consignmentNumber: 'CN-2026-07-000001' },
      goodsReceipt: { receiptNumber: 'CN-2026-07-000001-000002' },
    };
  });
  const chargeUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.claimCount ?? 1,
  }));
  const chargeUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => ({
    ...(opts.loaded ?? chargeRow()),
    ...((args['data'] as AnyArgs | undefined) ?? {}),
  }));
  const chargeFindUniqueOrThrow = jest.fn<Promise<AnyArgs>, [AnyArgs]>(
    async () => opts.loaded ?? chargeRow(),
  );

  // Every payment attached to the bill — what our cost is recomputed
  // from. The ledger's post() below appends to it, as the real insert
  // would inside the same transaction.
  const linked = [...(opts.linkedPayments ?? [])];
  const priorByKey = [...(opts.priorByKey ?? [])];
  const allocCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'alloc-1' }));
  const allocUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const lockTaken = jest.fn(async () => 1);

  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    // WAL-7's advisory lock — settle takes the one amortisation charges under.
    $executeRaw: lockTaken,
    goodsReceipt: { findFirst: receiptFindFirst },
    inboundFreightAllocation: {
      create: allocCreate,
      findMany: jest.fn(async () => [
        { id: 'alloc-1', units: 10, lineGrossInr: new Prisma.Decimal('4500.00') },
      ]),
      update: allocUpdate,
    },
    // Resolved by CODE inside recordForwarderPayment — the caller never
    // picks the category, so one cost cannot be filed two ways.
    expenseCategory: { findUnique: jest.fn(async () => ({ id: 'cat-freight' })) },
    bankEntry: {
      // By idempotency key: what that key already created. By id: the
      // expense being attributed to a bill, when a case supplies one.
      findUnique: jest.fn(async (args: AnyArgs) =>
        ((args['where'] as AnyArgs)['idempotencyKey'] as string | undefined) !== undefined
          ? (priorByKey.shift() ?? null)
          : (opts.bankEntry ?? null),
      ),
      findMany: jest.fn(async () => linked),
    },
    // The rate in force at a payment's instant: history first, then today's.
    fxRateHistory: {
      findFirst: jest.fn(async () =>
        opts.fxHistory === undefined
          ? {
              fromCurrency: 'INR',
              toCurrency: 'BDT',
              rate: new Prisma.Decimal('1.23'),
              recordedAt: new Date('2026-08-24T00:00:00Z'),
            }
          : opts.fxHistory,
      ),
    },
    fxRate: {
      findFirst: jest.fn(async () =>
        opts.fxCurrent === undefined
          ? { fromCurrency: 'BDT', toCurrency: 'INR', rate: new Prisma.Decimal('0.813008') }
          : opts.fxCurrent,
      ),
    },
    // The account decides the entry's currency (TRE-2) and therefore
    // whether a separate INR figure has to be supplied.
    platformBankAccount: {
      findFirst: jest.fn(async () => ({
        id: 'ba-1',
        currency: opts.bankCurrency ?? 'INR',
        label: 'HDFC — COD receiving',
      })),
    },
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

  const applyEntry = jest.fn<
    Promise<{ id: string; runningBalanceAfter: Prisma.Decimal }>,
    [unknown, AnyArgs]
  >(async () => ({ id: 'we-1', runningBalanceAfter: new Prisma.Decimal('-4500.00') }));
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

  // R3 amortisation: a single 10-unit line at 45/unit, so `record` writes
  // one allocation row and totalUnits 10.
  const planFromPricedLines = jest.fn(async () => ({
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        variantId: 'v-1',
        units: 10,
        unitWeightGrams: 500,
        basis: InboundFreightBasis.PER_KG,
        rateInr: new Prisma.Decimal('900'),
        chargeableWeightKg: new Prisma.Decimal('5'),
        lineTotalInr: new Prisma.Decimal('4500.00'),
        perUnitInr: new Prisma.Decimal('450.0000'),
      },
    ],
    totalUnits: 10,
    // The bill total is the SUM of the lines, computed here rather than
    // typed by the operator.
    totalInr: new Prisma.Decimal('4500.00'),
  }));
  const amortisation = {
    planFromPricedLines,
  } as unknown as InboundFreightAmortisationService;

  const auditLog = jest.fn<Promise<string | null>, [AnyArgs, unknown?]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  /**
   * The bank side of a forwarder payment (TRE-1: `post()` is the only
   * writer of bank_entries). Recorded rather than stubbed away — the
   * whole point of `recordForwarderPayment` is that the cash entry and
   * the attribution are written together, so the cases below assert on
   * what it was handed.
   */
  const post = jest.fn(async (input: Record<string, unknown>, _tx?: unknown) => {
    if (opts.postThrows !== undefined) throw opts.postThrows;
    const id = `be-${linked.length + 1}`;
    if (input['inboundFreightChargeId'] !== undefined) {
      linked.push({
        id,
        currency: input['amountCurrency'] as 'INR' | 'BDT',
        signedAmount: new Prisma.Decimal(input['signedAmount'] as Prisma.Decimal),
        occurredAt: input['occurredAt'] as Date,
      });
    }
    return { id };
  });
  // TRE-1: bank_entries has ONE writer, and attaching an expense to a
  // freight bill is still a write to it — "it is only an attribution"
  // is the argument the second writer always makes.
  const attributeToFreightCharge = jest.fn(async () => ({ claimed: true }));
  const bank = { post, attributeToFreightCharge } as unknown as BankLedgerService;

  return {
    svc: new InboundFreightService(prisma, audit, settings, wallet, amortisation, bank),
    planFromPricedLines,
    applyEntry,
    auditLog,
    created,
    chargeUpdateMany,
    chargeUpdate,
    post,
    attributeToFreightCharge,
    allocCreate,
    allocUpdate,
    lockTaken,
  };
}

describe('InboundFreightService.record', () => {
  const input = {
    goodsReceiptId: RECEIPT,
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        basis: InboundFreightBasis.PER_KG,
        rateInr: '900',
        chargeableWeightKg: '5',
      },
    ],
  };

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

  it('is idempotent per ARRIVAL: a second record is a 409, never a second bill', async () => {
    const sut = makeSut({ existing: chargeRow() });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_ALREADY_RECORDED' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('404s on an unknown arrival', async () => {
    const sut = makeSut({ receipt: null });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'ARRIVAL_NOT_FOUND' },
    });
  });

  it('SPLITS OVER THIS ARRIVAL ONLY — the reason the key moved', async () => {
    // 300 units can leave Dhaka as 100 now and 200 in September. Under
    // the old per-consignment key the first bill's split ran over the
    // units that had landed so far, the September units got no
    // allocation row, and the charge path skips a unit with no
    // allocation — so they shipped freight-free forever, and the second
    // forwarder invoice could not be entered at all.
    const sut = makeSut();
    await sut.svc.record(STAFF, input);
    expect(sut.planFromPricedLines).toHaveBeenCalledWith(RECEIPT, expect.anything());
  });

  it('refuses to bill the Bangladesh intake', async () => {
    // The BD leg is goods being handed to us, not a shipment that flew.
    // Amortising over it would charge freight to units that never left,
    // leaving a remainder nothing settles and a bill stuck at
    // PARTIALLY_SETTLED forever.
    const sut = makeSut({ leg: 'BD_INTAKE' });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_AN_ARRIVAL' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses an arrival that has not been counted', async () => {
    const sut = makeSut({ receiptStatus: 'IN_PROGRESS' });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_ARRIVAL_NOT_COUNTED' },
    });
  });

  it('refuses a consignment that never went through Bangladesh', async () => {
    const sut = makeSut({ route: 'DIRECT_IN' });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_BILLABLE' },
    });
  });

  it.each(['-5', 'abc'])('rejects the invalid rate %s', async (rate) => {
    // Zero is deliberately NOT here: a single waived line is real, and
    // the whole-bill-is-zero case is refused downstream on the total.
    const sut = makeSut();
    await expect(
      sut.svc.record(STAFF, {
        ...input,
        lines: [{ ...input.lines[0]!, rateInr: rate }],
      }),
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

  it('charges the remainder READ UNDER THE WALLET LOCK, and claims on that exact figure', async () => {
    // A delivery charged between an outside read and the claim was billed
    // twice: once by itself and once inside the remainder.
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.PARTIALLY_SETTLED,
        unitsSettled: 2,
        amountSettledInr: new Prisma.Decimal('900.00'),
      }),
    });
    await sut.svc.settle(STAFF, CHARGE);
    expect(sut.lockTaken).toHaveBeenCalled();
    expect((sut.applyEntry.mock.calls[0]![1]['amount'] as Prisma.Decimal).toFixed(2)).toBe(
      '3600.00',
    );
    expect(sut.chargeUpdateMany.mock.calls[0]![0]['where']).toMatchObject({
      amountSettledInr: new Prisma.Decimal('900.00'),
    });
  });

  it('marks every line FULLY CHARGED in the same transaction', async () => {
    // Left at their old counters the lines kept charging every later
    // delivery on top of the remainder: ₹10,000 billed ₹18,000.
    const sut = makeSut({ loaded: chargeRow() });
    await sut.svc.settle(STAFF, CHARGE);
    expect(sut.allocUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: 'alloc-1' },
      data: { unitsSettled: 10, amountSettledInr: new Prisma.Decimal('4500.00') },
    });
  });

  it('refuses when nothing is outstanding by the time the lock is held', async () => {
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.PARTIALLY_SETTLED,
        amountSettledInr: new Prisma.Decimal('4500.00'),
      }),
    });
    await expect(sut.svc.settle(STAFF, CHARGE)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOTHING_OUTSTANDING' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });
});

describe('the pay-later service charge is actually collected', () => {
  it('writes each line’s GROSS total — the service charge included — summing to the bill', async () => {
    const sut = makeSut({ mode: 'PAY_LATER', servicePercent: '2.00' });
    await sut.svc.record(STAFF, {
      goodsReceiptId: RECEIPT,
      lines: [
        {
          goodsReceiptLineId: 'grl-1',
          basis: InboundFreightBasis.PER_KG,
          rateInr: '900',
          chargeableWeightKg: '5',
        },
      ],
    });
    const data = sut.allocCreate.mock.calls[0]![0]['data'] as AnyArgs;
    expect((data['lineTotalInr'] as Prisma.Decimal).toFixed(2)).toBe('4500.00');
    expect((data['lineGrossInr'] as Prisma.Decimal).toFixed(2)).toBe('4590.00');
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

describe('InboundFreightService.recordForwarderPayment', () => {
  const payment = {
    bankAccountId: 'ba-1',
    amountPaid: '2000.00',
    occurredAt: new Date('2026-09-01T00:00:00Z'),
  };
  const ourCostWritten = (u: jest.Mock): string | undefined =>
    (
      (u.mock.calls.at(-1)?.[0] as AnyArgs | undefined)?.['data'] as
        | { ourCostInr?: Prisma.Decimal }
        | undefined
    )?.ourCostInr?.toFixed(2);

  it('posts the cash NEGATIVE, as capital, LINKED to the bill', async () => {
    // The link is the whole point: without it the same rupees are
    // subtracted twice in the P&L — once as this leg's cost, once again
    // in operating expenses — and both figures look plausible alone.
    const { svc, post } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);

    const call = post.mock.calls[0]?.[0] as unknown as {
      signedAmount: Prisma.Decimal;
      owner: { kind: string };
      type: string;
      inboundFreightChargeId: string;
      expenseCategoryId: string;
      occurredAt: Date;
    };
    expect(call.signedAmount.toFixed(2)).toBe('-2000.00');
    expect(call.type).toBe('EXPENSE');
    // Ours. The seller is billed for freight through the wallet, and
    // attributing this to them would move held cash they never paid.
    expect(call.owner.kind).toBe('CAPITAL');
    expect(call.inboundFreightChargeId).toBe('fc-1');
    expect(call.expenseCategoryId).toBe('cat-freight');
    // The date the bank moved it, not today.
    expect(call.occurredAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('our cost is the payment when it is the first', async () => {
    const { svc, chargeUpdate } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    expect(ourCostWritten(chargeUpdate)).toBe('2000.00');
  });

  it('a SECOND payment adds to our cost — ₹30,000 then ₹20,000 is ₹50,000', async () => {
    // It used to be filled in only when unset, so the second instalment
    // reached no line of the P&L at all: a linked payment is excluded
    // from operating expenses, and the leg's cost still read ₹30,000.
    const { svc, chargeUpdate } = makeSut({
      loaded: chargeRow({ ourCostInr: new Prisma.Decimal('30000.00') }),
      linkedPayments: [
        {
          id: 'be-0',
          currency: 'INR',
          signedAmount: new Prisma.Decimal('-30000.00'),
          occurredAt: new Date('2026-08-20T00:00:00Z'),
        },
      ],
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', { ...payment, amountPaid: '20000.00' });
    expect(ourCostWritten(chargeUpdate)).toBe('50000.00');
  });

  it('refuses a zero or negative payment', async () => {
    const { svc, post } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await expect(
      svc.recordForwarderPayment('st-1', 'fc-1', { ...payment, amountPaid: '0' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(post).not.toHaveBeenCalled();
  });

  it('audits HIGH — real money leaving a real account', async () => {
    const { svc, auditLog } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    const entry = auditLog.mock.calls.at(-1)?.[0] as unknown as {
      action: string;
      severity: string;
      metadata: { amountPaid: string };
    };
    expect(entry.action).toBe('staff.inbound_freight.forwarder_paid');
    expect(entry.severity).toBe('HIGH');
    expect(entry.metadata.amountPaid).toBe('2000.00');
  });

  // What the key's first request posted — the entry a replay is compared to.
  const priorPayment = (over: AnyArgs = {}): AnyArgs => ({
    inboundFreightChargeId: 'fc-1',
    type: 'EXPENSE',
    accountId: 'ba-1',
    signedAmount: new Prisma.Decimal('-2000.00'),
    occurredAt: new Date('2026-09-01T00:00:00Z'),
    reference: null,
    ...over,
  });

  it('a replay with the same key records NOTHING and returns the bill', async () => {
    const { svc, post, chargeUpdate } = makeSut({
      loaded: chargeRow({ ourCostInr: new Prisma.Decimal('2000.00') }),
      priorByKey: [priorPayment()],
    });
    const view = await svc.recordForwarderPayment('st-1', 'fc-1', {
      ...payment,
      idempotencyKey: '4f1c2c1e-4e7a-4b59-9d0e-3a2f5b1c8d11',
    });
    expect(post).not.toHaveBeenCalled();
    expect(chargeUpdate).not.toHaveBeenCalled();
    expect(view.ourCostInr).toBe('2000');
  });

  it('two copies racing: the loser hits the unique key and answers with the winner', async () => {
    const { svc } = makeSut({
      loaded: chargeRow({ ourCostInr: new Prisma.Decimal('2000.00') }),
      // First lookup: nothing yet. After the insert fails: the winner's row.
      priorByKey: [null, priorPayment()],
      postThrows: new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });
    const view = await svc.recordForwarderPayment('st-1', 'fc-1', {
      ...payment,
      idempotencyKey: '4f1c2c1e-4e7a-4b59-9d0e-3a2f5b1c8d11',
    });
    expect(view.id).toBe(CHARGE);
  });

  it('refuses a key that created something else rather than pretending', async () => {
    const { svc, post } = makeSut({
      loaded: chargeRow(),
      priorByKey: [priorPayment({ inboundFreightChargeId: 'fc-other' })],
    });
    await expect(
      svc.recordForwarderPayment('st-1', 'fc-1', {
        ...payment,
        idempotencyKey: '4f1c2c1e-4e7a-4b59-9d0e-3a2f5b1c8d11',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { signedAmount: new Prisma.Decimal('-2500.00') }],
    ['account', { accountId: 'ba-2' }],
    ['date', { occurredAt: new Date('2026-09-02T00:00:00Z') }],
    ['reference', { reference: 'INV-77' }],
  ])(
    'the same key on a payment with a different %s is 409, never answered',
    async (_what, over) => {
      const { svc, post } = makeSut({ loaded: chargeRow(), priorByKey: [priorPayment(over)] });
      await expect(
        svc.recordForwarderPayment('st-1', 'fc-1', {
          ...payment,
          idempotencyKey: '4f1c2c1e-4e7a-4b59-9d0e-3a2f5b1c8d11',
        }),
      ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('takes the bill’s cost lock BEFORE posting — the re-sum is serialised', async () => {
    const { svc, post, lockTaken } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    expect(lockTaken).toHaveBeenCalled();
    expect(lockTaken.mock.invocationCallOrder[0]).toBeLessThan(
      post.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('stamps each payment’s rupee figure with the total it sums to', async () => {
    const { svc, chargeUpdate } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    const data = chargeUpdate.mock.calls.at(-1)?.[0]['data'] as {
      ourCostPayments: Array<{ costInr: string }>;
    };
    expect(data.ourCostPayments.map((p) => p.costInr)).toEqual(['2000.00']);
  });
});

describe('InboundFreightService.costBreakdown reads the STAMPED per-payment figure', () => {
  const bdtEntry = (id: string): AnyArgs => ({
    id,
    signedAmount: new Prisma.Decimal('-2000.00'),
    currency: 'BDT',
    occurredAt: new Date('2026-09-01T00:00:00Z'),
    reference: null,
    account: { label: 'Tasin City' },
    createdBy: null,
  });

  it('a rate back-filled later moves neither the rows nor the total', async () => {
    // Stamped at INR→BDT 1.23 = ₹1,626.02. A 1.30 rate added to the
    // history since would re-price the row at ₹1,538.46 — and then the
    // rows no longer add up to the stamped total printed above them.
    const { svc } = makeSut({
      loaded: {
        ourCostInr: new Prisma.Decimal('1626.02'),
        ourCostPayments: [
          {
            bankEntryId: 'be-1',
            currency: 'BDT',
            amount: '2000.00',
            occurredAt: '2026-09-01T00:00:00.000Z',
            costInr: '1626.02',
            inrPerUnit: '0.8130081',
            rateSource: 'HISTORY',
            rateRecordedAt: '2026-08-24T00:00:00.000Z',
            rateAsStored: 'INR→BDT 1.23',
          },
        ],
        allocations: [],
        bankEntries: [bdtEntry('be-1')],
      },
      fxHistory: {
        fromCurrency: 'INR',
        toCurrency: 'BDT',
        rate: new Prisma.Decimal('1.30'),
        recordedAt: new Date('2026-08-30T00:00:00Z'),
      },
    });
    const out = await svc.costBreakdown('fc-1');
    expect(out.ourCostInr).toBe('1626.02');
    expect(out.payments[0]).toMatchObject({ costInr: '1626.02', rateAsStored: 'INR→BDT 1.23' });
  });

  it('a payment the stamp predates is still priced, at its own instant’s rate', async () => {
    const { svc } = makeSut({
      loaded: {
        ourCostInr: new Prisma.Decimal('1626.02'),
        ourCostPayments: null,
        allocations: [],
        bankEntries: [bdtEntry('be-1')],
      },
    });
    const out = await svc.costBreakdown('fc-1');
    expect(out.payments[0]).toMatchObject({ costInr: '1626.02' });
  });
});

describe('paying the forwarder from a BDT account', () => {
  const bdtPayment = {
    bankAccountId: 'ba-1',
    amountPaid: '2000.00',
    occurredAt: new Date('2026-09-01T00:00:00Z'),
  };
  const ourCostWritten = (u: jest.Mock): string | undefined =>
    (
      (u.mock.calls.at(-1)?.[0] as AnyArgs | undefined)?.['data'] as
        | { ourCostInr?: Prisma.Decimal }
        | undefined
    )?.ourCostInr?.toFixed(2);

  it('stamps the entry in the ACCOUNT’s currency, not INR', async () => {
    // TRE-2: the entry takes the account's currency whatever arrives,
    // so an INR figure sent to a BDT account would not fail — it would
    // be relabelled, wrong by the exchange rate, with nothing in the
    // row to show it happened.
    const { svc, post } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment);
    const call = post.mock.calls[0]?.[0] as unknown as {
      amountCurrency: string;
      signedAmount: Prisma.Decimal;
    };
    expect(call.amountCurrency).toBe('BDT');
    expect(call.signedAmount.toFixed(2)).toBe('-2000.00');
  });

  it('prices it at the rate IN FORCE at the payment’s instant — ৳2,000 at 1.23 is ₹1,626.02', async () => {
    // The one production payment was typed at 1.20 and read ₹1,666.67
    // while every recorded rate said 1.23.
    const { svc, chargeUpdate, auditLog } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment);
    expect(ourCostWritten(chargeUpdate)).toBe('1626.02');
    // Which rate, and from where, is on the record.
    const meta = (auditLog.mock.calls.at(-1)?.[0] as AnyArgs)['metadata'] as AnyArgs;
    expect(meta['rate']).toMatchObject({ asStored: 'INR→BDT 1.23', source: 'HISTORY' });
  });

  it('falls back to today’s rate when none was recorded that early', async () => {
    const { svc, chargeUpdate } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
      fxHistory: null,
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment);
    // 2000 × 0.813008 = 1626.016
    expect(ourCostWritten(chargeUpdate)).toBe('1626.02');
  });

  it('sums each payment at ITS OWN rate', async () => {
    // An earlier ৳1,000 at 1.20 (₹833.33) plus today's ৳2,000 at 1.23.
    const { svc, chargeUpdate } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
      linkedPayments: [
        {
          id: 'be-0',
          currency: 'BDT',
          signedAmount: new Prisma.Decimal('-1000.00'),
          occurredAt: new Date('2026-07-01T00:00:00Z'),
        },
      ],
    });
    let calls = 0;
    const hist = (
      svc as unknown as {
        prisma: { client: { fxRateHistory: { findFirst: jest.Mock } } };
      }
    ).prisma.client.fxRateHistory.findFirst;
    hist.mockImplementation(async (args: AnyArgs) => {
      calls += 1;
      const at = ((args['where'] as AnyArgs)['recordedAt'] as { lte: Date }).lte;
      return {
        fromCurrency: 'INR',
        toCurrency: 'BDT',
        rate: new Prisma.Decimal(at < new Date('2026-08-01T00:00:00Z') ? '1.20' : '1.23'),
        recordedAt: at,
      };
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment);
    expect(calls).toBeGreaterThan(0);
    expect(ourCostWritten(chargeUpdate)).toBe('2459.35');
  });

  it('refuses when no rate exists at all — it will not guess', async () => {
    const { svc, post } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
      fxHistory: null,
      fxCurrent: null,
    });
    await expect(svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment)).rejects.toMatchObject({
      response: { code: 'FREIGHT_FX_RATE_MISSING' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('an INR account needs no rate', async () => {
    const { svc, chargeUpdate } = makeSut({
      loaded: chargeRow({ ourCostInr: null }),
      fxHistory: null,
      fxCurrent: null,
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', { ...bdtPayment, amountPaid: '2500.00' });
    expect(ourCostWritten(chargeUpdate)).toBe('2500.00');
  });
});

describe('InboundFreightService.attributeExistingPayment', () => {
  const entry = (over: AnyArgs = {}): AnyArgs => ({
    id: 'be-9',
    type: 'EXPENSE',
    currency: 'INR',
    signedAmount: new Prisma.Decimal('-3000.00'),
    inboundFreightChargeId: null,
    ...over,
  });

  it('links through the LEDGER, never by writing bank_entries itself', async () => {
    // TRE-1. Ownership of the table is what keeps every other rule
    // about it enforceable, and this write changes no money at all —
    // which is exactly the argument that would have bypassed it.
    const ctx = makeSut({ loaded: chargeRow({ ourCostInr: null }), bankEntry: entry() });
    await ctx.svc.attributeExistingPayment('st-1', 'fc-1', { bankEntryId: 'be-9' });
    expect(ctx.attributeToFreightCharge).toHaveBeenCalled();
  });

  it('recomputes our cost from every payment on the bill, this one included', async () => {
    // The fake's linked list stands in for the rows the ledger just linked.
    const ctx = makeSut({
      loaded: chargeRow({ ourCostInr: new Prisma.Decimal('1000.00') }),
      bankEntry: entry(),
      linkedPayments: [
        {
          id: 'be-0',
          currency: 'INR',
          signedAmount: new Prisma.Decimal('-1000.00'),
          occurredAt: new Date('2026-08-01T00:00:00Z'),
        },
        {
          id: 'be-9',
          currency: 'INR',
          signedAmount: new Prisma.Decimal('-3000.00'),
          occurredAt: new Date('2026-08-02T00:00:00Z'),
        },
      ],
    });
    await ctx.svc.attributeExistingPayment('st-1', 'fc-1', { bankEntryId: 'be-9' });
    const data = ctx.chargeUpdate.mock.calls[0]?.[0]?.['data'] as { ourCostInr?: Prisma.Decimal };
    expect(data.ourCostInr?.toFixed(2)).toBe('4000.00');
  });

  it('prices a non-INR expense at the rate in force when it moved', async () => {
    const ctx = makeSut({
      loaded: chargeRow({ ourCostInr: null }),
      bankEntry: entry({ currency: 'BDT', signedAmount: new Prisma.Decimal('-2000.00') }),
      linkedPayments: [
        {
          id: 'be-9',
          currency: 'BDT',
          signedAmount: new Prisma.Decimal('-2000.00'),
          occurredAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
    });
    await ctx.svc.attributeExistingPayment('st-1', 'fc-1', { bankEntryId: 'be-9' });
    const data = ctx.chargeUpdate.mock.calls[0]?.[0]?.['data'] as { ourCostInr?: Prisma.Decimal };
    expect(data.ourCostInr?.toFixed(2)).toBe('1626.02');
  });

  it('refuses an entry that is not an expense', async () => {
    // A settlement or a top-up is not a payment to a forwarder, and
    // attributing one takes real cash out of the line it belongs to.
    const ctx = makeSut({
      loaded: chargeRow({ ourCostInr: null }),
      bankEntry: entry({ type: 'COURIER_SETTLEMENT' }),
    });
    await expect(
      ctx.svc.attributeExistingPayment('st-1', 'fc-1', { bankEntryId: 'be-9' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses one that is already attached rather than re-pointing it', async () => {
    // Re-pointing changes two legs' margins at once and the person
    // doing it can see only one of them.
    const ctx = makeSut({
      loaded: chargeRow({ ourCostInr: null }),
      bankEntry: entry({ inboundFreightChargeId: 'fc-other' }),
    });
    await expect(
      ctx.svc.attributeExistingPayment('st-1', 'fc-1', { bankEntryId: 'be-9' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
