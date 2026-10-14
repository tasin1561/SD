import { StoreOrderScope } from '@skydrop/db';
import { StoreNotificationSender } from '../../src/modules/notification-audience/services/store-notification-sender.service';
import type { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import type { ResolvedRecipient } from '../../src/modules/notification-audience/services/notification-audience.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EnvService } from '../../src/config/env.service';

/**
 * ASSOC-1 — a link sent to a store user points at the console THEY sign
 * in to (2026-10-14).
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────
 * `StoreNotificationSender` built `order_url` / `app_url` ONCE from
 * `resellerAppUrl` and spread the same pair into every recipient's
 * email variables, and the ticket notifier handed it a whole
 * `ticket_url` on the same origin. The audience is a store PERMISSION,
 * and the `associate` preset holds all three order permissions plus
 * `tickets.view` / `tickets.manage` — so every one of those links
 * reached associates on an origin where `__Host-storeRefresh` cannot
 * follow them and almost every page refuses them. It was live:
 * `store.order_changed_by_admin.email` and both store ticket emails are
 * NOT retired (NOTIF-23), and `maySeeThisOrder` deliberately passes an
 * associate for an order they placed.
 *
 * ── WHY IT IS NOT ENOUGH TO TEST THE WIDE CASE ───────────────────────
 * The wide recipient's link is byte-identical before and after the fix,
 * so a suite that only asserts that passes perfectly against the bug.
 * Every case below therefore drives a MIXED audience and asserts on
 * both people from one dispatch.
 */

const STORE = 'store-1';
const ASSOCIATE = 'assoc-1';
const OPS = 'ops-1';

const ENV = {
  resellerAppUrl: 'https://member.test',
  associateAppUrl: 'https://associate.test',
} as unknown as EnvService;

function person(recipientId: string): ResolvedRecipient {
  return {
    recipientType: 'STORE_USER',
    recipientId,
    email: `${recipientId}@example.test`,
    name: recipientId,
    sellerId: null,
    storeId: STORE,
    subjectType: 'STORE_USER',
  } as unknown as ResolvedRecipient;
}

/**
 * The store's team as the roles table really shapes it: one associate
 * (narrow, its own console) and one ops (wide). `findMany` is handed the
 * same shape the service selects, deleted roles included, so the
 * `deletedAt` filter is exercised rather than assumed.
 */
function roleRows(): unknown[] {
  return [
    {
      id: ASSOCIATE,
      roles: [
        {
          role: {
            key: 'associate',
            deletedAt: null,
            isOwner: false,
            orderScope: StoreOrderScope.OWN,
          },
        },
      ],
    },
    {
      id: OPS,
      roles: [
        { role: { key: 'ops', deletedAt: null, isOwner: false, orderScope: StoreOrderScope.ALL } },
      ],
    },
  ];
}

function make(opts: { rolesThrow?: boolean; placedBy?: string | null } = {}) {
  const findMany = jest.fn(async () => {
    if (opts.rolesThrow === true) throw new Error('db down');
    return roleRows();
  });
  const prisma = {
    client: {
      storeUser: { findMany },
      order: {
        findUnique: jest.fn(async () => ({ placedByStoreUserId: opts.placedBy ?? null })),
      },
    },
  } as unknown as PrismaService;

  const dispatch = jest.fn(async () => ({
    groupId: 'g',
    recipients: 2,
    delivered: 2,
    skipped: 0,
    failures: 0,
  }));

  const svc = new StoreNotificationSender(
    { dispatch } as unknown as NotificationDispatchService,
    ENV,
    prisma,
  );
  return { svc, dispatch, findMany };
}

/** The `email.variables` function the sender handed the dispatcher. */
function variablesFn(dispatch: jest.Mock): (p: ResolvedRecipient) => Record<string, unknown> {
  const input = dispatch.mock.calls[0]?.[0] as {
    email: { variables: (p: ResolvedRecipient) => Record<string, unknown> };
  };
  return input.email.variables;
}

const BASE = {
  storeId: STORE,
  topic: 'store.order_changed_by_admin',
  templateCode: 'store.order_changed_by_admin.email',
  eventId: 'ev-1',
  title: 'We changed your order',
  body: 'Skydrop changed order SD-1.',
  variables: { store_name: 'Menev Resell' },
  triggerEvent: 'store.order_changed_by_admin',
  ref: 'ref-1',
} as const;

describe('ASSOC-1 — a store notification links to the reader’s own console', () => {
  it('an associate gets the associate origin; a wide colleague still gets the reseller one', async () => {
    const { svc, dispatch } = make({ placedBy: ASSOCIATE });
    await svc.tell({ ...BASE, orderId: 'order-1' });

    const vars = variablesFn(dispatch);
    expect(vars(person(ASSOCIATE))).toMatchObject({
      order_url: 'https://associate.test/orders/order-1',
      app_url: 'https://associate.test',
    });
    expect(vars(person(OPS))).toMatchObject({
      order_url: 'https://member.test/orders/order-1',
      app_url: 'https://member.test',
    });
  });

  it('a caller’s own link PATH is resolved per person too, never on one origin', async () => {
    // The ticket notifier's shape: it names where in the console, not
    // which console. One mechanism for every link the sender emits.
    const { svc, dispatch } = make();
    await svc.tell({
      ...BASE,
      topic: 'store.ticket_reply',
      templateCode: 'store.ticket_reply.email',
      orderId: null,
      linkPaths: { ticket_url: '/tickets/tk-1' },
    });

    const vars = variablesFn(dispatch);
    expect(vars(person(ASSOCIATE))).toMatchObject({
      ticket_url: 'https://associate.test/tickets/tk-1',
      // No order in hand — `order_url` is the console itself, per person.
      order_url: 'https://associate.test',
    });
    expect(vars(person(OPS))).toMatchObject({
      ticket_url: 'https://member.test/tickets/tk-1',
      order_url: 'https://member.test',
    });
  });

  it('a link the caller pre-built under the same name is CORRECTED, not left to win', async () => {
    // The links are spread last on purpose: a caller still passing a
    // whole URL (the shape every one of them used before this) must not
    // silently defeat the per-person resolution.
    const { svc, dispatch } = make();
    await svc.tell({
      ...BASE,
      orderId: 'order-1',
      variables: { store_name: 'Menev Resell', app_url: 'https://member.test' },
    });
    expect(variablesFn(dispatch)(person(ASSOCIATE))).toMatchObject({
      app_url: 'https://associate.test',
    });
  });

  it('FAILS OPEN to the wide console when the roles cannot be read', async () => {
    // A notification layer must never throw (NOTIF-1). The wide console
    // is `storeConsoleUrl([])` and the behaviour before any of this
    // existed, so an unreadable roles table strands nobody who could
    // already sign in there.
    const { svc, dispatch, findMany } = make({ rolesThrow: true });
    await svc.tell({ ...BASE, orderId: 'order-1' });

    expect(findMany).toHaveBeenCalled();
    expect(variablesFn(dispatch)(person(ASSOCIATE))).toMatchObject({
      order_url: 'https://member.test/orders/order-1',
      app_url: 'https://member.test',
    });
  });

  it('the console is read off the ROLE KEYS, not off the order scope', async () => {
    // The two questions coincide today and are not the same question:
    // `order_scope` is what somebody may SEE, the role key is where they
    // sign IN. A second narrow role — which `store-order-scope.ts`
    // names as the case to expect — must not start mailing its holders
    // links into an app they have no login for.
    const { svc, dispatch, findMany } = make();
    findMany.mockResolvedValueOnce([
      {
        id: OPS,
        roles: [
          // Narrow, and NOT an associate.
          {
            role: { key: 'ops', deletedAt: null, isOwner: false, orderScope: StoreOrderScope.OWN },
          },
        ],
      },
    ]);
    await svc.tell({ ...BASE, orderId: 'order-1' });

    expect(variablesFn(dispatch)(person(OPS))).toMatchObject({
      app_url: 'https://member.test',
    });
    // …and it is still narrowed for what it may SEE: the money line is
    // withheld, which is the scope question answered by scope.
    const input = (dispatch.mock.calls as unknown as unknown[][])[0]?.[0] as {
      recipientFilter: (p: ResolvedRecipient) => boolean;
    };
    expect(input.recipientFilter(person(OPS))).toBe(false);
  });

  it('a DELETED role does not decide the console, even if one reaches the mapper', async () => {
    // The query filters deleted roles out, so this drives the BACKSTOP:
    // `liveRoleKeys` re-applies the filter, which is why it is called on
    // rows the database has already narrowed. The day somebody loosens
    // that `where`, the console answer must not widen with it.
    const { svc, dispatch, findMany } = make();
    findMany.mockResolvedValueOnce([
      {
        id: ASSOCIATE,
        roles: [
          {
            role: {
              key: 'associate',
              deletedAt: null,
              isOwner: false,
              orderScope: StoreOrderScope.OWN,
            },
          },
          // Retired. If this counted, the person would be sent to the
          // reseller console they can no longer use.
          {
            role: {
              key: 'ops',
              deletedAt: new Date(),
              isOwner: false,
              orderScope: StoreOrderScope.ALL,
            },
          },
        ],
      },
    ]);
    await svc.tell({ ...BASE, orderId: 'order-1' });
    expect(variablesFn(dispatch)(person(ASSOCIATE))).toMatchObject({
      app_url: 'https://associate.test',
    });
  });
});
