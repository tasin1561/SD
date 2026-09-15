/**
 * A `datetime-local` default is LOCAL wall clock (finding: the store
 * payout form defaulted to UTC wall clock, which `new Date(value)` then
 * read as local — every payout recorded 5h30m early in India, and near
 * midnight on the 1st, in the previous month).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localNow, toDateTimeLocalValue } from '@/lib/datetime-local';

describe('datetime-local defaults', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Asia/Kolkata';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  it('is the viewer’s wall clock, not UTC — across a month boundary', () => {
    // 20:15 UTC on 30 Sep is 01:45 IST on 1 Oct.
    vi.setSystemTime(new Date('2026-09-30T20:15:00.000Z'));
    expect(localNow()).toBe('2026-10-01T01:45');
    // The bug: the UTC slice names the previous day.
    expect(localNow()).not.toBe(new Date().toISOString().slice(0, 16));
  });

  it('round-trips: the value parsed back as local is the same instant', () => {
    const instant = new Date('2026-09-30T20:15:00.000Z');
    const value = toDateTimeLocalValue(instant);
    expect(new Date(value).toISOString()).toBe(instant.toISOString());
  });
});
