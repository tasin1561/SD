import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { ConsignmentLeg, InboundFreightMode } from '@skydrop/db';
import { ConsignmentFreightModeService } from '../../src/modules/consignment-core/services/consignment-freight-mode.service';
import { ConsignmentDispatchService } from '../../src/modules/consignment/services/consignment-dispatch.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { ConsignmentService } from '../../src/modules/consignment/services/consignment.service';

type AnyArgs = Record<string, unknown>;

const CONSIGNMENT = 'cn-1';
const SELLER = 'seller-1';

/**
 * The three-level chain, and the two things it gates.
 *
 *     consignment pin ?? seller override ?? global default
 *
 * The first two are SET-1's and are not rebuilt here; what is under test
 * is the third level, the point at which it FREEZES, and the refusal
 * that stops a PAY_ADVANCE consignment leaving Bangladesh unbilled.
 */
function makeModeSut(
  opts: {
    /** The consignment's own pin; null = fall through. */
    pin?: InboundFreightMode | null;
    /** What the seller resolves to, and whether it is their own override. */
    sellerValue?: string;
    sellerSource?: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT';
    /** Live (non-voided) bills on the consignment. */
    bills?: AnyArgs[];
    settingsThrows?: boolean;
    /** What the guarded `updateMany` claims. */
    claimCount?: number;
    /** The consignment row is missing entirely. */
    missing?: boolean;
  } = {},
) {
  const consignmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.claimCount ?? 1,
  }));
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.missing === true
      ? null
      : {
          sellerId: SELLER,
          inboundFreightMode: opts.pin ?? null,
          freightCharges: opts.bills ?? [],
        },
  );
  const client: AnyArgs = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
    consignment: { findUnique, updateMany: consignmentUpdateMany, update: jest.fn() },
  };
  const prisma = { client } as unknown as PrismaService;

  const resolve = jest.fn(async () => {
    if (opts.settingsThrows === true) throw new Error('settings down');
    return {
      key: 'wallet.inbound_freight_mode',
      value: opts.sellerValue ?? 'PAY_NOW',
      source: opts.sellerSource ?? 'SYSTEM_DEFAULT',
    };
  });
  const settings = { resolve } as unknown as SettingsResolverService;
  const auditLog = jest.fn(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;

  return {
    svc: new ConsignmentFreightModeService(prisma, settings, audit),
    consignmentUpdateMany,
    auditLog,
    resolve,
  };
}

describe('ConsignmentFreightModeService — the three-level chain', () => {
  it("falls through to the seller's override when the consignment is not pinned", async () => {
    const sut = makeModeSut({
      pin: null,
      sellerValue: 'PAY_LATER',
      sellerSource: 'SELLER_OVERRIDE',
    });
    const resolved = await sut.svc.resolveForConsignment(CONSIGNMENT);
    expect(resolved.mode).toBe(InboundFreightMode.PAY_LATER);
    expect(resolved.source).toBe('SELLER');
  });

  it('falls through again to the global default when the seller has no override', async () => {
    const sut = makeModeSut({ pin: null, sellerValue: 'PAY_NOW', sellerSource: 'SYSTEM_DEFAULT' });
    const resolved = await sut.svc.resolveForConsignment(CONSIGNMENT);
    expect(resolved.mode).toBe(InboundFreightMode.PAY_NOW);
    expect(resolved.source).toBe('SYSTEM_DEFAULT');
  });

  it("the consignment's own pin BEATS the seller's override", async () => {
    // The owner's worked example: global PAY_LATER, this seller PAY_NOW,
    // and at BD receiving we decide THIS one is billed in advance.
    const sut = makeModeSut({
      pin: InboundFreightMode.PAY_ADVANCE,
      sellerValue: 'PAY_NOW',
      sellerSource: 'SELLER_OVERRIDE',
    });
    const resolved = await sut.svc.resolveForConsignment(CONSIGNMENT);
    expect(resolved.mode).toBe(InboundFreightMode.PAY_ADVANCE);
    expect(resolved.source).toBe('CONSIGNMENT');
  });

  it('an unreadable setting degrades to PAY_NOW, never to PAY_ADVANCE', async () => {
    // PAY_ADVANCE would block a dispatch over a settings read, and
    // PAY_LATER would quietly extend credit. PAY_NOW is what was in
    // force before any of this existed.
    const sut = makeModeSut({ pin: null, settingsThrows: true });
    const resolved = await sut.svc.resolveForConsignment(CONSIGNMENT);
    expect(resolved.mode).toBe(InboundFreightMode.PAY_NOW);
  });

  it('an unrecognised stored value reads as PAY_NOW rather than throwing', async () => {
    // Belt and braces: the settings writer refuses a bad string, but a
    // row written before that guard existed must not stop a dispatch.
    const sut = makeModeSut({ pin: null, sellerValue: 'PAY_ADVANCED' });
    expect((await sut.svc.resolveForConsignment(CONSIGNMENT)).mode).toBe(
      InboundFreightMode.PAY_NOW,
    );
  });
});

describe('ConsignmentFreightModeService — the pin freezes at billing', () => {
  it('pins a consignment while it is unbilled', async () => {
    const sut = makeModeSut({ pin: null, bills: [] });
    await sut.svc.setOverride('staff-1', CONSIGNMENT, InboundFreightMode.PAY_ADVANCE);
    expect(sut.consignmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { inboundFreightMode: InboundFreightMode.PAY_ADVANCE },
      }),
    );
  });

  it('clears the pin so the consignment falls through again', async () => {
    const sut = makeModeSut({ pin: InboundFreightMode.PAY_ADVANCE, bills: [] });
    await sut.svc.setOverride('staff-1', CONSIGNMENT, null);
    expect(sut.consignmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { inboundFreightMode: null } }),
    );
  });

  it('REFUSES once a bill exists — how a raised bill was paid for is settled', async () => {
    const sut = makeModeSut({ pin: null, bills: [{ id: 'fc-1' }] });
    await expect(
      sut.svc.setOverride('staff-1', CONSIGNMENT, InboundFreightMode.PAY_LATER),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_MODE_LOCKED' } });
    expect(sut.consignmentUpdateMany).not.toHaveBeenCalled();
  });

  it('reports `locked` so a screen can say why the control is dead', async () => {
    const sut = makeModeSut({ pin: null, bills: [{ id: 'fc-1' }] });
    expect((await sut.svc.resolveForConsignment(CONSIGNMENT)).locked).toBe(true);
  });

  it('refuses when a bill lands BETWEEN the read and the write', async () => {
    // Read-then-write is not a guard: the claim is on "still unbilled"
    // inside the transaction, and losing it means somebody billed the
    // consignment while this operator was deciding.
    const sut = makeModeSut({ pin: null, bills: [], claimCount: 0 });
    await expect(
      sut.svc.setOverride('staff-1', CONSIGNMENT, InboundFreightMode.PAY_ADVANCE),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_MODE_LOCKED' } });
  });

  it('audits the change WITH where the old value came from', async () => {
    // "Changed from PAY_NOW" reads very differently when PAY_NOW was the
    // seller's own term rather than this consignment's pin.
    const sut = makeModeSut({ pin: null, sellerValue: 'PAY_NOW', sellerSource: 'SELLER_OVERRIDE' });
    await sut.svc.setOverride('staff-1', CONSIGNMENT, InboundFreightMode.PAY_ADVANCE);
    expect(sut.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.consignment.freight_mode_set',
        metadata: expect.objectContaining({
          fromMode: InboundFreightMode.PAY_NOW,
          fromSource: 'SELLER',
          toMode: InboundFreightMode.PAY_ADVANCE,
        }),
      }),
      expect.anything(),
    );
  });
});

describe('ConsignmentFreightModeService — which leg, and who pays up front', () => {
  it('PAY_ADVANCE bills the Bangladesh intake; the others bill the India arrival', async () => {
    const { svc } = makeModeSut();
    expect(svc.legFor(InboundFreightMode.PAY_ADVANCE)).toBe(ConsignmentLeg.BD_INTAKE);
    expect(svc.legFor(InboundFreightMode.PAY_NOW)).toBe(ConsignmentLeg.IN_FINAL);
    expect(svc.legFor(InboundFreightMode.PAY_LATER)).toBe(ConsignmentLeg.IN_FINAL);
  });

  it('PAY_ADVANCE and PAY_NOW settle in full; PAY_LATER amortises', async () => {
    // The one place this is decided. Amortisation asks it too, so the
    // two cannot come to disagree about which modes have already paid.
    const { svc } = makeModeSut();
    expect(svc.settlesImmediately(InboundFreightMode.PAY_ADVANCE)).toBe(true);
    expect(svc.settlesImmediately(InboundFreightMode.PAY_NOW)).toBe(true);
    expect(svc.settlesImmediately(InboundFreightMode.PAY_LATER)).toBe(false);
  });
});

/**
 * THE DISPATCH GUARD.
 *
 * A PAY_ADVANCE consignment may not leave Bangladesh unbilled. Without
 * the refusal "advance" means nothing: the goods go, and the only
 * billing point left is the India arrival, which a PAY_ADVANCE
 * consignment is never billed against — so the shipment ships free.
 */
function makeDispatchSut(
  opts: {
    mode?: InboundFreightMode;
    /** Live bills on the consignment. */
    bills?: AnyArgs[];
  } = {},
) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () => (opts.bills ?? [])[0] ?? null,
  );
  const client: AnyArgs = { inboundFreightCharge: { findFirst } };
  const prisma = { client } as unknown as PrismaService;

  const requireById = jest.fn(async () => ({
    id: CONSIGNMENT,
    sellerId: SELLER,
    consignmentNumber: 'CN-2026-09-000001',
    route: 'VIA_BD',
    cancelledAt: null,
    labellingSite: 'NONE',
    labelsPrintedAt: null,
    sellerReference: null,
    receipts: [
      {
        id: 'gr-bd',
        leg: ConsignmentLeg.BD_INTAKE,
        status: 'COMPLETED',
        warehouseId: 'wh-bd',
        lines: [],
      },
    ],
  }));
  const consignments = { requireById } as unknown as ConsignmentService;

  const freightMode = {
    modeFor: jest.fn(async () => opts.mode ?? InboundFreightMode.PAY_NOW),
  } as unknown as ConsignmentFreightModeService;

  // Everything past the guard is irrelevant to these cases: each one
  // either stops AT the guard, or is expected to walk past it into
  // machinery this suite deliberately does not stand up.
  const svc = new ConsignmentDispatchService(
    prisma,
    { log: jest.fn(async () => null) } as never,
    consignments,
    { append: jest.fn() } as never,
    freightMode,
    { recompute: jest.fn() } as never,
    { runWithRetry: jest.fn(async () => ({})), apply: jest.fn() } as never,
    {} as never,
    {} as never,
    { getDefaultWarehouseId: jest.fn(async () => 'wh-in') } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, findFirst };
}

describe('the dispatch guard is TWO stages, and the binding one is inside the tx', () => {
  // The pre-flight alone would pass every behavioural case above, and a
  // void committing between it and the write would still ship an
  // unbilled advance consignment. That second read lives inside a
  // transaction the mocked suite does not run, so it is asserted
  // structurally — the same reason `worker-role.spec.ts` reads sources.
  const src = readFileSync(
    join(__dirname, '../../src/modules/consignment/services/consignment-dispatch.service.ts'),
    'utf8',
  );

  it('takes the freight-bill lock, and only when handed a transaction', () => {
    expect(src).toContain('AdvisoryLock.INBOUND_FREIGHT_BILL');
    expect(src).toMatch(/if \(tx !== undefined\) \{\s*await takeAdvisoryLock\(/);
  });

  it('BOTH dispatch transactions run it before they write', () => {
    const inTx = src.match(
      /assertAdvanceFreightBilled\(consignment\.id, consignment\.consignmentNumber, tx\)/g,
    );
    expect(inTx).toHaveLength(2);
  });
});

describe('ConsignmentDispatchService — a PAY_ADVANCE consignment may not leave unbilled', () => {
  const ctx = { ipAddress: null, userAgent: null, requestId: null };

  it('REFUSES dispatch when no bill has been raised', async () => {
    const sut = makeDispatchSut({ mode: InboundFreightMode.PAY_ADVANCE, bills: [] });
    await expect(
      sut.svc.dispatchToIndia(
        'staff-1',
        CONSIGNMENT,
        { lines: [{ lineId: 'l-1', quantity: 1 }] },
        ctx,
      ),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_ADVANCE_NOT_BILLED' } });
  });

  it('refuses a FORWARD-WITHOUT-COUNT too — there is no count to price a bill from', async () => {
    // The guard sits before that branch on purpose, so the case is
    // refused by exactly this rule rather than by a second one saying
    // the same thing somewhere else.
    const sut = makeDispatchSut({ mode: InboundFreightMode.PAY_ADVANCE, bills: [] });
    await expect(
      sut.svc.dispatchToIndia('staff-1', CONSIGNMENT, { withoutCounting: true }, ctx),
    ).rejects.toMatchObject({ response: { code: 'FREIGHT_ADVANCE_NOT_BILLED' } });
  });

  it('LETS IT GO once the bill exists', async () => {
    const sut = makeDispatchSut({
      mode: InboundFreightMode.PAY_ADVANCE,
      bills: [{ id: 'fc-1' }],
    });
    // It walks past the guard and stops on the next real requirement
    // (nothing selected to dispatch) — which is the point: the freight
    // refusal is no longer what is blocking it.
    await expect(
      sut.svc.dispatchToIndia('staff-1', CONSIGNMENT, { lines: [] }, ctx),
    ).rejects.toMatchObject({ response: { code: 'DISPATCH_NOTHING_SELECTED' } });
  });

  it('does not ask at all for PAY_NOW or PAY_LATER', async () => {
    // Those are billed at the arrival BY DESIGN, so demanding a bill
    // before dispatch would refuse every ordinary consignment.
    for (const mode of [InboundFreightMode.PAY_NOW, InboundFreightMode.PAY_LATER]) {
      const sut = makeDispatchSut({ mode, bills: [] });
      await expect(
        sut.svc.dispatchToIndia('staff-1', CONSIGNMENT, { lines: [] }, ctx),
      ).rejects.toMatchObject({ response: { code: 'DISPATCH_NOTHING_SELECTED' } });
      // The bill lookup is never even made.
      expect(sut.findFirst).not.toHaveBeenCalled();
    }
  });

  it('a VOIDED bill does not count as billed', async () => {
    // The lookup filters `voidedAt: null`, so a bill withdrawn as wrong
    // leaves the goods where they are until a correct one is raised —
    // which is what makes void-and-re-bill safe to offer at Dhaka.
    const sut = makeDispatchSut({ mode: InboundFreightMode.PAY_ADVANCE, bills: [] });
    await expect(
      sut.svc.dispatchToIndia('staff-1', CONSIGNMENT, { lines: [] }, ctx),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sut.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ voidedAt: null }),
      }),
    );
  });
});
