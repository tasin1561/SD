import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import {
  IMMUTABLE_TOPICS,
  NotificationPolicyService,
} from '../../src/modules/notification-audience/services/notification-policy.service';
import { NotificationSubscriptionService } from '../../src/modules/notification-audience/services/notification-subscription.service';
import { SELLER_TOPICS } from '../../src/modules/notification-audience/services/notification-topic-catalog.service';
import { STORE_REQUEST_REMINDER_TOPIC } from '../../src/modules/store-order-request/services/store-request-notifier.service';

/**
 * THE 24-HOUR REMINDER CANNOT BE SILENCED (owner, 2026-09-18).
 *
 * Narrow on purpose: a per-topic exception rather than a new category.
 * A category decides channels as well as mutability, would have to be
 * routed in `categoryForTemplate`, and would then be available to attach
 * to anything — which is how "unmutable" spreads from one message to a
 * dozen over a year. It would also be a lie about this message: the
 * reminder IS operational in every respect except that it is the last
 * thing standing between a request and it closing unanswered.
 */
describe('IMMUTABLE_TOPICS (2026-09-18)', () => {
  const policy = new NotificationPolicyService();

  it('names exactly the 24-hour reminder, with its reason', () => {
    // If this list grows, somebody has decided a second thing may not be
    // silenced. That is a decision, and it should be made here.
    expect([...IMMUTABLE_TOPICS.keys()]).toEqual([STORE_REQUEST_REMINDER_TOPIC]);
    expect(IMMUTABLE_TOPICS.get(STORE_REQUEST_REMINDER_TOPIC)).toContain('waiting a day');
  });

  it('the other three store topics stay mutable', () => {
    for (const topic of [
      'seller.store_request_waiting',
      'seller.store_action_waiting',
      'seller.store_address_change_waiting',
    ]) {
      expect(policy.isTopicMutable(topic)).toBe(true);
    }
  });

  it('the reminder is still in the catalogue, and says it cannot be switched off', () => {
    // Removing it from the catalogue would be the wrong fix: a person
    // reading their settings should see it listed and be told why the
    // switch is not there, not find it silently absent.
    const entry = SELLER_TOPICS.find((t) => t.topic === STORE_REQUEST_REMINDER_TOPIC);
    expect(entry).toBeDefined();
    expect(entry?.description).toContain('cannot be switched off');
  });

  describe('the WRITE half — a mute cannot be recorded', () => {
    function svc() {
      const prisma = {
        client: {
          notificationTemplate: { findFirst: jest.fn(async () => null) },
          notificationSubscription: { upsert: jest.fn(async () => ({})) },
        },
      };
      return {
        prisma,
        s: new NotificationSubscriptionService(prisma as never, policy),
      };
    }

    it('refuses to store one, before touching the table', async () => {
      const { prisma, s } = svc();
      await expect(
        s.set({
          subjectType: 'SELLER_USER' as never,
          subjectId: 'u1',
          topic: STORE_REQUEST_REMINDER_TOPIC,
          mode: 'MUTED' as never,
        }),
      ).rejects.toMatchObject({ response: { code: 'NOTIFICATION_NOT_MUTABLE' } });
      expect(prisma.client.notificationSubscription.upsert).not.toHaveBeenCalled();
      // Named FIRST: it never reaches the template lookup, so a topic
      // with no template row cannot slip through as INFORMATIONAL.
      expect(prisma.client.notificationTemplate.findFirst).not.toHaveBeenCalled();
    });

    it('SUBSCRIBING to it is still fine — only silencing is refused', async () => {
      const { s } = svc();
      await expect(
        s.set({
          subjectType: 'SELLER_USER' as never,
          subjectId: 'u1',
          topic: STORE_REQUEST_REMINDER_TOPIC,
          mode: 'SUBSCRIBED' as never,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('the READ half — a mute already stored is ignored', () => {
    it('resolveChannels keeps the channel even when the topic is muted', () => {
      // A rule enforced only at the write is not a rule; it is a rule
      // with a back door for every row already in the table.
      expect(
        policy.resolveChannels({
          category: NotificationCategory.OPERATIONAL,
          topic: STORE_REQUEST_REMINDER_TOPIC,
          requested: [NotificationChannel.IN_APP],
          mutedChannels: [NotificationChannel.IN_APP],
        }),
      ).toEqual([NotificationChannel.IN_APP]);
    });

    it('and still honours a mute on any OTHER topic', () => {
      expect(
        policy.resolveChannels({
          category: NotificationCategory.OPERATIONAL,
          topic: 'seller.store_request_waiting',
          requested: [NotificationChannel.IN_APP],
          mutedChannels: [NotificationChannel.IN_APP],
        }),
      ).toEqual([]);
    });
  });
});
