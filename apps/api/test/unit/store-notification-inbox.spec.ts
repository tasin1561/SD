import { ConflictException } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationSubjectType,
  NotificationSubscriptionMode,
  StoreNotificationCategory,
} from '@skydrop/db';
import { NotificationFeedService } from '../../src/modules/notification-audience/services/notification-feed.service';
import { NotificationPolicyService } from '../../src/modules/notification-audience/services/notification-policy.service';
import { NotificationSubscriptionService } from '../../src/modules/notification-audience/services/notification-subscription.service';
import {
  StoreCategoryNotMutableError,
  StoreNotificationPreferenceService,
} from '../../src/modules/notification-audience/services/store-notification-preference.service';
import {
  NotificationTopicCatalogService,
  STORE_TOPICS,
} from '../../src/modules/notification-audience/services/notification-topic-catalog.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * The reseller store's inbox (2026-09-19) — the three properties that
 * would be silently wrong if nothing pinned them.
 *
 *   1. A LOCKED topic is refused at the write AND ignored at the read.
 *      A rule enforced only at the write is a rule with a back door for
 *      every row already in the table.
 *   2. A store user reads THEIR OWN store's rows and nobody else's, and
 *      the scoping is in the WHERE clause rather than a comparison after
 *      the fetch.
 *   3. Dismissing hides a row from the list AND from the count. Hidden
 *      in the list but still counted leaves a badge pointing at nothing,
 *      which is how people stop trusting the number.
 */

const A_STORE = '11111111-1111-1111-1111-111111111111';
const A_PERSON = '22222222-2222-2222-2222-222222222222';
const ANOTHER_STORE = '33333333-3333-3333-3333-333333333333';

/** A locked topic and a mutable one, read from the catalogue itself. */
const LOCKED = 'store.request_approved';
const MUTABLE = 'store.customer_changed_by_seller';

describe('a reseller store’s inbox', () => {
  const policy = new NotificationPolicyService();
  const catalog = new NotificationTopicCatalogService();

  it('the two topics this suite leans on are what the catalogue says they are', () => {
    // Guards against the suite quietly testing nothing if somebody
    // renames a topic or changes which are locked.
    const view = catalog.forSubject(NotificationSubjectType.STORE_USER);
    expect(view.find((t) => t.topic === LOCKED)?.mutable).toBe(false);
    expect(view.find((t) => t.topic === MUTABLE)?.mutable).toBe(true);
  });

  describe('an unsilenceable topic', () => {
    it('is REFUSED when somebody tries to record a mute', async () => {
      const prisma = {
        client: {
          notificationSubscription: {
            upsert: jest.fn(),
          },
          notificationTemplate: { findFirst: jest.fn() },
        },
      } as unknown as PrismaService;
      const subs = new NotificationSubscriptionService(prisma, policy);

      await expect(
        subs.set({
          subjectType: NotificationSubjectType.STORE_USER,
          subjectId: A_PERSON,
          topic: LOCKED,
          mode: NotificationSubscriptionMode.MUTED,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Nothing written — the refusal is BEFORE the row, not after it.
      expect(prisma.client.notificationSubscription.upsert).not.toHaveBeenCalled();
    });

    it('is still allowed to be SUBSCRIBED to (only silencing is refused)', async () => {
      const upsert = jest.fn().mockResolvedValue({
        topic: LOCKED,
        mode: NotificationSubscriptionMode.SUBSCRIBED,
        mutedChannels: [],
      });
      const prisma = {
        client: { notificationSubscription: { upsert } },
      } as unknown as PrismaService;
      const subs = new NotificationSubscriptionService(prisma, policy);

      await subs.set({
        subjectType: NotificationSubjectType.STORE_USER,
        subjectId: A_PERSON,
        topic: LOCKED,
        mode: NotificationSubscriptionMode.SUBSCRIBED,
      });
      expect(upsert).toHaveBeenCalled();
    });

    it('IGNORES a mute already stored against it', () => {
      // The read half. A row recorded before the topic became
      // unsilenceable — or by any future path — must not survive as a
      // back door, so the channel resolution never even asks.
      const channels = policy.resolveChannels({
        category: NotificationCategory.OPERATIONAL,
        topic: LOCKED,
        requested: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        mutedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      });
      expect([...channels].sort()).toEqual(
        [NotificationChannel.EMAIL, NotificationChannel.IN_APP].sort(),
      );
    });

    it('ignores the STORE-WIDE switch too, not only the person’s', async () => {
      // The store's own layer would otherwise be a WORSE back door than
      // a personal mute: one admin could take the message away from
      // everybody at the store.
      const findUnique = jest.fn().mockResolvedValue({ emailEnabled: false, inAppEnabled: false });
      const prisma = {
        client: { storeNotificationPreference: { findUnique } },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);

      expect(await prefs.decide({ storeId: A_STORE, topic: LOCKED })).toEqual({
        email: true,
        inApp: true,
      });
      // It did not even look: the answer cannot change the outcome.
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('refuses a store-wide switch for a category holding only locked topics', async () => {
      const prisma = {
        client: { storeNotificationPreference: { upsert: jest.fn() } },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);

      // MONEY holds nothing today, so there is nothing to switch off —
      // and the refusal says which of the two reasons it is.
      await expect(
        prefs.set({
          storeId: A_STORE,
          category: StoreNotificationCategory.MONEY,
          emailEnabled: false,
          inAppEnabled: false,
          byStoreUserId: A_PERSON,
        }),
      ).rejects.toBeInstanceOf(StoreCategoryNotMutableError);
      expect(prisma.client.storeNotificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  describe('the STORE’s own layer', () => {
    it('honours the switch for a topic that CAN be silenced', async () => {
      const prisma = {
        client: {
          storeNotificationPreference: {
            findUnique: jest.fn().mockResolvedValue({ emailEnabled: false, inAppEnabled: true }),
          },
        },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);

      expect(await prefs.decide({ storeId: A_STORE, topic: MUTABLE })).toEqual({
        email: false,
        inApp: true,
      });
    });

    it('an ABSENT row means send', async () => {
      const prisma = {
        client: { storeNotificationPreference: { findUnique: jest.fn().mockResolvedValue(null) } },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);
      expect(await prefs.decide({ storeId: A_STORE, topic: MUTABLE })).toEqual({
        email: true,
        inApp: true,
      });
    });

    it('FAILS OPEN when the rows cannot be read', async () => {
      // Sending one message somebody switched off is a nuisance;
      // silently not telling a store its dispute was settled is money.
      const prisma = {
        client: {
          storeNotificationPreference: {
            findUnique: jest.fn().mockRejectedValue(new Error('database is having a moment')),
          },
        },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);
      expect(await prefs.decide({ storeId: A_STORE, topic: MUTABLE })).toEqual({
        email: true,
        inApp: true,
      });
    });

    it('never gates a CREDENTIAL message', async () => {
      const findUnique = jest.fn();
      const prisma = {
        client: { storeNotificationPreference: { findUnique } },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);
      expect(
        await prefs.decide({
          storeId: A_STORE,
          topic: MUTABLE,
          notificationCategory: NotificationCategory.CREDENTIAL,
        }),
      ).toEqual({ email: true, inApp: true });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('lists every category, saying which hold nothing choosable', async () => {
      const prisma = {
        client: { storeNotificationPreference: { findMany: jest.fn().mockResolvedValue([]) } },
      } as unknown as PrismaService;
      const prefs = new StoreNotificationPreferenceService(prisma, catalog);

      const rows = await prefs.list(A_STORE);
      expect(rows.map((r) => r.category)).toEqual([
        StoreNotificationCategory.ORDER_UPDATES,
        StoreNotificationCategory.MONEY,
        StoreNotificationCategory.SUPPORT,
        StoreNotificationCategory.TERMS,
        StoreNotificationCategory.ANNOUNCEMENTS,
      ]);
      // No rows stored ⇒ everything defaults ON and nothing claims to
      // have been set.
      expect(rows.every((r) => r.emailEnabled && r.inAppEnabled && !r.set)).toBe(true);
      // ORDER_UPDATES holds the one mutable topic, so its switches are
      // real; MONEY holds nothing at all, so they are not.
      expect(
        rows.find((r) => r.category === StoreNotificationCategory.ORDER_UPDATES)?.mutable,
      ).toBe(true);
      expect(rows.find((r) => r.category === StoreNotificationCategory.MONEY)?.mutable).toBe(false);
      // Every topic in the catalogue appears under exactly one category.
      const listed = rows.flatMap((r) => r.topics);
      expect([...listed].sort()).toEqual(STORE_TOPICS.map((t) => t.topic).sort());
    });
  });

  describe('one store never reads another’s rows', () => {
    function feedWith(): {
      feed: NotificationFeedService;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
    } {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findFirst = jest.fn().mockResolvedValue(null);
      const prisma = {
        client: { notificationLog: { findMany, count, updateMany, findFirst } },
      } as unknown as PrismaService;
      return { feed: new NotificationFeedService(prisma), findMany, count, updateMany, findFirst };
    }

    it('scopes the list on BOTH the person and their store, in the WHERE', async () => {
      const { feed, findMany, count } = feedWith();
      await feed.list({ userId: A_PERSON, storeId: A_STORE });

      const where = findMany.mock.calls[0]?.[0]?.where;
      expect(where).toMatchObject({
        toInAppUserId: A_PERSON,
        toStoreId: A_STORE,
        channel: NotificationChannel.IN_APP,
        dismissedAt: null,
      });
      // The count is scoped identically, or the badge and the list
      // disagree.
      expect(count.mock.calls[0]?.[0]?.where).toMatchObject({
        toInAppUserId: A_PERSON,
        toStoreId: A_STORE,
      });
    });

    it('a seller or staff caller filters toStoreId IS NULL — not "no filter"', async () => {
      const { feed, findMany } = feedWith();
      await feed.list({ userId: A_PERSON, storeId: null });
      // `null` is a real predicate. Were it absent, a store's rows would
      // be reachable by anybody whose user id happened to match.
      expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ toStoreId: null });
    });

    it('marking another store’s row read finds nothing and 404s', async () => {
      const { feed, updateMany, findFirst } = feedWith();
      // Both stubs return "nothing" — which is what the database does
      // when the WHERE excludes the row.
      await expect(
        feed.markRead({ userId: A_PERSON, storeId: ANOTHER_STORE }, 'some-row-id'),
      ).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_FOUND' } });

      expect(updateMany.mock.calls[0]?.[0]?.where).toMatchObject({
        id: 'some-row-id',
        toInAppUserId: A_PERSON,
        toStoreId: ANOTHER_STORE,
      });
      // The "already read?" re-read is scoped too — a read-then-compare
      // there would be one missing check away from leaking the row.
      expect(findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
        toInAppUserId: A_PERSON,
        toStoreId: ANOTHER_STORE,
      });
    });

    it('dismissing and un-reading are scoped the same way', async () => {
      const { feed, updateMany } = feedWith();
      await expect(
        feed.dismiss({ userId: A_PERSON, storeId: A_STORE }, 'row'),
      ).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_FOUND' } });
      await expect(
        feed.markUnread({ userId: A_PERSON, storeId: A_STORE }, 'row'),
      ).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_FOUND' } });
      for (const call of updateMany.mock.calls) {
        expect(call[0].where).toMatchObject({ toInAppUserId: A_PERSON, toStoreId: A_STORE });
      }
    });
  });

  describe('dismiss hides a row from the list AND the count', () => {
    it('both reads filter dismissedAt: null', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = {
        client: { notificationLog: { findMany, count } },
      } as unknown as PrismaService;
      const feed = new NotificationFeedService(prisma);

      await feed.list({ userId: A_PERSON, storeId: A_STORE });
      await feed.unreadCount({ userId: A_PERSON, storeId: A_STORE });

      // Hidden in the list but still counted would leave a badge
      // pointing at nothing, which is how people stop trusting it.
      expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ dismissedAt: null });
      expect(count.mock.calls[0]?.[0]?.where).toMatchObject({ dismissedAt: null });
      expect(count.mock.calls[1]?.[0]?.where).toMatchObject({ dismissedAt: null, readAt: null });
    });

    it('is an UPDATE, never a DELETE — the dedup ledger survives', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        client: { notificationLog: { updateMany } },
      } as unknown as PrismaService;
      const feed = new NotificationFeedService(prisma);

      const res = await feed.dismiss({ userId: A_PERSON, storeId: A_STORE }, 'row');
      expect(res.dismissedAt).toBeInstanceOf(Date);
      // NOTIF-21: `notification_logs` is the ledger the dedup gate
      // reads. A literal delete would let a re-emit of the same event
      // send again, invisibly.
      expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({ dismissedAt: expect.any(Date) });
      expect((prisma.client.notificationLog as unknown as Record<string, unknown>).delete).toBe(
        undefined,
      );
      expect((prisma.client.notificationLog as unknown as Record<string, unknown>).deleteMany).toBe(
        undefined,
      );
    });

    it('dismissing an already-dismissed row is not an error', async () => {
      const when = new Date('2026-09-19T10:00:00Z');
      const prisma = {
        client: {
          notificationLog: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findFirst: jest.fn().mockResolvedValue({ dismissedAt: when }),
          },
        },
      } as unknown as PrismaService;
      const feed = new NotificationFeedService(prisma);
      // Two tabs and a slow network are not a failure.
      expect(await feed.dismiss({ userId: A_PERSON, storeId: A_STORE }, 'row')).toEqual({
        dismissedAt: when,
      });
    });
  });
});
