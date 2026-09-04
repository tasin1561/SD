import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationPolicyService } from '../../src/modules/notification-audience/services/notification-policy.service';

const ALL = [
  NotificationChannel.EMAIL,
  NotificationChannel.IN_APP,
  NotificationChannel.SMS,
  NotificationChannel.WHATSAPP,
];

describe('NotificationPolicyService — the category decides the channels', () => {
  const svc = new NotificationPolicyService();

  it('CREDENTIAL is email ONLY, whatever the caller asks for', () => {
    // A password reset you can only read once signed in is useless; a
    // login alert shown in-app is seen by whoever is already inside,
    // not by the person being warned; verifying an email in-app is
    // circular; an invite has no account to deliver to yet.
    expect(
      svc.resolveChannels({ category: NotificationCategory.CREDENTIAL, requested: ALL }),
    ).toEqual([NotificationChannel.EMAIL]);
  });

  it('CREDENTIAL cannot be silenced, on any channel, by anyone', () => {
    // Nobody unsubscribes from "your password was changed".
    expect(svc.isMutable(NotificationCategory.CREDENTIAL)).toBe(false);
    expect(
      svc.resolveChannels({
        category: NotificationCategory.CREDENTIAL,
        requested: [NotificationChannel.EMAIL],
        mutedChannels: [NotificationChannel.EMAIL],
      }),
    ).toEqual([NotificationChannel.EMAIL]);
  });

  it('a recipient cannot opt INTO a channel the category forbids', () => {
    // Policy sits above preference. Asking for in-app on a credential
    // message is not a preference to be honoured, it is a category
    // error.
    const out = svc.resolveChannels({
      category: NotificationCategory.CREDENTIAL,
      requested: [NotificationChannel.IN_APP],
    });
    expect(out).toEqual([]);
  });

  it('OPERATIONAL reaches the inbox and the mailbox', () => {
    expect(
      svc.resolveChannels({
        category: NotificationCategory.OPERATIONAL,
        requested: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      }),
    ).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL]);
  });

  it('a mute removes ONE channel without silencing the notification', () => {
    expect(
      svc.resolveChannels({
        category: NotificationCategory.OPERATIONAL,
        requested: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        mutedChannels: [NotificationChannel.EMAIL],
      }),
    ).toEqual([NotificationChannel.IN_APP]);
  });

  it('SMS and WhatsApp are refused everywhere — there is no sender behind them', () => {
    // The enum has carried them for a long time with nothing that
    // sends one. Permitting a channel nothing delivers would make a
    // notification vanish while reporting success.
    for (const category of Object.values(NotificationCategory)) {
      const out = svc.resolveChannels({
        category,
        requested: [NotificationChannel.SMS, NotificationChannel.WHATSAPP],
      });
      expect(out).toEqual([]);
    }
  });

  it('every category is routed — a new one must be decided, not defaulted', () => {
    for (const category of Object.values(NotificationCategory)) {
      expect(() => svc.policyFor(category)).not.toThrow();
      expect(svc.policyFor(category).allowed.length).toBeGreaterThan(0);
    }
  });
});
