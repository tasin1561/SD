import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResellerStoreActionMode } from '@skydrop/db';
import {
  ACTION_CAPABILITIES,
  DEFAULT_POLICY,
  ResellerStoreActionPolicyService,
  effectivePolicy,
  modeFor,
} from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { AuthenticatedSeller } from '../../src/common/types/request';

const SELLER = { id: 's1', userId: 'su1', fullName: 'Owner' } as unknown as AuthenticatedSeller;

function makeService(store: { id: string; name: string } | null = { id: 'st1', name: 'Kolkata' }) {
  const policy = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(async (args: { create?: unknown; update?: unknown }) => ({
      storeId: 'st1',
      ...DEFAULT_POLICY,
      ...((args.update ?? args.create ?? {}) as Record<string, unknown>),
      updatedAt: new Date('2026-09-16T00:00:00Z'),
    })),
  };
  const sellerStore = { findFirst: jest.fn().mockResolvedValue(store) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    client: { resellerStoreActionPolicy: policy, sellerStore },
  } as unknown as PrismaService;
  return {
    policy,
    sellerStore,
    audit,
    svc: new ResellerStoreActionPolicyService(prisma, audit as unknown as AuditLogService),
  };
}

const ALL_DIRECT = Object.fromEntries(
  ACTION_CAPABILITIES.map((c) => [c, ResellerStoreActionMode.DIRECT]),
) as Record<(typeof ACTION_CAPABILITIES)[number], ResellerStoreActionMode>;

describe('reseller store action policy (2026-09-16)', () => {
  describe('the defaults', () => {
    it('a store with NO row runs on the defaults, not on "nothing allowed"', () => {
      // Reading an absent row as OFF would have taken `cancel` away from
      // every store the day this shipped — they hold orders.cancel today.
      const view = effectivePolicy('st1', null);
      expect(view.set).toBe(false);
      for (const capability of ACTION_CAPABILITIES) {
        expect(view[capability]).toBe(DEFAULT_POLICY[capability]);
      }
    });

    it('everything that spends nobody’s money is DIRECT; the two that send a van are not', () => {
      expect(DEFAULT_POLICY.recall).toBe(ResellerStoreActionMode.DIRECT);
      expect(DEFAULT_POLICY.addressFix).toBe(ResellerStoreActionMode.DIRECT);
      expect(DEFAULT_POLICY.cancel).toBe(ResellerStoreActionMode.DIRECT);
      expect(DEFAULT_POLICY.callCapDecision).toBe(ResellerStoreActionMode.DIRECT);
      expect(DEFAULT_POLICY.chaseSkydrop).toBe(ResellerStoreActionMode.DIRECT);
      expect(DEFAULT_POLICY.reattempt).toBe(ResellerStoreActionMode.ASK_SELLER);
      expect(DEFAULT_POLICY.sendBack).toBe(ResellerStoreActionMode.ASK_SELLER);
    });

    it('the code defaults and the COLUMN defaults say the same thing', () => {
      // A default that drifts between the table and the code is a store
      // told it may do something the database refuses, or the reverse.
      // Read from the migration, which is what the deployed table has.
      const sql = readFileSync(
        join(
          __dirname,
          '../../../../packages/db/prisma/migrations/20260916000000_reseller_store_action_policy/migration.sql',
        ),
        'utf8',
      );
      const snake = (c: string): string => c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      for (const capability of ACTION_CAPABILITIES) {
        const want =
          DEFAULT_POLICY[capability] === ResellerStoreActionMode.DIRECT ? 'direct' : 'ask_seller';
        expect(sql).toMatch(new RegExp(`"${snake(capability)}"[^,]*DEFAULT '${want}'`));
      }
    });
  });

  describe('reading', () => {
    it('a store that is not this seller’s is a 404 that says nothing more', async () => {
      const { svc } = makeService(null);
      await expect(svc.getForSeller('s1', 'st-other')).rejects.toMatchObject({
        response: { code: 'STORE_NOT_FOUND' },
      });
    });

    it('the seller read is scoped to their own RESELLER store', async () => {
      const { svc, sellerStore } = makeService();
      await svc.getForSeller('s1', 'st1');
      expect(sellerStore.findFirst.mock.calls[0]![0].where).toMatchObject({
        id: 'st1',
        sellerId: 's1',
        kind: 'RESELLER',
        deletedAt: null,
      });
    });

    it('forStore needs no seller — the caller already holds a store token', async () => {
      const { svc, sellerStore } = makeService();
      const view = await svc.forStore('st1');
      expect(sellerStore.findFirst).not.toHaveBeenCalled();
      expect(view.storeId).toBe('st1');
    });
  });

  describe('setting', () => {
    it('writes every capability, so a saved policy is never half-stated', async () => {
      const { svc, policy } = makeService();
      await svc.setPolicy(SELLER, 'st1', ALL_DIRECT);
      const written = policy.upsert.mock.calls[0]![0] as {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      for (const capability of ACTION_CAPABILITIES) {
        expect(written.create[capability]).toBe(ResellerStoreActionMode.DIRECT);
        expect(written.update[capability]).toBe(ResellerStoreActionMode.DIRECT);
      }
      expect(written.create.updatedBySellerUserId).toBe('su1');
    });

    it('audits MEDIUM with the EFFECTIVE policy either side', async () => {
      // Before/after as effective policies, so the first save reads as
      // "reattempt: ask_seller → direct" rather than "null → everything".
      const { svc, audit } = makeService();
      await svc.setPolicy(SELLER, 'st1', ALL_DIRECT);
      const row = audit.log.mock.calls[0]![0] as {
        action: string;
        severity: string;
        entityId: string;
        changes: { before: Record<string, unknown>; after: Record<string, unknown> };
      };
      expect(row.action).toBe('reseller_store.action_policy_set');
      expect(row.severity).toBe('MEDIUM');
      expect(row.entityId).toBe('st1');
      expect(row.changes.before.reattempt).toBe(ResellerStoreActionMode.ASK_SELLER);
      expect(row.changes.after.reattempt).toBe(ResellerStoreActionMode.DIRECT);
    });

    it('refuses a store that is not this seller’s before writing anything', async () => {
      const { svc, policy } = makeService(null);
      await expect(svc.setPolicy(SELLER, 'st-other', ALL_DIRECT)).rejects.toThrow();
      expect(policy.upsert).not.toHaveBeenCalled();
    });
  });

  it('modeFor answers the question every action site asks', () => {
    const view = effectivePolicy('st1', null);
    expect(modeFor(view, 'reattempt')).toBe(ResellerStoreActionMode.ASK_SELLER);
    expect(modeFor(view, 'recall')).toBe(ResellerStoreActionMode.DIRECT);
  });
});
