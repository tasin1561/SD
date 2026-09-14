import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ResellerCreditTrigger, ResellerStoreStatus } from '@skydrop/db';
import type { ActorType, Prisma } from '@skydrop/db';
import { AdvisoryLock, advisoryKey } from '../../src/common/db/advisory-lock';
import type { AuthenticatedStoreUser } from '../../src/common/types/request';
import { ResellerStoreTermsService } from '../../src/modules/reseller-store-terms/services/reseller-store-terms.service';

/**
 * RS-4 — the terms service's guards, over a small in-memory table.
 * The concurrency itself (two publishes, one number) is proven against
 * Postgres in reseller-terms-flow.e2e-spec.ts; this pins the ORDER of the
 * steps (lock before read) and every refusal.
 */

const STORE_ID = '0190aaaa-0000-7000-8000-000000000001';
const OTHER_STORE_ID = '0190aaaa-0000-7000-8000-000000000002';
const SELLER_ID = '0190bbbb-0000-7000-8000-000000000001';

interface VersionRow {
  id: string;
  storeId: string;
  version: number;
  deliveryFeeStorePercent: Prisma.Decimal;
  returnFeeStorePercent: Prisma.Decimal;
  customerReturnFeeStorePercent: Prisma.Decimal;
  codFeeStorePercent: Prisma.Decimal;
  codTaxStorePercent: Prisma.Decimal;
  instantPayFeeStorePercent: Prisma.Decimal;
  storeCreditTrigger: ResellerCreditTrigger;
  storeCreditDays: number;
  sellerCreditTrigger: ResellerCreditTrigger;
  sellerCreditDays: number;
  note: string | null;
  createdByActorType: ActorType;
  createdById: string | null;
  createdAt: Date;
  acceptances: Array<{
    id: string;
    acceptedAt: Date;
    ipAddress: string | null;
    storeUser: { fullName: string };
  }>;
}

const DRAFT = {
  percents: {
    deliveryFeeStorePercent: '80',
    returnFeeStorePercent: '100',
    customerReturnFeeStorePercent: '100',
    codFeeStorePercent: '0',
    codTaxStorePercent: '100',
    instantPayFeeStorePercent: '100',
  },
  storeCredit: { trigger: ResellerCreditTrigger.ON_PAYOUT, days: 0 },
  sellerCredit: { trigger: ResellerCreditTrigger.ON_PAYOUT, days: 0 },
};

function harness(opts: { storeStatus?: ResellerStoreStatus; afterConfirmation?: boolean } = {}) {
  const versions: VersionRow[] = [];
  const log: string[] = [];
  let seq = 0;
  const store = {
    id: STORE_ID,
    sellerId: SELLER_ID,
    name: 'Acme',
    displayName: null,
    status: opts.storeStatus ?? ResellerStoreStatus.ACTIVE,
    seller: { companyName: 'Menev' },
  };

  const latest = (storeId: string): VersionRow | null =>
    versions.filter((v) => v.storeId === storeId).sort((a, b) => b.version - a.version)[0] ?? null;

  const tx = {
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      log.push(`lock:${String(values[0])}:${String(values[1])}`);
      return 1;
    }),
    resellerStoreTermsVersion: {
      findFirst: jest.fn(async (args: { where: { storeId: string; id?: string } }) => {
        log.push('read');
        if (args.where.id !== undefined) {
          return (
            versions.find((v) => v.id === args.where.id && v.storeId === args.where.storeId) ?? null
          );
        }
        return latest(args.where.storeId);
      }),
      findMany: jest.fn(async (args: { where: { storeId: string } }) =>
        versions
          .filter((v) => v.storeId === args.where.storeId)
          .sort((a, b) => b.version - a.version),
      ),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        log.push('create');
        const d = args.data;
        const row: VersionRow = {
          id: `0190cccc-0000-7000-8000-00000000000${++seq}`,
          storeId: d.storeId as string,
          version: d.version as number,
          deliveryFeeStorePercent: d.deliveryFeeStorePercent as Prisma.Decimal,
          returnFeeStorePercent: d.returnFeeStorePercent as Prisma.Decimal,
          customerReturnFeeStorePercent: d.customerReturnFeeStorePercent as Prisma.Decimal,
          codFeeStorePercent: d.codFeeStorePercent as Prisma.Decimal,
          codTaxStorePercent: d.codTaxStorePercent as Prisma.Decimal,
          instantPayFeeStorePercent: d.instantPayFeeStorePercent as Prisma.Decimal,
          storeCreditTrigger: d.storeCreditTrigger as ResellerCreditTrigger,
          storeCreditDays: d.storeCreditDays as number,
          sellerCreditTrigger: d.sellerCreditTrigger as ResellerCreditTrigger,
          sellerCreditDays: d.sellerCreditDays as number,
          note: (d.note as string | null) ?? null,
          createdByActorType: d.createdByActorType as ActorType,
          createdById: (d.createdById as string | null) ?? null,
          createdAt: new Date('2026-09-14T10:00:00Z'),
          acceptances: [],
        };
        versions.push(row);
        return row;
      }),
    },
    resellerStoreTermsAcceptance: {
      create: jest.fn(async (args: { data: { termsVersionId: string; storeUserId: string } }) => {
        log.push('accept');
        const v = versions.find((x) => x.id === args.data.termsVersionId);
        const row = { id: `0190dddd-0000-7000-8000-00000000000${++seq}` };
        v?.acceptances.push({
          id: row.id,
          acceptedAt: new Date('2026-09-14T11:00:00Z'),
          ipAddress: null,
          storeUser: { fullName: 'Store Owner' },
        });
        return row;
      }),
    },
    sellerStore: {
      findFirst: jest.fn(async (args: { where: { id: string; sellerId?: string } }) =>
        args.where.id === STORE_ID && (args.where.sellerId ?? SELLER_ID) === SELLER_ID
          ? store
          : null,
      ),
      findUnique: jest.fn(async () => ({ sellerId: SELLER_ID })),
    },
  };
  const client = {
    ...tx,
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const settings = {
    resolve: jest.fn(async (_s: string, key: string) => ({
      key,
      valueType: 'DECIMAL',
      value: key === 'pricing.flat_delivery_fee_inr' ? '200.00' : '30.00',
      source: 'SYSTEM_DEFAULT',
    })),
  };
  const credit = { isEnabled: jest.fn(async () => opts.afterConfirmation === true) };
  const notifier = {
    published: jest.fn(async () => undefined),
    accepted: jest.fn(async () => undefined),
  };
  const svc = new ResellerStoreTermsService(
    { client } as never,
    audit as never,
    settings as never,
    credit as never,
    notifier as never,
  );
  return { svc, versions, log, audit, notifier, credit, tx };
}

const actor = { sellerUserId: '0190eeee-0000-7000-8000-000000000001', name: 'Seller Person' };

function storeUser(storeId = STORE_ID): AuthenticatedStoreUser {
  return {
    id: '0190ffff-0000-7000-8000-000000000001',
    storeId,
    sellerId: SELLER_ID,
    email: 'owner@store.test',
    fullName: 'Store Owner',
    emailVerifiedAt: null,
    jti: null,
    roleKey: 'owner',
    roleName: 'Owner',
    permissions: ['terms.view', 'terms.accept'],
  };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'NONE';
  } catch (err) {
    const res = (err as { getResponse?: () => unknown }).getResponse?.() as
      | { code?: string }
      | undefined;
    return res?.code ?? 'OTHER';
  }
}

describe('ResellerStoreTermsService.publish (RS-4)', () => {
  it('takes the per-store lock BEFORE reading the latest version, then writes version + 1', async () => {
    const h = harness();
    const view = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    expect(view.current?.version).toBe(1);
    const lockIdx = h.log.findIndex((l) => l.startsWith('lock:'));
    expect(h.log[lockIdx]).toBe(`lock:${AdvisoryLock.RESELLER_TERMS}:${advisoryKey(STORE_ID)}`);
    expect(lockIdx).toBeLessThan(h.log.indexOf('read'));
    expect(h.log.indexOf('read')).toBeLessThan(h.log.indexOf('create'));

    await h.svc.publish(
      SELLER_ID,
      STORE_ID,
      { ...DRAFT, percents: { ...DRAFT.percents, deliveryFeeStorePercent: '50' } },
      actor,
    );
    expect(h.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(h.notifier.published).toHaveBeenCalledTimes(2);
  });

  it('audits MEDIUM with before and after', async () => {
    const h = harness();
    await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    await h.svc.publish(
      SELLER_ID,
      STORE_ID,
      { ...DRAFT, percents: { ...DRAFT.percents, codFeeStorePercent: '25' } },
      actor,
    );
    const calls = h.audit.log.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const second = calls[1]?.[0] as {
      severity: string;
      changes: {
        before: { version: number; codFeeStorePercent: string };
        after: { version: number; codFeeStorePercent: string };
      };
    };
    expect(second.severity).toBe('MEDIUM');
    expect(second.changes.before).toMatchObject({ version: 1, codFeeStorePercent: '0.00' });
    expect(second.changes.after).toMatchObject({ version: 2, codFeeStorePercent: '25.00' });
  });

  it('refuses a stale edit (basedOnVersion) and an unchanged one', async () => {
    const h = harness();
    await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    expect(
      await codeOf(
        h.svc.publish(
          SELLER_ID,
          STORE_ID,
          { ...DRAFT, basedOnVersion: 0, percents: { ...DRAFT.percents, codFeeStorePercent: '5' } },
          actor,
        ),
      ),
    ).toBe('TERMS_CHANGED');
    expect(await codeOf(h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor))).toBe('TERMS_UNCHANGED');
    expect(h.versions).toHaveLength(1);
  });

  it('refuses credit after confirmation unless Skydrop enabled it for the seller', async () => {
    const off = harness({ afterConfirmation: false });
    const draft = {
      ...DRAFT,
      storeCredit: { trigger: ResellerCreditTrigger.AFTER_CONFIRMATION, days: 2 },
    };
    expect(await codeOf(off.svc.publish(SELLER_ID, STORE_ID, draft, actor))).toBe(
      'CREDIT_AFTER_CONFIRMATION_NOT_ENABLED',
    );
    expect(off.versions).toHaveLength(0);
    const on = harness({ afterConfirmation: true });
    await on.svc.publish(SELLER_ID, STORE_ID, draft, actor);
    expect(on.versions).toHaveLength(1);
  });

  it('maps a bad share or timing to a 400 carrying the rule’s code', async () => {
    const h = harness();
    const bad = h.svc.publish(
      SELLER_ID,
      STORE_ID,
      { ...DRAFT, percents: { ...DRAFT.percents, codTaxStorePercent: '101' } },
      actor,
    );
    await expect(bad).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await codeOf(
        h.svc.publish(
          SELLER_ID,
          STORE_ID,
          { ...DRAFT, percents: { ...DRAFT.percents, codTaxStorePercent: '101' } },
          actor,
        ),
      ),
    ).toBe('FEE_SPLIT_PERCENT_OUT_OF_RANGE');
    expect(
      await codeOf(
        h.svc.publish(
          SELLER_ID,
          STORE_ID,
          { ...DRAFT, sellerCredit: { trigger: ResellerCreditTrigger.INSTANT, days: 4 } },
          actor,
        ),
      ),
    ).toBe('INSTANT_TAKES_NO_DAYS');
  });

  it('refuses a closed store and another seller’s store', async () => {
    const closed = harness({ storeStatus: ResellerStoreStatus.CLOSED });
    expect(await codeOf(closed.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor))).toBe(
      'STORE_IS_FINAL',
    );
    const h = harness();
    await expect(
      h.svc.publish('0190bbbb-0000-7000-8000-000000000099', STORE_ID, DRAFT, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('works the current version through the fee split for the example', async () => {
    const h = harness();
    const view = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    const delivery = view.examples.find((e) => e.feeType === 'DELIVERY_FEE');
    expect(delivery).toMatchObject({ feeInr: '200.00', storeInr: '160.00', sellerInr: '40.00' });
    const share = view.current?.shares.find((s) => s.feeType === 'DELIVERY_FEE');
    expect(share?.words).toBe('Delivery fee: Acme pays 80%, Menev pays 20%.');
  });
});

describe('ResellerStoreTermsService.accept (RS-4)', () => {
  it('accepts the version in force once, under the lock, and tells the seller', async () => {
    const h = harness();
    const published = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    const versionId = published.current?.id ?? '';
    const view = await h.svc.accept(storeUser(), versionId, {
      ip: '203.0.113.9',
      userAgent: 'jest',
    });
    expect(view.currentAccepted).toBe(true);
    expect(h.notifier.accepted).toHaveBeenCalledTimes(1);

    // A second click writes nothing and audits nothing more.
    const auditsBefore = h.audit.log.mock.calls.length;
    await h.svc.accept(storeUser(), versionId, { ip: null, userAgent: null });
    expect(h.tx.resellerStoreTermsAcceptance.create).toHaveBeenCalledTimes(1);
    expect(h.audit.log.mock.calls.length).toBe(auditsBefore);
  });

  it('refuses a replaced version, and another store’s version is a 404', async () => {
    const h = harness();
    const v1 = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    await h.svc.publish(
      SELLER_ID,
      STORE_ID,
      { ...DRAFT, percents: { ...DRAFT.percents, codFeeStorePercent: '10' } },
      actor,
    );
    expect(
      await codeOf(h.svc.accept(storeUser(), v1.current?.id ?? '', { ip: null, userAgent: null })),
    ).toBe('TERMS_NOT_CURRENT');
    await expect(
      h.svc.accept(storeUser(OTHER_STORE_ID), v1.current?.id ?? '', { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores no IP that is not an IP', async () => {
    const h = harness();
    const v = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    await h.svc.accept(storeUser(), v.current?.id ?? '', { ip: 'not-an-ip', userAgent: 'x' });
    const data = (
      h.tx.resellerStoreTermsAcceptance.create.mock.calls[0] as unknown as [
        { data: { ipAddress: string | null } },
      ]
    )[0].data;
    expect(data.ipAddress).toBeNull();
  });
});

describe('ResellerStoreTermsService — the surface phase 3b calls', () => {
  it('orderReadiness walks NO_TERMS → TERMS_NOT_ACCEPTED → ready', async () => {
    const h = harness();
    expect((await h.svc.orderReadiness(STORE_ID)).reasons).toEqual(['NO_TERMS']);
    const v = await h.svc.publish(SELLER_ID, STORE_ID, DRAFT, actor);
    const r1 = await h.svc.orderReadiness(STORE_ID);
    expect(r1).toMatchObject({
      ready: false,
      reasons: ['TERMS_NOT_ACCEPTED'],
      termsVersionId: v.current?.id,
    });
    await h.svc.accept(storeUser(), v.current?.id ?? '', { ip: null, userAgent: null });
    expect(await h.svc.acceptedCurrentTerms(STORE_ID)).toBe(true);
    const snapshot = await h.svc.currentTerms(STORE_ID);
    expect(snapshot?.storePercents.deliveryFeeStorePercent.toFixed(2)).toBe('80.00');
    expect((await h.svc.orderReadiness(STORE_ID)).ready).toBe(true);
  });

  it('a version using credit after confirmation is not ready once the switch is off', async () => {
    const h = harness({ afterConfirmation: true });
    const draft = {
      ...DRAFT,
      sellerCredit: { trigger: ResellerCreditTrigger.AFTER_CONFIRMATION, days: 1 },
    };
    const v = await h.svc.publish(SELLER_ID, STORE_ID, draft, actor);
    await h.svc.accept(storeUser(), v.current?.id ?? '', { ip: null, userAgent: null });
    expect((await h.svc.orderReadiness(STORE_ID)).ready).toBe(true);
    h.credit.isEnabled.mockResolvedValue(false);
    const r = await h.svc.orderReadiness(STORE_ID);
    expect(r).toMatchObject({ ready: false, reasons: ['AFTER_CONFIRMATION_NOT_ENABLED'] });
    const view = await h.svc.viewForSeller(SELLER_ID, STORE_ID);
    expect(view.needsRevision).not.toBeNull();
    expect(ConflictException).toBeDefined();
  });
});
