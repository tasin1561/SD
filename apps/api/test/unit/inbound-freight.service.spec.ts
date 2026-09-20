import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Currency,
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
import type { ConsignmentFreightModeService } from '../../src/modules/consignment-core/services/consignment-freight-mode.service';
import type { ConsignmentEventService } from '../../src/modules/consignment-core/services/consignment-event.service';

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
    agreedAmount: new Prisma.Decimal('4500.00'),
    agreedCurrency: 'INR',
    fxRate: null,
    fxRatePair: null,
    fxRateSource: null,
    fxRateRecordedAt: null,
    voidedAt: null,
    voidedByStaffId: null,
    voidReason: null,
    voidReversalEntryId: null,
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
    /** What the consignment's own mode resolves to (the three-level chain). */
    consignmentMode?: string;
    /** Bills already live on the consignment, for the double-billing guard. */
    consignmentBills?: AnyArgs[];
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
  // A guarded `updateMany` that actually APPLIES what it claims, so a
  // later read of the row sees it. The fake returned the fixture
  // unchanged, which made every "and then the row says VOIDED / SETTLED"
  // assertion impossible to write honestly — the test would have had to
  // assert the service's intent rather than its effect.
  const applied: AnyArgs = {};
  const chargeUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async (args) => {
    const count = opts.claimCount ?? 1;
    if (count > 0) Object.assign(applied, (args['data'] as AnyArgs | undefined) ?? {});
    return { count };
  });
  const chargeUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (args) => ({
    ...(opts.loaded ?? chargeRow()),
    ...((args['data'] as AnyArgs | undefined) ?? {}),
  }));
  const chargeFindUniqueOrThrow = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({
    ...(opts.loaded ?? chargeRow()),
    ...applied,
  }));

  // Every payment attached to the bill — what our cost is recomputed
  // from. The ledger's post() below appends to it, as the real insert
  // would inside the same transaction.
  const linked = [...(opts.linkedPayments ?? [])];
  const priorByKey = [...(opts.priorByKey ?? [])];
  const allocCreate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({ id: 'alloc-1' }));
  const allocUpdate = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
  const allocUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: 1,
  }));
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
      updateMany: allocUpdateMany,
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
      // The consignment's LIVE bills — what the double-billing guard
      // reads under its advisory lock.
      findMany: jest.fn(async () => opts.consignmentBills ?? []),
      aggregate: jest.fn(async () => ({ _sum: { totalInr: null } })),
      create: chargeCreate,
      update: chargeUpdate,
      updateMany: chargeUpdateMany,
    },
    consignment: { update: jest.fn(async () => ({})) },
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
        rate: new Prisma.Decimal('900'),
        chargeableWeightKg: new Prisma.Decimal('5'),
        lineTotalAgreed: new Prisma.Decimal('4500.00'),
      },
    ],
    totalUnits: 10,
    // The bill total is the SUM of the lines, computed here rather than
    // typed by the operator.
    totalAgreed: new Prisma.Decimal('4500.00'),
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

  /**
   * The ONE reader of how a consignment's freight is paid for. Stubbed
   * with the real `legFor` / `settlesImmediately` rules rather than
   * jest.fn()s returning fixtures, because those two are exactly what
   * decides which receipt may be billed and whether the wallet is
   * debited at once — a stub that lied about them would make every case
   * below agree with itself and nothing else.
   */
  const snapshotAtBilling = jest.fn(async () => undefined);
  const freightMode = {
    resolveForConsignment: jest.fn(async () => ({
      mode: opts.consignmentMode ?? opts.mode ?? 'PAY_NOW',
      source: opts.consignmentMode === undefined ? 'SYSTEM_DEFAULT' : 'CONSIGNMENT',
      locked: false,
    })),
    legFor: (m: string) => (m === 'PAY_ADVANCE' ? 'BD_INTAKE' : 'IN_FINAL'),
    settlesImmediately: (m: string) => m === 'PAY_NOW' || m === 'PAY_ADVANCE',
    snapshotAtBilling,
  } as unknown as ConsignmentFreightModeService;

  // The seller's consignment timeline. A freight bill appeared on it
  // nowhere until now, so the append is asserted rather than ignored.
  const appendEvent = jest.fn(async () => undefined);
  const events = { append: appendEvent } as unknown as ConsignmentEventService;

  return {
    svc: new InboundFreightService(
      prisma,
      audit,
      settings,
      wallet,
      amortisation,
      bank,
      freightMode,
      events,
    ),
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
    snapshotAtBilling,
    appendEvent,
    allocUpdateMany,
  };
}

describe('InboundFreightService.record', () => {
  const input = {
    goodsReceiptId: RECEIPT,
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        basis: InboundFreightBasis.PER_KG,
        rate: '900',
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
        lines: [{ ...input.lines[0]!, rate }],
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
          rate: '900',
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

/**
 * PAY_ADVANCE — billed at the Bangladesh intake, before the goods fly.
 *
 * It is not a new billing MECHANISM: the invoice is priced line by line
 * at a rate ops types after the count, exactly as the other two modes
 * are. What differs is WHICH goods receipt the bill hangs on, and
 * therefore when it is raised — so these cases are about the receipt,
 * the guard that stops a consignment being billed twice across the two
 * legs, and the money being taken in full up front.
 */
describe('InboundFreightService.record — PAY_ADVANCE', () => {
  const input = {
    goodsReceiptId: RECEIPT,
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        basis: InboundFreightBasis.PER_KG,
        rate: '900',
        chargeableWeightKg: '5',
      },
    ],
  };

  it('bills the BANGLADESH INTAKE and debits the wallet in full, there and then', async () => {
    const sut = makeSut({ consignmentMode: 'PAY_ADVANCE', leg: 'BD_INTAKE' });
    const view = await sut.svc.record(STAFF, input);

    expect(view.mode).toBe(InboundFreightMode.PAY_ADVANCE);
    // Settled like PAY_NOW: the whole bill at once, never amortised.
    expect(view.status).toBe(InboundFreightStatus.SETTLED);
    expect(view.totalInr).toBe('4500');
    expect(sut.applyEntry).toHaveBeenCalledTimes(1);
    expect(sut.applyEntry.mock.calls[0]![1]).toMatchObject({
      direction: WalletEntryDirection.INBOUND_FREIGHT,
      amount: expect.objectContaining({}),
    });
    // And a PAY_ADVANCE bill never carries a pay-later service charge:
    // there is no credit being extended.
    expect(view.serviceChargeInr).toBeNull();
  });

  it('REFUSES the India arrival — that is not where an advance bill is priced', async () => {
    const sut = makeSut({ consignmentMode: 'PAY_ADVANCE', leg: 'IN_FINAL' });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_THE_BD_INTAKE' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('a PAY_NOW consignment still refuses the Bangladesh intake', async () => {
    // The mirror of the case above, and the behaviour that existed
    // before PAY_ADVANCE did: a bill for goods that have not flown is
    // amortised over units that never will.
    const sut = makeSut({ consignmentMode: 'PAY_NOW', leg: 'BD_INTAKE' });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_NOT_AN_ARRIVAL' },
    });
  });

  it('demands the Dhaka COUNT — an advance bill is priced from it', async () => {
    const sut = makeSut({
      consignmentMode: 'PAY_ADVANCE',
      leg: 'BD_INTAKE',
      receiptStatus: 'ARRIVING',
    });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_ARRIVAL_NOT_COUNTED' },
    });
  });

  it('SNAPSHOTS the mode onto the consignment, so no later setting restates it', async () => {
    const sut = makeSut({ consignmentMode: 'PAY_ADVANCE', leg: 'BD_INTAKE' });
    await sut.svc.record(STAFF, input);
    // Written inside the billing transaction: from here the consignment
    // says what it was billed on (ORD-6 / RS-5), and `setOverride`
    // refuses to move it.
    expect(sut.snapshotAtBilling).toHaveBeenCalledWith(
      expect.anything(),
      CONSIGNMENT,
      InboundFreightMode.PAY_ADVANCE,
    );
  });

  it('a mode on the REQUEST pins the consignment rather than forming a fourth level', async () => {
    // The consignment resolves PAY_NOW; the operator raises the bill as
    // PAY_ADVANCE. What is snapshotted must be what was USED, or the
    // consignment and its own bill would disagree the moment anybody
    // looked at them.
    const sut = makeSut({ consignmentMode: 'PAY_NOW', leg: 'BD_INTAKE' });
    const view = await sut.svc.record(STAFF, {
      ...input,
      mode: InboundFreightMode.PAY_ADVANCE,
    });
    expect(view.mode).toBe(InboundFreightMode.PAY_ADVANCE);
    expect(sut.snapshotAtBilling).toHaveBeenCalledWith(
      expect.anything(),
      CONSIGNMENT,
      InboundFreightMode.PAY_ADVANCE,
    );
  });

  it("writes FREIGHT_RECORDED to the seller's timeline", async () => {
    // Until now a freight bill appeared on the timeline nowhere, and the
    // first sign of one was an unexplained wallet debit.
    const sut = makeSut({ consignmentMode: 'PAY_ADVANCE', leg: 'BD_INTAKE' });
    await sut.svc.record(STAFF, input);
    expect(sut.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        consignmentId: CONSIGNMENT,
        type: 'FREIGHT_RECORDED',
        data: expect.objectContaining({ mode: 'PAY_ADVANCE', settledImmediately: true }),
      }),
      expect.anything(),
    );
  });
});

/**
 * THE DOUBLE-BILLING GUARD.
 *
 * `goods_receipt_id @unique` cannot see this: a PAY_ADVANCE bill hangs
 * on the Dhaka intake and a PAY_NOW / PAY_LATER one on the India
 * arrival, which are DIFFERENT rows — so without a consignment-level
 * rule both would be accepted and the seller charged twice for one
 * consignment.
 */
describe('InboundFreightService.record — the consignment is billed ONCE', () => {
  const input = {
    goodsReceiptId: RECEIPT,
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        basis: InboundFreightBasis.PER_KG,
        rate: '900',
        chargeableWeightKg: '5',
      },
    ],
  };

  it('refuses a SECOND bill on a consignment already billed in advance', async () => {
    // The arrival lands, somebody reaches for the freight screen, and
    // the goods have already been paid for at Dhaka.
    const sut = makeSut({
      consignmentMode: 'PAY_NOW',
      leg: 'IN_FINAL',
      consignmentBills: [
        {
          id: 'fc-advance',
          mode: InboundFreightMode.PAY_ADVANCE,
          status: InboundFreightStatus.SETTLED,
          goodsReceiptId: 'gr-bd',
        },
      ],
    });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_CONSIGNMENT_BILLED_IN_ADVANCE' },
    });
    // Nothing was written, and nothing was charged.
    expect(sut.created).toHaveLength(0);
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses an ADVANCE bill on a consignment that already carries one', async () => {
    const sut = makeSut({
      consignmentMode: 'PAY_ADVANCE',
      leg: 'BD_INTAKE',
      consignmentBills: [
        {
          id: 'fc-arrival',
          mode: InboundFreightMode.PAY_LATER,
          status: InboundFreightStatus.PENDING,
          goodsReceiptId: 'gr-in',
        },
      ],
    });
    await expect(sut.svc.record(STAFF, input)).rejects.toMatchObject({
      response: { code: 'FREIGHT_CONSIGNMENT_ALREADY_BILLED' },
    });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('a VOIDED advance bill does NOT block — that is what re-billing means', async () => {
    // The guard reads only LIVE bills (`voidedAt: null`), so a bill
    // withdrawn as wrong leaves the consignment billable again. Without
    // that, void-and-re-bill would be void-and-stuck.
    const sut = makeSut({
      consignmentMode: 'PAY_ADVANCE',
      leg: 'BD_INTAKE',
      consignmentBills: [],
    });
    const view = await sut.svc.record(STAFF, input);
    expect(view.status).toBe(InboundFreightStatus.SETTLED);
  });

  it('two arrivals on ONE consignment are still billed separately', async () => {
    // The per-arrival rule is unchanged: a consignment lands in as many
    // shipments as it takes and a forwarder invoices each. Only an
    // ADVANCE bill is one-per-consignment.
    const sut = makeSut({
      consignmentMode: 'PAY_LATER',
      leg: 'IN_FINAL',
      consignmentBills: [
        {
          id: 'fc-august',
          mode: InboundFreightMode.PAY_LATER,
          status: InboundFreightStatus.PENDING,
          goodsReceiptId: 'gr-august',
        },
      ],
    });
    const view = await sut.svc.record(STAFF, input);
    expect(view.status).toBe(InboundFreightStatus.PENDING);
  });

  it('takes the per-consignment advisory lock before reading the live bills', async () => {
    // Read-then-write is not a guard under READ COMMITTED: two
    // operators billing the two legs at the same moment would each see
    // no bill and each write one.
    const sut = makeSut({ consignmentMode: 'PAY_ADVANCE', leg: 'BD_INTAKE' });
    await sut.svc.record(STAFF, input);
    expect(sut.lockTaken).toHaveBeenCalled();
  });
});

/**
 * THE CURRENCY. The rate is agreed by phone — "৳300 a kilo" — so it is
 * typed in whatever it was negotiated in and converted to rupees at the
 * billing instant, through the same helpers the P&L and the flat fees
 * use (PRC-8).
 */
describe('InboundFreightService.record — agreed in a currency, charged in rupees', () => {
  const input = {
    goodsReceiptId: RECEIPT,
    lines: [
      {
        goodsReceiptLineId: 'grl-1',
        basis: InboundFreightBasis.PER_KG,
        rate: '900',
        chargeableWeightKg: '5',
      },
    ],
  };

  it('converts a BDT bill at the rate in force, and records what was agreed', async () => {
    // ৳4,500 at the stored INR→BDT 1.23 is ₹3,658.54. Divided by the
    // stored rate rather than multiplied by a rounded reciprocal, which
    // is what `toInr` does and why the pair is kept.
    const sut = makeSut();
    const view = await sut.svc.record(STAFF, { ...input, currency: Currency.BDT });

    expect(view.agreedCurrency).toBe(Currency.BDT);
    expect(view.agreedAmount).toBe('4500');
    expect(view.amountInr).toBe('3658.54');
    // The rate, its direction and where it came from — "why was I
    // billed ₹3,658.54?" has no answer a month later without them.
    expect(view.fxRate).toBe('1.23');
    expect(view.fxRatePair).toBe('INR→BDT');
    expect(view.fxRateSource).toBe('HISTORY');
  });

  it('an INR bill records NO rate at all', async () => {
    const sut = makeSut();
    const view = await sut.svc.record(STAFF, input);
    expect(view.agreedCurrency).toBe(Currency.INR);
    expect(view.agreedAmount).toBe('4500');
    expect(view.amountInr).toBe('4500');
    expect(view.fxRate).toBeNull();
    expect(view.fxRatePair).toBeNull();
  });

  it('REFUSES when there is no rate — never bills the taka figure as rupees', async () => {
    // The failure that matters: ৳4,500 recorded as ₹4,500 is a 23%
    // overcharge that typechecks, commits and renders. Refusing sends
    // whoever reads it to the FX screen, which is where the problem is.
    const sut = makeSut({ fxHistory: null, fxCurrent: null });
    await expect(sut.svc.record(STAFF, { ...input, currency: Currency.BDT })).rejects.toMatchObject(
      { response: { code: 'NO_FX_RATE_FOR_FREIGHT' } },
    );
    expect(sut.created).toHaveLength(0);
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('an INR bill is unaffected by a missing BDT rate', async () => {
    // The conversion is an identity, so it never asks for a rate.
    const sut = makeSut({ fxHistory: null, fxCurrent: null });
    const view = await sut.svc.record(STAFF, input);
    expect(view.amountInr).toBe('4500');
  });

  it('the wallet is debited the RUPEE figure, never the agreed one', async () => {
    const sut = makeSut({ mode: 'PAY_NOW' });
    await sut.svc.record(STAFF, { ...input, currency: Currency.BDT });
    const entry = sut.applyEntry.mock.calls[0]![1] as AnyArgs;
    expect(entry['currency']).toBe(Currency.INR);
    expect(String(entry['amount'])).toBe('3658.54');
  });

  it('the allocation carries the rate AS AGREED and the line in both', async () => {
    const sut = makeSut();
    await sut.svc.record(STAFF, { ...input, currency: Currency.BDT });
    const alloc = sut.allocCreate.mock.calls[0]![0]['data'] as AnyArgs;
    // ৳900 a kilo stays ৳900 a kilo. Storing 731.71 here would make the
    // bill unreadable against the invoice it was typed from.
    expect(String(alloc['rate'])).toBe('900');
    expect(String(alloc['lineTotalAgreed'])).toBe('4500');
    expect(String(alloc['lineTotalInr'])).toBe('3658.54');
  });
});

/**
 * VOID AND RE-BILL. A wrong bill — a mistyped rate, a recount — is
 * withdrawn and a fresh one raised, so the freight record and the money
 * always agree and margin stays true.
 */
describe('InboundFreightService.void', () => {
  it('gives back exactly what the bill CHARGED, as a credit', async () => {
    // The ledger is append-only, so the give-back is a new entry. The
    // amount is `amountSettledInr` — what was actually taken — not the
    // bill's face value.
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.SETTLED,
        mode: InboundFreightMode.PAY_ADVANCE,
        amountSettledInr: new Prisma.Decimal('4500.00'),
        walletEntryId: 'we-charge',
      }),
    });
    const view = await sut.svc.void(STAFF, CHARGE, 'Rate was typed as 900, the invoice says 90');

    expect(view.status).toBe(InboundFreightStatus.VOIDED);
    expect(sut.applyEntry).toHaveBeenCalledTimes(1);
    const entry = sut.applyEntry.mock.calls[0]![1] as AnyArgs;
    expect(entry['direction']).toBe(WalletEntryDirection.INBOUND_FREIGHT_REFUND);
    expect(String(entry['amount'])).toBe('4500');
    // Points back at the debit it returns, so the pair reads as one
    // round trip rather than two unrelated lines.
    expect(entry['linkedEntryId']).toBe('we-charge');
  });

  it('writes NO entry when the bill had charged nothing', async () => {
    // A PENDING pay-later bill whose units have not left owes the seller
    // nothing back, and a ₹0 credit is a line nobody can read a meaning
    // into.
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.PENDING,
        amountSettledInr: new Prisma.Decimal('0.00'),
      }),
    });
    await sut.svc.void(STAFF, CHARGE, 'Recounted at Dhaka — 40 units, not 60');
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('zeroes the allocations, so a withdrawn bill never reads as part-paid', async () => {
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.PARTIALLY_SETTLED,
        amountSettledInr: new Prisma.Decimal('1200.00'),
      }),
    });
    await sut.svc.void(STAFF, CHARGE, 'Wrong consignment — this is not their shipment');
    expect(sut.allocUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitsSettled: 0 }),
      }),
    );
  });

  it('refuses a bill already withdrawn — the money is not given back twice', async () => {
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.VOIDED,
        voidedAt: new Date('2026-09-19T00:00:00.000Z'),
      }),
    });
    await expect(
      sut.svc.void(STAFF, CHARGE, 'Withdrawing it again for some reason'),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_ALREADY_VOIDED' } });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('refuses when another operator got there first (the guarded claim)', async () => {
    // The claim is on "not already voided AND the same amountSettled",
    // so a unit charged between the read and the write cannot be
    // silently left uncredited either.
    const sut = makeSut({
      loaded: chargeRow({ amountSettledInr: new Prisma.Decimal('4500.00') }),
      claimCount: 0,
    });
    await expect(
      sut.svc.void(STAFF, CHARGE, 'Rate was typed as 900, the invoice says 90'),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_ALREADY_VOIDED' } });
    expect(sut.applyEntry).not.toHaveBeenCalled();
  });

  it('demands a reason — the seller reads it on their timeline', async () => {
    const sut = makeSut({ loaded: chargeRow() });
    await expect(sut.svc.void(STAFF, CHARGE, 'oops')).rejects.toMatchObject({
      response: { code: 'FREIGHT_VOID_REASON_TOO_SHORT' },
    });
  });

  it('audits at HIGH and tells the seller on the timeline', async () => {
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.SETTLED,
        amountSettledInr: new Prisma.Decimal('4500.00'),
      }),
    });
    await sut.svc.void(STAFF, CHARGE, 'Rate was typed as 900, the invoice says 90');
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wallet.inbound_freight.voided',
        severity: 'HIGH',
        metadata: expect.objectContaining({ refundedInr: '4500' }),
      }),
      expect.anything(),
    );
    expect(sut.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voided: true, refundedInr: '4500' }),
      }),
      expect.anything(),
    );
  });

  it('nets to ZERO over a charge and its void — and a re-bill starts clean', async () => {
    // The whole point of void-and-re-bill: the seller is left owing
    // exactly what the CORRECTED bill says, never the sum of the two.
    const sut = makeSut({
      loaded: chargeRow({
        status: InboundFreightStatus.SETTLED,
        amountSettledInr: new Prisma.Decimal('4500.00'),
        walletEntryId: 'we-charge',
      }),
    });
    await sut.svc.void(STAFF, CHARGE, 'Rate was typed as 900, the invoice says 90');

    const charged = new Prisma.Decimal('4500.00');
    const refund = new Prisma.Decimal(
      String((sut.applyEntry.mock.calls[0]![1] as AnyArgs)['amount']),
    );
    expect(charged.sub(refund).toString()).toBe('0');
  });
});
