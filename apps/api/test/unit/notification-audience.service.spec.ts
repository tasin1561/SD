import { NotificationRecipientType, NotificationSubjectType } from '@skydrop/db';
import { NotificationAudienceService } from '../../src/modules/notification-audience/services/notification-audience.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function make(opts: { sellerUsers?: AnyArgs[]; staffUsers?: AnyArgs[]; subs?: AnyArgs[] } = {}) {
  const sellerFindMany = jest.fn(async () => opts.sellerUsers ?? []);
  const staffFindMany = jest.fn(async () => opts.staffUsers ?? []);
  const subFindMany = jest.fn(async () => opts.subs ?? []);
  const client = {
    sellerUser: { findMany: sellerFindMany },
    staffUser: { findMany: staffFindMany },
    notificationSubscription: { findMany: subFindMany },
  };
  const svc = new NotificationAudienceService({ client } as unknown as PrismaService);
  return { svc, sellerFindMany, staffFindMany, subFindMany };
}

const SELLER = { id: 'su-1', email: 'a@x.com', fullName: 'Asha', sellerId: 'sel-1' };
const STAFF = { id: 'st-1', email: 'b@x.com', emailDisplay: 'Bob' };

describe('NotificationAudienceService — who should hear about this', () => {
  it('resolves a seller ROLE to the people holding it', async () => {
    // Seller notifications used to go to one company mailbox. Sellers
    // have had teams and roles for a long time; this is what lets stock
    // alerts reach the people who handle stock.
    const { svc, sellerFindMany } = make({ sellerUsers: [SELLER] });
    const out = await svc.resolve({ kind: 'SELLER_ROLE', sellerId: 'sel-1', roleKey: 'FINANCE' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      recipientType: NotificationRecipientType.SELLER,
      recipientId: 'su-1',
      subjectType: NotificationSubjectType.SELLER_USER,
    });
    expect(sellerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sellerId: 'sel-1', sellerRole: { key: 'FINANCE' } }),
      }),
    );
  });

  it('resolves a SELLER permission — the seller-side twin, owner included', async () => {
    // A company can invent, rename and delete its own roles too, so
    // "whoever handles orders here" is the durable way to name the
    // people an order concerns. An owner holds everything implicitly
    // (`isOwner`) and carries no permission rows, exactly as a
    // super-admin does on the staff side.
    const { svc, sellerFindMany } = make({ sellerUsers: [SELLER] });
    await svc.resolve({
      kind: 'SELLER_PERMISSION',
      sellerId: 'sel-1',
      permission: 'orders.view',
    });
    expect(sellerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sellerId: 'sel-1',
          sellerRole: {
            OR: [{ isOwner: true }, { permissions: { some: { permission: 'orders.view' } } }],
          },
        }),
      }),
    );
  });

  it('resolves a staff PERMISSION — which survives somebody inventing a role', async () => {
    // "Everyone who can pack" keeps working the day a Night Shift Lead
    // role appears; "everyone with role WAREHOUSE_STAFF" silently
    // misses them. Same argument the RBAC layer already made.
    const { svc, staffFindMany } = make({ staffUsers: [STAFF] });
    await svc.resolve({ kind: 'STAFF_PERMISSION', permission: 'warehouse.pack' });
    expect(staffFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          staffRole: {
            // A super-admin holds every permission implicitly and
            // therefore carries no permission ROWS. Matching on rows
            // alone left the people who hold the most out of every
            // audience addressed by what somebody may do — caught by
            // the e2e, which asked a real database and got nobody.
            OR: [
              { isSuperAdmin: true },
              { permissions: { some: { permission: 'warehouse.pack' } } },
            ],
          },
        }),
      }),
    );
  });

  it('never includes a deleted person', async () => {
    // An audience is who can act on it, not who once could.
    const { svc, sellerFindMany, staffFindMany } = make();
    await svc.resolve({ kind: 'ALL_SELLERS' });
    await svc.resolve({ kind: 'ALL_STAFF' });
    for (const fn of [sellerFindMany, staffFindMany]) {
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    }
  });

  it('counts one person ONCE when two selectors both include them', async () => {
    // A finance lead who is also subscribed to the topic has one inbox.
    const { svc } = make({ sellerUsers: [SELLER] });
    const out = await svc.resolveMany([
      { kind: 'SELLER_ORG', sellerId: 'sel-1' },
      { kind: 'SELLER_ROLE', sellerId: 'sel-1', roleKey: 'FINANCE' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('subscribers resolves both sides of the house', async () => {
    const { svc, sellerFindMany, staffFindMany } = make({
      subs: [
        { subjectType: NotificationSubjectType.SELLER_USER, subjectId: 'su-1' },
        { subjectType: NotificationSubjectType.STAFF_USER, subjectId: 'st-1' },
      ],
      sellerUsers: [SELLER],
      staffUsers: [STAFF],
    });
    const out = await svc.resolve({ kind: 'SUBSCRIBERS', topic: 'courier.refusals' });
    expect(out).toHaveLength(2);
    expect(sellerFindMany).toHaveBeenCalled();
    expect(staffFindMany).toHaveBeenCalled();
  });

  it('an empty subscriber list asks the database nothing', async () => {
    const { svc, sellerFindMany, staffFindMany } = make({ subs: [] });
    expect(await svc.resolve({ kind: 'SUBSCRIBERS', topic: 'nobody' })).toEqual([]);
    expect(sellerFindMany).not.toHaveBeenCalled();
    expect(staffFindMany).not.toHaveBeenCalled();
  });

  it('count() answers the question a broadcast asks first', async () => {
    const { svc } = make({ sellerUsers: [SELLER, { ...SELLER, id: 'su-2' }] });
    expect(await svc.count({ kind: 'ALL_SELLERS' })).toBe(2);
  });
});
