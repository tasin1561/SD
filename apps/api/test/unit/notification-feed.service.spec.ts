import { NotFoundException } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationSubjectType,
  NotificationSubscriptionMode,
} from '@skydrop/db';
import { NotificationFeedService } from '../../src/modules/notification-audience/services/notification-feed.service';
import { NotificationSubscriptionService } from '../../src/modules/notification-audience/services/notification-subscription.service';
import { NotificationPolicyService } from '../../src/modules/notification-audience/services/notification-policy.service';

/**
 * An inbox is only an inbox if it is scoped.
 *
 * The single property worth a structural test is that the caller's own
 * id is in the WHERE clause of every read and every write — not fetched
 * first and compared afterwards. A read-then-write here is one missing
 * comparison away from letting anybody mark, and by implication read,
 * somebody else's notifications; and the comparison is exactly the kind
 * of line a refactor deletes because "the id is already checked above".
 */
describe('NotificationFeedService', () => {
  function make() {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    // Typed rather than inferred: an inferred mock whose calls are all
    // rejections narrows to `never`, and reading `.mock.calls[0][0]`
    // off it stops compiling.
    // Typed rather than inferred: an inferred mock whose overrides are
    // all rejections narrows its args to `never`, and reading
    // `.mock.calls[0][0]` off it stops compiling.
    const updateMany: jest.Mock<
      Promise<{ count: number }>,
      [{ where: Record<string, unknown> }]
    > = jest.fn(async (_args: { where: Record<string, unknown> }) => ({ count: 1 }));
    const findFirst = jest.fn(async () => null);
    const prisma = {
      client: { notificationLog: { findMany, count, updateMany, findFirst } },
    };
    return {
      svc: new NotificationFeedService(prisma as never),
      findMany,
      count,
      updateMany,
      findFirst,
    };
  }

  it('the list is filtered by the caller’s id and the IN_APP channel', async () => {
    const c = make();
    await c.svc.list('me');
    expect(c.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // `dismissedAt: null` is part of the filter, not incidental —
        // a cleared notification has to be gone from the list.
        where: {
          toInAppUserId: 'me',
          channel: NotificationChannel.IN_APP,
          dismissedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('paging fetches one extra row to decide whether there is a next page', async () => {
    const c = make();
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `n${i}`,
      subject: 't',
      body: 'b',
      templateCode: 'x',
      createdAt: new Date(),
      readAt: null,
      orderId: null,
    }));
    c.findMany.mockImplementationOnce(async () => rows as never);

    const page = await c.svc.list('me');
    // Twenty shown, the twenty-first only ever used as the answer to
    // "is there more" — never rendered, so the page size stays honest.
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBe('n19');
  });

  it('the last page reports no cursor', async () => {
    const c = make();
    c.findMany.mockImplementationOnce(
      async () =>
        [
          {
            id: 'n1',
            subject: 't',
            body: 'b',
            templateCode: 'x',
            createdAt: new Date(),
            readAt: null,
            orderId: null,
          },
        ] as never,
    );
    const page = await c.svc.list('me');
    expect(page.nextCursor).toBeNull();
  });

  it('a cursor skips the row it names rather than repeating it', async () => {
    const c = make();
    await c.svc.list('me', 'n19');
    expect(c.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'n19' }, skip: 1 }),
    );
  });

  it('marking read guards on the caller’s id IN the write', async () => {
    const c = make();
    await c.svc.markRead('me', 'n1');
    const where = c.updateMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ id: 'n1', toInAppUserId: 'me', readAt: null });
  });

  it('somebody else’s notification is a 404, not a silent success', async () => {
    const c = make();
    c.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(c.svc.markRead('me', 'theirs')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marking an already-read one again is idempotent, not an error', async () => {
    const c = make();
    const readAt = new Date('2026-09-01T00:00:00Z');
    c.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    c.findFirst.mockImplementationOnce(async () => ({ readAt }) as never);
    // Two tabs, two clicks. The second is not a failure.
    await expect(c.svc.markRead('me', 'n1')).resolves.toEqual({ readAt });
  });

  it('mark-all-read touches only the caller’s unread rows', async () => {
    const c = make();
    await c.svc.markAllRead('me');
    const where = c.updateMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      toInAppUserId: 'me',
      channel: NotificationChannel.IN_APP,
      readAt: null,
    });
  });
});

describe('NotificationFeedService — unread and clearing', () => {
  function make(existing: Record<string, unknown> | null = null) {
    const updateMany: jest.Mock<
      Promise<{ count: number }>,
      [{ where: Record<string, unknown>; data: Record<string, unknown> }]
    > = jest.fn(async (_a) => ({ count: 1 }));
    const findFirst = jest.fn(async () => existing as never);
    const prisma = {
      client: {
        notificationLog: {
          updateMany,
          findFirst,
          findMany: jest.fn(async () => []),
          count: jest.fn(async () => 0),
        },
      },
    };
    return { svc: new NotificationFeedService(prisma as never), updateMany, findFirst };
  }

  it('marking unread clears readAt, scoped to the caller', async () => {
    const c = make();
    await c.svc.markUnread('me', 'n1');
    expect(c.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'n1', toInAppUserId: 'me', dismissedAt: null },
      data: { readAt: null },
    });
  });

  it('somebody else’s notification cannot be un-read', async () => {
    const c = make();
    c.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(c.svc.markUnread('me', 'theirs')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE dismisses — it never removes the row', async () => {
    // notification_logs is the ledger the NOTIF-2 dedup gate reads.
    // Deleting a row would let a re-emit of the same event send again,
    // so "delete" on screen has to mean "hide it from this person".
    const c = make();
    await c.svc.dismiss('me', 'n1');
    const call = c.updateMany.mock.calls[0]?.[0];
    expect(call?.data).toMatchObject({ dismissedAt: expect.any(Date) });
    expect(call?.where).toMatchObject({ id: 'n1', toInAppUserId: 'me' });
  });

  it('dismissing twice is idempotent, not an error', async () => {
    const dismissedAt = new Date('2026-09-05T00:00:00Z');
    const c = make({ dismissedAt });
    c.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    // Two tabs and a slow network are not a failure.
    await expect(c.svc.dismiss('me', 'n1')).resolves.toEqual({ dismissedAt });
  });

  it('dismissing something that is not yours is a 404', async () => {
    const c = make(null);
    c.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    await expect(c.svc.dismiss('me', 'theirs')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clear-all touches only this person’s undismissed in-app rows', async () => {
    const c = make();
    await c.svc.dismissAll('me');
    expect(c.updateMany.mock.calls[0]?.[0]?.where).toMatchObject({
      toInAppUserId: 'me',
      channel: NotificationChannel.IN_APP,
      dismissedAt: null,
    });
  });

  it('a dismissed row is gone from the list AND from the unread count', async () => {
    // Hidden in one place and counted in the other would leave a badge
    // pointing at nothing — the shape that makes people stop trusting
    // the number.
    const c = make();
    await c.svc.list('me');
    await c.svc.unreadCount('me');
    const prisma = (
      c.svc as unknown as {
        prisma: {
          client: {
            notificationLog: {
              findMany: jest.Mock;
              count: jest.Mock;
            };
          };
        };
      }
    ).prisma;
    expect(prisma.client.notificationLog.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      dismissedAt: null,
    });
    expect(prisma.client.notificationLog.count.mock.calls[0]?.[0]?.where).toMatchObject({
      dismissedAt: null,
    });
  });
});

describe('NotificationSubscriptionService', () => {
  function make(templateCategory: string | null) {
    const upsert = jest.fn(async (a: { create: Record<string, unknown> }) => ({
      topic: a.create.topic,
      mode: a.create.mode,
      mutedChannels: a.create.mutedChannels ?? [],
    }));
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const findMany = jest.fn(async () => []);
    const templateFindFirst = jest.fn(async () =>
      templateCategory === null ? null : ({ category: templateCategory } as never),
    );
    const prisma = {
      client: {
        notificationSubscription: { upsert, deleteMany, findMany },
        notificationTemplate: { findFirst: templateFindFirst },
      },
    };
    return {
      svc: new NotificationSubscriptionService(prisma as never, new NotificationPolicyService()),
      upsert,
      deleteMany,
      findMany,
    };
  }

  const subject = {
    subjectType: NotificationSubjectType.SELLER_USER,
    subjectId: 'u1',
  } as const;

  it('an ordinary topic can be silenced', async () => {
    const c = make('OPERATIONAL');
    const out = await c.svc.set({
      ...subject,
      topic: 'stock.low',
      mode: NotificationSubscriptionMode.MUTED,
    });
    expect(out.mode).toBe(NotificationSubscriptionMode.MUTED);
    expect(c.upsert).toHaveBeenCalled();
  });

  it('a credential topic REFUSES to be silenced', async () => {
    const c = make('CREDENTIAL');
    // Silencing a password reset locks somebody out of their own
    // account with no way back in, so it is refused rather than
    // honoured and quietly regretted.
    await expect(
      c.svc.set({
        ...subject,
        topic: 'seller.password_reset.email',
        mode: NotificationSubscriptionMode.MUTED,
      }),
    ).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_MUTABLE' } });
    expect(c.upsert).not.toHaveBeenCalled();
  });

  it('an unknown topic is treated as mutable', async () => {
    // A credential message always has a template behind it, so a topic
    // with no template cannot be one. Refusing here would make every
    // unrecognised topic unsilenceable.
    const c = make(null);
    await expect(
      c.svc.set({ ...subject, topic: 'made.up', mode: NotificationSubscriptionMode.MUTED }),
    ).resolves.toBeDefined();
  });

  it('SUBSCRIBING is never refused — only silencing needs the guard', async () => {
    const c = make('CREDENTIAL');
    await expect(
      c.svc.set({
        ...subject,
        topic: 'seller.password_reset.email',
        mode: NotificationSubscriptionMode.SUBSCRIBED,
      }),
    ).resolves.toBeDefined();
  });

  it('clearing scopes the delete to the caller and the one topic', async () => {
    const c = make('OPERATIONAL');
    await c.svc.clear(NotificationSubjectType.SELLER_USER, 'u1', 'stock.low');
    expect(c.deleteMany).toHaveBeenCalledWith({
      where: {
        subjectType: NotificationSubjectType.SELLER_USER,
        subjectId: 'u1',
        topic: 'stock.low',
      },
    });
  });
});
