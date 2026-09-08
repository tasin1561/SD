/**
 * The shared bits behind both notification surfaces.
 *
 * Extracted when the inbox page became the bell's second consumer — a
 * group that is a red triangle in one and a blue lorry in the other
 * teaches the reader that the icon means nothing.
 */
import { describe, expect, it } from 'vitest';
import { agoLabel, humaniseTopic, notificationKindStyle } from '@skydrop/ui/components';

describe('humaniseTopic', () => {
  it('names the SUBJECT, not the channel it arrived on', () => {
    // This was the bug: the chip on a broadcast read "EMAIL", which is
    // the one thing the reader can already see, in the place reserved
    // for what the notification is about.
    expect(humaniseTopic('system.announcement.email')).toBe('Announcement');
    expect(humaniseTopic('seller.order_dispatched.email')).toBe('Order dispatched');
  });

  it('drops the audience segment too', () => {
    expect(humaniseTopic('shipment.delivery_failed.seller')).toBe('Delivery failed');
    expect(humaniseTopic('system.issue.staff')).toBe('Issue');
  });

  it('survives a topic that is all suffix', () => {
    // Never throws and never returns an empty chip, whatever arrives.
    expect(humaniseTopic('email')).toBe('Email');
  });
});

describe('notificationKindStyle', () => {
  it('gives every catalogue group its own look', () => {
    expect(notificationKindStyle('Returns').tone).toBe('rto');
    expect(notificationKindStyle('Money').tone).toBe('delivered');
    expect(notificationKindStyle('System').tone).toBe('failed');
  });

  it('an unknown group still renders — never nothing', () => {
    // A group added server-side must appear. Rendering nothing would
    // hide the notification entirely.
    const s = notificationKindStyle('SomethingNew');
    expect(s.Icon).toBeDefined();
    expect(s.tone).toBe('draft');
    expect(notificationKindStyle(null).tone).toBe('draft');
  });
});

describe('agoLabel', () => {
  const now = Date.parse('2026-09-08T10:00:00.000Z');
  const at = (ms: number) => new Date(now - ms).toISOString();

  it('counts minutes and hours while it is still recent', () => {
    expect(agoLabel(at(30_000), now)).toBe('just now');
    expect(agoLabel(at(12 * 60_000), now)).toBe('12m ago');
    expect(agoLabel(at(3 * 3_600_000), now)).toBe('3h ago');
  });

  it('says Yesterday, then a date', () => {
    expect(agoLabel(at(26 * 3_600_000), now)).toBe('Yesterday');
    expect(agoLabel(at(9 * 86_400_000), now)).toMatch(/Aug|Sep/);
  });

  it('returns nothing readable rather than NaN on a bad value', () => {
    expect(agoLabel('not-a-date', now)).toBe('');
  });
});
