import { NotFoundException } from '@nestjs/common';
import { OrderPageV2GateService } from '../../src/modules/address-check/services/order-page-v2-gate.service';
import { runImpersonated } from '../../src/common/impersonation/impersonation-context';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const SELLER = '019fd096-eb5a-70ed-8eca-705d263bb6a6';
const STORE = '01a0e356-6b93-780c-b198-a2d8b3b9c06c';
const STORE_USER = '01a114cf-5672-706d-8b97-a1ccee1e9300';

function makeGate(opts: { audience?: string | null; allow?: unknown; throws?: boolean }) {
  const findUnique = jest.fn(async ({ where }: { where: { key: string } }) => {
    if (opts.throws === true) throw new Error('database is down');
    if (where.key === 'orders.page_v2_audience') {
      return opts.audience === null ? null : { valueString: opts.audience ?? 'OFF' };
    }
    return { valueJson: opts.allow ?? [] };
  });
  const prisma = { client: { systemSetting: findUnique } } as unknown as PrismaService;
  // The service reads two different keys off the same delegate.
  (
    prisma as unknown as { client: { systemSetting: { findUnique: unknown } } }
  ).client.systemSetting = { findUnique };
  return new OrderPageV2GateService(prisma);
}

describe('OrderPageV2GateService — who sees the new page', () => {
  it('OFF means nobody, including an account on the pilot list', async () => {
    // The list is read only while the audience is STAFF. Leaving a
    // pilot account enabled after somebody switched the flag back to
    // OFF would make the rollback not a rollback.
    const gate = makeGate({ audience: 'OFF', allow: [SELLER] });
    expect(await gate.isEnabledFor({ sellerId: SELLER })).toBe(false);
  });

  it('ALL means everybody, with no list consulted', async () => {
    const gate = makeGate({ audience: 'ALL', allow: [] });
    expect(await gate.isEnabledFor({ sellerId: 'somebody-else' })).toBe(true);
  });

  it('STAFF lets a listed client through', async () => {
    const gate = makeGate({ audience: 'STAFF', allow: [SELLER] });
    expect(await gate.isEnabledFor({ sellerId: SELLER })).toBe(true);
  });

  it('STAFF keeps an unlisted client out', async () => {
    const gate = makeGate({ audience: 'STAFF', allow: [SELLER] });
    expect(await gate.isEnabledFor({ sellerId: 'another-seller' })).toBe(false);
  });

  it.each([
    ['the member store itself', { sellerId: 'x', storeId: STORE, storeUserId: 'y' }, [STORE]],
    ['one associate', { sellerId: 'x', storeId: 'y', storeUserId: STORE_USER }, [STORE_USER]],
  ])('STAFF matches %s by its own id', async (_name, who, allow) => {
    // One flat list across three consoles: the ids are UUIDs from
    // different tables and cannot collide.
    const gate = makeGate({ audience: 'STAFF', allow });
    expect(await gate.isEnabledFor(who)).toBe(true);
  });

  it('matches a pilot id whatever its case', async () => {
    // A UUID pasted out of a database client can arrive upper-cased,
    // and a pilot that silently omits the account somebody just added
    // is the worst kind of not-working.
    const gate = makeGate({ audience: 'STAFF', allow: [SELLER.toUpperCase()] });
    expect(await gate.isEnabledFor({ sellerId: SELLER })).toBe(true);
  });

  it('STAFF lets an impersonating staff member through without being listed', async () => {
    // There is no admin order-creation page, so impersonation is the
    // only way the owner can use a page that lives in somebody else's
    // console.
    const gate = makeGate({ audience: 'STAFF', allow: [] });
    const allowed = await runImpersonated(
      {
        sessionId: 's1',
        staffUserId: 'staff-1',
        subject: { kind: 'SELLER', id: 'another-seller' },
        mayWrite: true,
      },
      async () => gate.isEnabledFor({ sellerId: 'another-seller' }),
    );
    expect(allowed).toBe(true);
  });
});

describe('OrderPageV2GateService — it fails closed', () => {
  it.each([
    ['a missing setting row', { audience: null }],
    ['an unreadable value', { audience: 'STAF' }],
    ['a database that will not answer', { throws: true }],
  ])('%s means OFF', async (_name, opts) => {
    // The opposite of the usual convention here, and deliberate: this
    // decides whether an unproven page is shown to somebody placing
    // real orders, so "we could not tell" has to resolve to the page
    // that has been working for a year.
    const gate = makeGate(opts);
    expect(await gate.isEnabledFor({ sellerId: SELLER })).toBe(false);
  });

  it('a malformed allowlist is an EMPTY pilot, not an open one', async () => {
    const gate = makeGate({ audience: 'STAFF', allow: { nope: true } });
    expect(await gate.isEnabledFor({ sellerId: SELLER })).toBe(false);
  });
});

describe('OrderPageV2GateService — the refusal', () => {
  it('is NOT FOUND, never forbidden', async () => {
    // A 403 confirms the route exists to everyone outside the pilot,
    // which invites "why not me" and advertises a half-built page.
    const gate = makeGate({ audience: 'OFF' });
    const err = await gate.assertEnabledFor({ sellerId: SELLER }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an enabled caller straight through', async () => {
    const gate = makeGate({ audience: 'ALL' });
    await expect(gate.assertEnabledFor({ sellerId: SELLER })).resolves.toBeUndefined();
  });
});
