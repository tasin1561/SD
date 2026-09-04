import {
  NotificationCategory,
  NotificationChannel,
  NotificationRecipientType,
  NotificationSubjectType,
  NotificationStatus,
  Prisma,
} from '@skydrop/db';
import { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import { NotificationPolicyService } from '../../src/modules/notification-audience/services/notification-policy.service';

/**
 * One notification, an audience, and the channels it is allowed to use.
 *
 * The properties worth pinning here are the ones a later refactor could
 * lose without any test noticing: that one person's failure does not
 * end the fan-out, that the mute lookup is ONE query rather than one
 * per person, and that a duplicate is a no-op rather than a second
 * message. Each is invisible until it is a broadcast to four thousand
 * people, which is exactly when nobody is watching a unit test.
 */
describe('NotificationDispatchService', () => {
  interface Ctx {
    svc: NotificationDispatchService;
    created: Prisma.NotificationLogUncheckedCreateInput[];
    enqueued: unknown[];
    subFindMany: jest.Mock;
    logCreate: jest.Mock;
  }

  function make(people: readonly { id: string; email: string }[]): Ctx {
    const created: Prisma.NotificationLogUncheckedCreateInput[] = [];
    const enqueued: unknown[] = [];
    const logCreate = jest.fn(
      async (args: { data: Prisma.NotificationLogUncheckedCreateInput }) => {
        created.push(args.data);
        return { id: `log-${created.length}` };
      },
    );
    const subFindMany = jest.fn(async () => []);

    const prisma = {
      client: {
        notificationLog: { create: logCreate },
        notificationSubscription: { findMany: subFindMany },
      },
    };
    const audience = {
      resolveMany: jest.fn(async () =>
        people.map((p) => ({
          subjectType: NotificationSubjectType.SELLER_USER,
          recipientType: NotificationRecipientType.SELLER,
          recipientId: p.id,
          email: p.email,
          name: 'Someone',
        })),
      ),
    };
    const emailQueue = {
      enqueue: jest.fn(async (job: unknown) => {
        enqueued.push(job);
      }),
    };

    const svc = new NotificationDispatchService(
      prisma as never,
      audience as never,
      new NotificationPolicyService(),
      emailQueue as never,
    );
    return { svc, created, enqueued, subFindMany, logCreate };
  }

  const base = {
    topic: 'stock.low',
    category: NotificationCategory.INFORMATIONAL,
    title: 'Running low',
    body: 'body',
    triggerEvent: 'test',
  } as const;

  it('an in-app row is SENT on write; email waits for its worker', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });

    const inApp = c.created.find((r) => r.channel === NotificationChannel.IN_APP);
    const email = c.created.find((r) => r.channel === NotificationChannel.EMAIL);
    expect(inApp?.status).toBe(NotificationStatus.SENT);
    expect(inApp?.toInAppUserId).toBe('u1');
    expect(inApp?.toEmail).toBeNull();
    // The in-app row IS the delivery — there is no worker behind it, so
    // leaving it QUEUED would show an unread nobody ever marks sent.
    expect(inApp?.sentAt).toBeInstanceOf(Date);

    expect(email?.status).toBe(NotificationStatus.QUEUED);
    expect(email?.toEmail).toBe('a@x.test');
    expect(email?.toInAppUserId).toBeNull();
    // Store-then-send (NOTIF-2): the row exists before the job does,
    // and the job carries its id so the outcome updates that row.
    expect(c.enqueued).toHaveLength(1);
    expect((c.enqueued[0] as { existingNotificationLogId: string }).existingNotificationLogId).toBe(
      'log-2',
    );
  });

  it('both channels share one groupId — it is ONE notification', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    expect(new Set(c.created.map((r) => r.groupId))).toEqual(new Set([res.groupId]));
    expect(res.delivered).toBe(2);
  });

  it('one recipient failing does not end the fan-out', async () => {
    const c = make([
      { id: 'u1', email: 'a@x.test' },
      { id: 'u2', email: 'b@x.test' },
      { id: 'u3', email: 'c@x.test' },
    ]);
    c.logCreate.mockImplementationOnce(async () => {
      throw new Error('one bad row');
    });

    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP],
      audience: [{ kind: 'ALL_SELLERS' }],
    });
    // The two after the failure still went. Aborting on the first
    // error is the behaviour this rules out: on a broadcast it is one
    // bad address costing everyone else the message.
    expect(res.failures).toBe(1);
    expect(res.delivered).toBe(2);
    expect(res.recipients).toBe(3);
  });

  it('a duplicate is a no-op, not a second message', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    c.logCreate.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
    });

    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
      eventId: 'order_status:evt-1',
    });
    // Deduped, not failed: a re-emit of the same event is the system
    // working, and counting it as a failure would page somebody.
    expect(res.failures).toBe(0);
    expect(res.delivered).toBe(0);
    expect(res.skipped).toBe(1);
    expect(c.enqueued).toHaveLength(0);
  });

  it('mutes are resolved in ONE query for the whole audience', async () => {
    const c = make(Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.test` })));
    await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP],
      audience: [{ kind: 'ALL_SELLERS' }],
    });
    // Fifty people, one lookup. A per-recipient query is correct and
    // unusable: on a real broadcast it is thousands of round trips to
    // decide something one IN clause answers.
    expect(c.subFindMany).toHaveBeenCalledTimes(1);
  });

  it('an immutable category does not even ask about mutes', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    await c.svc.dispatch({
      ...base,
      category: NotificationCategory.CREDENTIAL,
      channels: [NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    expect(c.subFindMany).not.toHaveBeenCalled();
  });

  it('a credential message never writes an in-app row', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    await c.svc.dispatch({
      ...base,
      category: NotificationCategory.CREDENTIAL,
      // Asked for in-app. The policy is above the request.
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    expect(c.created.map((r) => r.channel)).toEqual([NotificationChannel.EMAIL]);
  });

  it('a recipient with no email is skipped on the email channel, not failed', async () => {
    const c = make([{ id: 'u1', email: '   ' }]);
    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    // NOTIF-8's shape: a missing address is a foreseeable reality, not
    // an error to retry.
    expect(res.skipped).toBe(1);
    expect(res.failures).toBe(0);
    expect(c.created).toHaveLength(0);
  });

  it('an empty audience writes nothing and reports nothing', async () => {
    const c = make([]);
    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP],
      audience: [{ kind: 'ALL_SELLERS' }],
    });
    expect(res).toMatchObject({ recipients: 0, delivered: 0, failures: 0 });
    expect(c.created).toHaveLength(0);
    expect(c.subFindMany).not.toHaveBeenCalled();
  });

  it('a mute naming no channel silences the whole topic', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    c.subFindMany.mockImplementationOnce(async () => [
      {
        subjectType: NotificationSubjectType.SELLER_USER,
        subjectId: 'u1',
        mutedChannels: [],
      },
    ]);
    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    expect(res.delivered).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it('a mute naming one channel leaves the other alone', async () => {
    const c = make([{ id: 'u1', email: 'a@x.test' }]);
    c.subFindMany.mockImplementationOnce(async () => [
      {
        subjectType: NotificationSubjectType.SELLER_USER,
        subjectId: 'u1',
        mutedChannels: [NotificationChannel.EMAIL],
      },
    ]);
    const res = await c.svc.dispatch({
      ...base,
      channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      audience: [{ kind: 'SELLER_USER', sellerUserId: 'u1' }],
    });
    expect(res.delivered).toBe(1);
    expect(c.created.map((r) => r.channel)).toEqual([NotificationChannel.IN_APP]);
  });
});
