import { ConflictException } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, NotificationSubjectType } from '@skydrop/db';
import { NotificationBroadcastService } from '../../src/modules/notification-audience/services/notification-broadcast.service';
import { NotificationPolicyService } from '../../src/modules/notification-audience/services/notification-policy.service';

/**
 * The one notification that cannot be recalled.
 *
 * What is pinned here is the ORDER of the refusals and the fact that
 * each of them happens before anything is written. A guard that refuses
 * after the row exists leaves a broadcast recorded as having been sent
 * to nobody, which is worse than either outcome on its own.
 */
describe('NotificationBroadcastService', () => {
  function make(count: number) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const audits: Record<string, unknown>[] = [];
    const people = Array.from({ length: count }, (_, i) => ({
      subjectType: NotificationSubjectType.SELLER_USER,
      recipientId: `u${i}`,
      email: `u${i}@x.test`,
      name: `User ${i}`,
    }));

    const prisma = {
      client: {
        notificationBroadcast: {
          create: jest.fn(async (a: { data: Record<string, unknown> }) => {
            created.push(a.data);
            return { id: 'bc-1' };
          }),
          update: jest.fn(async (a: { data: Record<string, unknown> }) => {
            updated.push(a.data);
            return {};
          }),
        },
      },
    };
    const audience = { resolveMany: jest.fn(async () => people) };
    const dispatch = {
      dispatch: jest.fn(async () => ({
        groupId: 'g',
        recipients: count,
        delivered: count,
        skipped: 0,
        failures: 0,
      })),
    };
    const audit = {
      log: jest.fn(async (row: Record<string, unknown>) => {
        audits.push(row);
      }),
    };

    const svc = new NotificationBroadcastService(
      prisma as never,
      audience as never,
      dispatch as never,
      new NotificationPolicyService(),
      audit as never,
    );
    return { svc, created, updated, audits, prisma, dispatch, audience };
  }

  const base = {
    staffId: 'staff-1',
    title: 'Scheduled maintenance',
    body: 'We will be down on Sunday.',
    category: NotificationCategory.ANNOUNCEMENT,
    channels: [NotificationChannel.IN_APP],
    audience: [{ kind: 'ALL_SELLERS' as const }],
  };

  it('preview counts and samples, and writes nothing', async () => {
    const c = make(4312);
    const out = await c.svc.preview(
      base.audience,
      NotificationCategory.ANNOUNCEMENT,
      base.channels,
    );
    // "Send to all sellers" means nothing; a number and five names is
    // something a person can actually check before committing.
    expect(out.recipientCount).toBe(4312);
    expect(out.sample).toHaveLength(5);
    expect(c.prisma.client.notificationBroadcast.create).not.toHaveBeenCalled();
  });

  it('refuses a CREDENTIAL broadcast before touching anything', async () => {
    const c = make(3);
    await expect(
      c.svc.send({ ...base, category: NotificationCategory.CREDENTIAL }),
    ).rejects.toBeInstanceOf(ConflictException);
    // A broadcast of a message about one person's own account is a
    // contradiction, so it is refused as a category rather than
    // filtered down to nothing at delivery time.
    expect(c.prisma.client.notificationBroadcast.create).not.toHaveBeenCalled();
    expect(c.audience.resolveMany).not.toHaveBeenCalled();
  });

  it('refuses when the population moved since the preview', async () => {
    const c = make(3);
    await expect(c.svc.send({ ...base, expectedRecipientCount: 2 })).rejects.toMatchObject({
      response: { code: 'AUDIENCE_CHANGED' },
    });
    expect(c.prisma.client.notificationBroadcast.create).not.toHaveBeenCalled();
  });

  it('an exact match sends', async () => {
    const c = make(3);
    const out = await c.svc.send({ ...base, expectedRecipientCount: 3 });
    expect(out.recipientCount).toBe(3);
    expect(out.delivered).toBe(3);
  });

  it('refuses an empty audience rather than recording a send to nobody', async () => {
    const c = make(0);
    await expect(c.svc.send(base)).rejects.toMatchObject({
      response: { code: 'EMPTY_AUDIENCE' },
    });
    expect(c.prisma.client.notificationBroadcast.create).not.toHaveBeenCalled();
  });

  it('refuses when the category permits none of the chosen channels', async () => {
    const c = make(3);
    await expect(
      c.svc.send({ ...base, channels: [NotificationChannel.SMS, NotificationChannel.WHATSAPP] }),
    ).rejects.toMatchObject({ response: { code: 'NO_PERMITTED_CHANNELS' } });
  });

  it('stores the audience AS CHOSEN, not the people it resolved to', async () => {
    const c = make(3);
    await c.svc.send(base);
    // The population moves. "Who did this go to" has to still answer a
    // month later, and it answers with the rule, plus the count at the
    // moment it was applied.
    expect(c.created[0]?.audience).toEqual([{ kind: 'ALL_SELLERS' }]);
    expect(c.created[0]?.recipientCount).toBe(3);
  });

  it('the dispatch is keyed on the broadcast, so a retry cannot double-send', async () => {
    const c = make(3);
    await c.svc.send(base);
    expect(c.dispatch.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'broadcast:bc-1', broadcastId: 'bc-1' }),
    );
  });

  it('the row is SENDING before delivery and SENT after', async () => {
    const c = make(3);
    await c.svc.send(base);
    // Visible-vs-silent: a crash mid-send leaves a row saying SENDING,
    // which is a true and recoverable statement. Writing SENT first
    // would claim an outcome that had not happened.
    expect(c.created[0]?.status).toBe('SENDING');
    expect(c.updated[0]?.status).toBe('SENT');
    expect(c.updated[0]?.sentCount).toBe(3);
  });

  it('a send where everybody failed is recorded FAILED, not SENT', async () => {
    const c = make(3);
    c.dispatch.dispatch.mockImplementationOnce(async () => ({
      groupId: 'g',
      recipients: 3,
      delivered: 0,
      skipped: 0,
      failures: 3,
    }));
    await c.svc.send(base);
    expect(c.updated[0]?.status).toBe('FAILED');
    expect(c.updated[0]?.failedCount).toBe(3);
  });

  it('a partial failure is still SENT — most people got it', async () => {
    const c = make(3);
    c.dispatch.dispatch.mockImplementationOnce(async () => ({
      groupId: 'g',
      recipients: 3,
      delivered: 2,
      skipped: 0,
      failures: 1,
    }));
    await c.svc.send(base);
    expect(c.updated[0]?.status).toBe('SENT');
    expect(c.updated[0]?.failedCount).toBe(1);
  });

  it('audits HIGH with the audience, the count and who sent it', async () => {
    const c = make(3);
    await c.svc.send(base);
    expect(c.audits[0]).toMatchObject({
      action: 'notification.broadcast_sent',
      severity: 'HIGH',
      actorId: 'staff-1',
      metadata: expect.objectContaining({ recipientCount: 3, delivered: 3 }),
    });
  });
});
