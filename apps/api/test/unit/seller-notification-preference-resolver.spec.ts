import { NotificationCategory, SellerNotificationCategory } from '@skydrop/db';
import {
  SellerNotificationPreferenceResolver,
  quietHoursDelayMs,
} from '../../src/modules/seller-notification-preference/services/seller-notification-preference-resolver.service';

/**
 * A setting a seller can change has to change something.
 *
 * These rows had a screen and, for months, exactly one reader — their
 * own CRUD service. A seller could switch a category off, watch it
 * save, and keep receiving every email. This is the consultation, and
 * what is pinned here is mostly the ways it must NOT refuse: a missing
 * row, an unreadable table and a credential message all have to send.
 */
describe('SellerNotificationPreferenceResolver', () => {
  function make(row: Record<string, unknown> | null, throws = false) {
    const findFirst = jest.fn(async () => {
      if (throws) throw new Error('database is unhappy');
      return row as never;
    });
    const prisma = { client: { sellerNotificationPreference: { findFirst } } };
    return {
      svc: new SellerNotificationPreferenceResolver(prisma as never),
      findFirst,
    };
  }

  const base = {
    sellerId: 'sel-1',
    category: SellerNotificationCategory.SHIPMENT_UPDATES,
  };

  it('honours a category switched off', async () => {
    const { svc } = make({
      emailEnabled: false,
      inAppEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'Asia/Dhaka',
    });
    expect(await svc.resolve(base)).toEqual({ email: false, inApp: false, emailDelayMs: 0 });
  });

  it('the two channels are independent — email off does not silence the inbox', async () => {
    const { svc } = make({
      emailEnabled: false,
      inAppEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'Asia/Dhaka',
    });
    const out = await svc.resolve(base);
    expect(out.email).toBe(false);
    expect(out.inApp).toBe(true);
  });

  it('a missing row SENDS — silence is not a refusal', async () => {
    // A company registered before a category existed has said nothing
    // about it. Reading that as "no" switches off a notification
    // nobody chose to switch off.
    const { svc } = make(null);
    expect(await svc.resolve(base)).toEqual({ email: true, inApp: true, emailDelayMs: 0 });
  });

  it('an unreadable table SENDS — it fails open', async () => {
    // The two failure modes are not symmetric. Sending one email
    // somebody had switched off is a nuisance; silently not telling a
    // seller their parcel came back is money.
    const { svc } = make(null, true);
    expect(await svc.resolve(base)).toEqual({ email: true, inApp: true, emailDelayMs: 0 });
  });

  it('a CREDENTIAL message is never gated, and never even looked up', async () => {
    const { svc, findFirst } = make({
      emailEnabled: false,
      inAppEnabled: false,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
      timezone: 'Asia/Dhaka',
    });
    const out = await svc.resolve({
      ...base,
      notificationCategory: NotificationCategory.CREDENTIAL,
    });
    // Nobody unsubscribes from a password reset (NOTIF-9). Structural
    // rather than incidental: it holds even if a future change routes
    // a credential message down this path.
    expect(out).toEqual({ email: true, inApp: true, emailDelayMs: 0 });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('quiet hours delay the email and leave the inbox alone', async () => {
    const { svc } = make({
      emailEnabled: true,
      inAppEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'Asia/Dhaka',
    });
    // 01:00 Dhaka is 19:00 UTC the previous day.
    const out = await svc.resolve({ ...base, now: new Date('2026-09-04T19:00:00Z') });
    expect(out.email).toBe(true);
    expect(out.inApp).toBe(true);
    // Six hours to 07:00. An inbox line is a list somebody looks at
    // when they choose to, so it is never held.
    expect(out.emailDelayMs).toBe(6 * 60 * 60_000);
  });
});

describe('quietHoursDelayMs', () => {
  const TZ = 'Asia/Dhaka'; // UTC+6, no DST.

  /** A Date at the given Dhaka wall-clock time. */
  function dhaka(hh: number, mm = 0): Date {
    const utcHour = (hh - 6 + 24) % 24;
    return new Date(
      `2026-09-04T${String(utcHour).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
    );
  }

  it('no window means no delay', () => {
    expect(quietHoursDelayMs(null, null, TZ, dhaka(3))).toBe(0);
    expect(quietHoursDelayMs('22:00', null, TZ, dhaka(3))).toBe(0);
  });

  it('outside a wrapping window, nothing waits', () => {
    expect(quietHoursDelayMs('22:00', '07:00', TZ, dhaka(12))).toBe(0);
  });

  it('a WRAPPING window catches both sides of midnight', () => {
    // The case a naive `>= start && < end` gets wrong in the most
    // ordinary configuration there is: 22:00 → 07:00 is empty under
    // that test, so every night-time email would send immediately.
    expect(quietHoursDelayMs('22:00', '07:00', TZ, dhaka(23))).toBe(8 * 60 * 60_000);
    expect(quietHoursDelayMs('22:00', '07:00', TZ, dhaka(2))).toBe(5 * 60 * 60_000);
  });

  it('a NON-wrapping window works too', () => {
    expect(quietHoursDelayMs('09:00', '17:00', TZ, dhaka(10))).toBe(7 * 60 * 60_000);
    expect(quietHoursDelayMs('09:00', '17:00', TZ, dhaka(18))).toBe(0);
  });

  it('the start boundary is inside and the end boundary is outside', () => {
    expect(quietHoursDelayMs('22:00', '07:00', TZ, dhaka(22))).toBe(9 * 60 * 60_000);
    expect(quietHoursDelayMs('22:00', '07:00', TZ, dhaka(7))).toBe(0);
  });

  it('the window is read in the SELLER’s timezone, not the server’s', () => {
    // The same instant is quiet in Dhaka and wide awake in Kolkata's
    // morning — 01:30 Dhaka is 01:00 IST, both quiet — so use a zone
    // far enough away to actually differ: 01:00 Dhaka is 19:00 UTC.
    const instant = new Date('2026-09-04T19:00:00Z');
    expect(quietHoursDelayMs('22:00', '07:00', 'Asia/Dhaka', instant)).toBeGreaterThan(0);
    expect(quietHoursDelayMs('22:00', '07:00', 'UTC', instant)).toBe(0);
  });

  it('a nonsense timezone sends rather than holding the email forever', () => {
    expect(quietHoursDelayMs('22:00', '07:00', 'Not/AZone', dhaka(23))).toBe(0);
  });

  it('a zero-width window is no window', () => {
    expect(quietHoursDelayMs('22:00', '22:00', TZ, dhaka(22))).toBe(0);
  });
});
