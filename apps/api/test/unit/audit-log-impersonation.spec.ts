import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActorType, type Prisma } from '@skydrop/db';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import {
  runImpersonated,
  type ImpersonationContext,
} from '../../src/common/impersonation/impersonation-context';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Both halves of "who did this" have to be in the row itself.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * During a support session the action really did happen in the seller's
 * account, so `actorId` stays the seller — that is the truthful answer
 * to "whose account". But a reader also needs to know who was at the
 * keyboard, and that is read from the ambient context rather than passed
 * in by each of the ~200 callers of `log`.
 *
 * The failure this guards against is specific: a row that says the
 * SELLER placed an order a staff member placed. `audit_logs` is
 * append-only (MUST NOT #3), so there is no correcting it later. Six
 * months into "we never placed that order" the row is the only evidence
 * there is, and if it names the wrong person it is worse than no row —
 * it is evidence against somebody who did nothing.
 *
 * ── WHY IT TESTS THE EXPLICIT-actorType CASE HARDEST ─────────────────
 * The whole design rests on a caller being UNABLE to forget. A caller
 * that passes `actorType: SELLER` — which is what every seller-side
 * caller does, correctly, in the ordinary case — must still have its row
 * upgraded. If the service deferred to what the caller passed, two
 * hundred call sites would each have to remember, the ones that forgot
 * would fail silently, and the ambient context would be decoration.
 *
 * ── AND WHY THE NON-IMPERSONATED CASE IS IN HERE TOO ─────────────────
 * Every audit row in the system goes through this method, and almost
 * none of them is impersonated. A change that stamped the normal path
 * would be a far bigger incident than one that missed the rare path, so
 * the first group below proves the common case is untouched.
 */

/** `audit_logs.entity_id` is `@db.Uuid`, so the fixtures have to be. */
const ORDER_UUID = '0190d4d9-1f21-7a3b-8c4e-6b9e2a1d7f55';
const STAFF_UUID = '0190d4d9-2a44-7c1f-9d02-55e3f8b7c611';
const SELLER_UUID = '0190d4d9-3b57-7e08-8f11-9a2c6d4e8b33';
const STORE_UUID = '0190d4d9-4c6a-7f19-9012-7b3d5e9f1a44';

interface CapturedCreate {
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

function makeSut(): { svc: AuditLogService; captured: CapturedCreate[] } {
  const captured: CapturedCreate[] = [];
  const client = {
    auditLog: {
      create: jest.fn(async (args: CapturedCreate) => {
        captured.push(args);
        return { id: `audit-${captured.length}` };
      }),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  return { svc: new AuditLogService(prisma), captured };
}

function session(overrides: Partial<ImpersonationContext> = {}): ImpersonationContext {
  return {
    sessionId: 'session-1',
    staffUserId: STAFF_UUID,
    subject: { kind: 'SELLER', id: SELLER_UUID },
    mayWrite: true,
    ...overrides,
  };
}

/** The shape of an ordinary seller-side audit call. */
const SELLER_ACTION = {
  actorType: ActorType.SELLER,
  actorId: SELLER_UUID,
  sellerId: SELLER_UUID,
  action: 'seller.order.created',
  entityType: 'order',
  entityId: ORDER_UUID,
} as const;

describe('AuditLogService stamps the impersonator', () => {
  describe('outside any support session — the normal path, untouched', () => {
    it('keeps the actorType the caller passed and leaves the impersonator null', async () => {
      const { svc, captured } = makeSut();
      await svc.log({ ...SELLER_ACTION });

      const data = captured[0]!.data;
      expect(data['actorType']).toBe(ActorType.SELLER);
      expect(data['impersonatedByStaffUserId']).toBeNull();
      expect(data['actorId']).toBe(SELLER_UUID);
    });

    it('does the same for every actorType a caller might pass', async () => {
      // Nothing here should be rewritten. A STAFF row written from the
      // admin console, a SYSTEM row from a cron and an API row from a
      // key all have to come out the far side unchanged.
      for (const actorType of [
        ActorType.STAFF,
        ActorType.SELLER,
        ActorType.SYSTEM,
        ActorType.API,
        ActorType.STORE,
      ]) {
        const { svc, captured } = makeSut();
        await svc.log({ actorType, action: 'x.y.z', entityType: 'thing', entityId: null });
        expect(captured[0]!.data['actorType']).toBe(actorType);
        expect(captured[0]!.data['impersonatedByStaffUserId']).toBeNull();
      }
    });

    it('a background job writes a plain row — nobody impersonates a cron', async () => {
      const { svc, captured } = makeSut();
      await svc.log({
        actorType: ActorType.SYSTEM,
        action: 'system.payout.swept',
        entityType: 'payout',
        entityId: null,
      });

      expect(captured[0]!.data['actorType']).toBe(ActorType.SYSTEM);
      expect(captured[0]!.data['impersonatedByStaffUserId']).toBeNull();
    });
  });

  describe('inside a SELLER support session', () => {
    it('upgrades actorType, names the staff member, and keeps the seller as actorId', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () => svc.log({ ...SELLER_ACTION }));

      const data = captured[0]!.data;
      // Who was at the keyboard.
      expect(data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      // Whose account it happened in. Both facts, in one row.
      expect(data['actorId']).toBe(SELLER_UUID);
      expect(data['sellerId']).toBe(SELLER_UUID);
      // And the row says which kind of event it was, rather than
      // leaving that to be inferred from the presence of a column.
      expect(data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
    });

    it('still records the action and entity the caller asked for', async () => {
      // The stamping must not disturb anything else about the row.
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION, metadata: { reason: 'checking a payout' }, severity: 'HIGH' }),
      );

      const data = captured[0]!.data;
      expect(data['action']).toBe('seller.order.created');
      expect(data['entityType']).toBe('order');
      expect(data['entityId']).toBe(ORDER_UUID);
      expect(data['severity']).toBe('HIGH');
      expect(data['metadata']).toMatchObject({ reason: 'checking a payout', severity: 'HIGH' });
    });

    it('stamps a row written several awaits deep inside the session', async () => {
      // The real call site is behind database reads, not next to the
      // guard. This is the arrangement that actually happens.
      const { svc, captured } = makeSut();
      await runImpersonated(session(), async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await Promise.all([Promise.resolve(), Promise.resolve()]);
        await svc.log({ ...SELLER_ACTION });
      });

      expect(captured[0]!.data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
    });

    it('stamps a read-only session too — reading is still worth attributing', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session({ mayWrite: false }), () =>
        svc.log({
          actorType: ActorType.SELLER,
          actorId: SELLER_UUID,
          action: 'seller.bank_details.viewed',
          entityType: 'seller',
          entityId: SELLER_UUID,
        }),
      );

      expect(captured[0]!.data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
    });
  });

  describe('inside a STORE support session', () => {
    it('upgrades to STAFF_AS_STORE and keeps the store user as actorId', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session({ subject: { kind: 'STORE', id: STORE_UUID } }), () =>
        svc.log({
          actorType: ActorType.STORE,
          actorId: STORE_UUID,
          action: 'store.order.created',
          entityType: 'order',
          entityId: ORDER_UUID,
        }),
      );

      const data = captured[0]!.data;
      expect(data['actorType']).toBe(ActorType.STAFF_AS_STORE);
      expect(data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      expect(data['actorId']).toBe(STORE_UUID);
    });

    it('the two kinds are not interchangeable', async () => {
      // "The store did this" and "the seller did this" are different
      // facts, and a STORE session must never produce a SELLER row —
      // a reseller store and the seller behind it are separate parties.
      const { svc, captured } = makeSut();
      await runImpersonated(session({ subject: { kind: 'STORE', id: STORE_UUID } }), () =>
        svc.log({ ...SELLER_ACTION }),
      );
      await runImpersonated(session({ subject: { kind: 'SELLER', id: SELLER_UUID } }), () =>
        svc.log({ ...SELLER_ACTION }),
      );

      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_STORE);
      expect(captured[1]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
    });
  });

  describe('a caller cannot forget', () => {
    /*
      The point of reading the context here rather than taking a
      parameter. Each case below is a caller doing something entirely
      reasonable — and in every one the row still comes out telling the
      truth, without that caller having been changed.
    */
    it('an explicit actorType: SELLER is still upgraded', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION, actorType: ActorType.SELLER }),
      );

      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
    });

    it('an explicit actorType: STORE is still upgraded', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session({ subject: { kind: 'STORE', id: STORE_UUID } }), () =>
        svc.log({
          actorType: ActorType.STORE,
          actorId: STORE_UUID,
          action: 'store.order.created',
          entityType: 'order',
          entityId: ORDER_UUID,
        }),
      );

      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_STORE);
    });

    it('a caller that passes the WRONG actorType for the session is corrected', async () => {
      // A seller-side service writing a STORE row by mistake, or a
      // shared helper that always passes SYSTEM. The session decides,
      // not the caller — otherwise one careless default would hide the
      // impersonation on a whole module's worth of rows.
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION, actorType: ActorType.SYSTEM }),
      );
      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION, actorType: ActorType.STORE }),
      );
      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION, actorType: ActorType.STAFF }),
      );

      for (const row of captured) {
        expect(row.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
        expect(row.data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      }
    });

    it('a caller that never heard of impersonation gets a correct row', async () => {
      // The minimum a caller can pass. Nothing about impersonation
      // appears in it, and the row is still right.
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () =>
        svc.log({ actorType: ActorType.SELLER, action: 'seller.thing.done', entityType: 'thing' }),
      );

      const data = captured[0]!.data;
      expect(data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
      expect(data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
    });

    it('a row written inside a transaction client is stamped the same way', async () => {
      // Plenty of callers pass a `tx`. The context is ambient, so the
      // branch that picks the client must not also be the branch that
      // decides whether to stamp.
      const { svc } = makeSut();
      const txCaptured: CapturedCreate[] = [];
      const tx = {
        auditLog: {
          create: jest.fn(async (args: CapturedCreate) => {
            txCaptured.push(args);
            return { id: 'audit-tx' };
          }),
        },
      };

      await runImpersonated(session(), () =>
        svc.log({ ...SELLER_ACTION }, tx as unknown as Prisma.TransactionClient),
      );

      expect(txCaptured).toHaveLength(1);
      expect(txCaptured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
      expect(txCaptured[0]!.data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
    });
  });

  describe('the session does not bleed between rows', () => {
    it('a row written after the session ends is a plain row again', async () => {
      const { svc, captured } = makeSut();
      await runImpersonated(session(), () => svc.log({ ...SELLER_ACTION }));
      await svc.log({ ...SELLER_ACTION });

      expect(captured[0]!.data['impersonatedByStaffUserId']).toBe(STAFF_UUID);
      expect(captured[0]!.data['actorType']).toBe(ActorType.STAFF_AS_SELLER);
      // The next request on the same process is somebody else's.
      expect(captured[1]!.data['impersonatedByStaffUserId']).toBeNull();
      expect(captured[1]!.data['actorType']).toBe(ActorType.SELLER);
    });

    it('two concurrent sessions each stamp their own staff member', async () => {
      const { svc, captured } = makeSut();
      const otherStaff = '0190d4d9-5d7b-7020-8123-8c4e6f0a2b55';

      await Promise.all([
        runImpersonated(session(), async () => {
          await new Promise((r) => setTimeout(r, 3));
          await svc.log({ ...SELLER_ACTION, action: 'first' });
        }),
        runImpersonated(session({ staffUserId: otherStaff }), async () => {
          await new Promise((r) => setTimeout(r, 1));
          await svc.log({ ...SELLER_ACTION, action: 'second' });
        }),
      ]);

      const byAction = new Map(
        captured.map((c) => [c.data['action'], c.data['impersonatedByStaffUserId']]),
      );
      expect(byAction.get('first')).toBe(STAFF_UUID);
      expect(byAction.get('second')).toBe(otherStaff);
    });
  });
});

/**
 * Entering and leaving are acts ON the session, not acts INSIDE the
 * account — so they are recorded as the STAFF member.
 *
 * `AuditLogService` rewrites `actorType` whenever a context is open, and
 * the spec above pins that it does so unconditionally. That is right for
 * everything the session DOES. It was wrong for the two rows about the
 * session itself: `ImpersonationService.end` passes `ActorType.STAFF`,
 * `exchange` states the rule out loud ("the honest row is 'this person
 * entered'"), and with the ALS middleware running on `*` the symmetric
 * row came out as `STAFF_AS_SELLER` — "the seller ended the support
 * session". `audit_logs` is append-only, so it could not be corrected
 * after the fact.
 *
 * The fix is in the MIDDLEWARE, not the writer: no context is opened on
 * those routes at all. Tested by asking the middleware's own predicate,
 * because that is where the decision now lives.
 */
describe('the session’s own lifecycle routes open no impersonation context', () => {
  // The predicate as the middleware applies it. Kept in step with the
  // middleware by `impersonation-als-lifecycle.spec.ts`, which reads the
  // real regex out of the source rather than restating it.
  const PATHS = [
    '/auth/seller/impersonation/end',
    '/auth/store/impersonation/end',
    '/auth/seller/impersonation/leave',
    '/auth/store/impersonation/leave',
    '/auth/seller/impersonation/exchange',
    '/auth/store/impersonation/exchange',
    // Case-blind, because Express is: `/auth/Seller/...` reaches the
    // same handler, and a case-sensitive test here would not fire.
    '/auth/Seller/impersonation/end',
    '/AUTH/STORE/IMPERSONATION/LEAVE',
  ];

  for (const path of PATHS) {
    it(`${path} is a session-lifecycle path`, () => {
      expect(lifecyclePattern().test(path)).toBe(true);
    });
  }

  for (const path of [
    '/seller/orders',
    '/seller/api-keys',
    '/auth/seller/login',
    '/auth/seller/impersonations',
    '/store/wallet/withdrawals',
  ]) {
    it(`${path} is NOT, so the context still opens for it`, () => {
      expect(lifecyclePattern().test(path)).toBe(false);
    });
  }
});

/** The middleware's own regex, read off disk so the two cannot drift. */
function lifecyclePattern(): RegExp {
  const src = readFileSync(
    join(__dirname, '../../src/common/impersonation/impersonation-als.middleware.ts'),
    'utf8',
  );
  const m = /SESSION_LIFECYCLE_PATHS\s*=\s*(\/.*\/[a-z]*);/.exec(src);
  if (m?.[1] === undefined) {
    throw new Error(
      'SESSION_LIFECYCLE_PATHS not found in the ALS middleware. If it was renamed, point ' +
        'this test at the new shape — do not delete it: the rows it protects are append-only.',
    );
  }
  const body = m[1];
  const lastSlash = body.lastIndexOf('/');
  return new RegExp(body.slice(1, lastSlash), body.slice(lastSlash + 1));
}
