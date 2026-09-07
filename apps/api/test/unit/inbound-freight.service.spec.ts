import { BadRequestException } from '@nestjs/common';
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
    loaded?: AnyArgs | null;
    claimCount?: number;
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

  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    goodsReceipt: { findFirst: receiptFindFirst },
    inboundFreightAllocation: { create: jest.fn(async () => ({ id: 'alloc-1' })) },
    // Resolved by CODE inside recordForwarderPayment — the caller never
    // picks the category, so one cost cannot be filed two ways.
    expenseCategory: { findUnique: jest.fn(async () => ({ id: 'cat-freight' })) },
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
  const post = jest.fn(async (_input: Record<string, unknown>, _tx?: unknown) => ({
    id: 'be-1',
  }));
  const bank = { post } as unknown as BankLedgerService;

  return {
    svc: new InboundFreightService(prisma, audit, settings, wallet, amortisation, bank),
    planFromPricedLines,
    applyEntry,
    auditLog,
    created,
    chargeUpdateMany,
    chargeUpdate,
    post,
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

  it('fills in our cost when it was unset', async () => {
    const { svc, chargeUpdate } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    const data = chargeUpdate.mock.calls[0]?.[0]?.['data'] as { ourCostInr?: Prisma.Decimal };
    expect(data.ourCostInr?.toFixed(2)).toBe('2000.00');
  });

  it('does NOT rewrite a known cost down to a part payment', async () => {
    // What the forwarder BILLED and what has CLEARED are different
    // questions. A ₹2,000 instalment against a ₹5,000 invoice must not
    // restate the invoice — the P&L recognises the cost once, in full.
    const { svc, chargeUpdate } = makeSut({
      loaded: chargeRow({ ourCostInr: new Prisma.Decimal('5000.00') }),
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', payment);
    expect(chargeUpdate.mock.calls[0]?.[0]?.['data']).toEqual({});
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
});

describe('paying the forwarder from a BDT account', () => {
  const bdtPayment = {
    bankAccountId: 'ba-1',
    amountPaid: '2500.00',
    occurredAt: new Date('2026-09-01T00:00:00Z'),
  };

  it('stamps the entry in the ACCOUNT’s currency, not INR', async () => {
    // TRE-2: the entry takes the account's currency whatever arrives,
    // so an INR figure sent to a BDT account would not fail — it would
    // be relabelled, wrong by the exchange rate, with nothing in the
    // row to show it happened.
    const { svc, post } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', { ...bdtPayment, costInr: '1800.00' });
    const call = post.mock.calls[0]?.[0] as unknown as {
      amountCurrency: string;
      signedAmount: Prisma.Decimal;
    };
    expect(call.amountCurrency).toBe('BDT');
    expect(call.signedAmount.toFixed(2)).toBe('-2500.00');
  });

  it('records the INR cost given, NOT the BDT amount', async () => {
    // `our_cost_inr` is the P&L's cost side. A BDT figure in it is
    // wrong by the exchange rate and nothing downstream would notice.
    const { svc, chargeUpdate } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
    });
    await svc.recordForwarderPayment('st-1', 'fc-1', { ...bdtPayment, costInr: '1800.00' });
    const data = chargeUpdate.mock.calls[0]?.[0]?.['data'] as { ourCostInr?: Prisma.Decimal };
    expect(data.ourCostInr?.toFixed(2)).toBe('1800.00');
  });

  it('refuses a non-INR payment with no INR cost — it will not guess a rate', async () => {
    // TRE-5: deriving it would silently absorb every bank charge and
    // the gap between the rate quoted and the rate achieved. Both
    // figures come off the two statements.
    const { svc, post } = makeSut({
      bankCurrency: 'BDT',
      loaded: chargeRow({ ourCostInr: null }),
    });
    await expect(svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('an INR account needs no second figure', async () => {
    const { svc, chargeUpdate } = makeSut({ loaded: chargeRow({ ourCostInr: null }) });
    await svc.recordForwarderPayment('st-1', 'fc-1', bdtPayment);
    const data = chargeUpdate.mock.calls[0]?.[0]?.['data'] as { ourCostInr?: Prisma.Decimal };
    expect(data.ourCostInr?.toFixed(2)).toBe('2500.00');
  });
});
