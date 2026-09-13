import {
  parseIstTimestamp,
  toIsoWithIst,
} from '../../src/modules/tracking-events/services/courier-time';

/**
 * A courier's IST wall-clock, read field by field.
 *
 * `new Date` reads a spaced numeric date MONTH-first, and Shiprocket's
 * push sends `DD MM YYYY HH:mm:ss`. So `11 09 2026` was stored as
 * 9 November and `13 09 2026` became an Invalid Date that failed the
 * tracking job (13 Sep 2026). Every case below is a shape that production
 * actually sent, or the named-month form a courier could send.
 */
describe('parseIstTimestamp', () => {
  const utc = (iso: string | null): string => new Date(iso ?? '').toISOString();

  it('day-first with spaces — Shiprocket current_timestamp (810 of 811 pushes)', () => {
    expect(parseIstTimestamp('13 09 2026 14:52:06')).toBe('2026-09-13T14:52:06+05:30');
    expect(utc(parseIstTimestamp('13 09 2026 14:52:06'))).toBe('2026-09-13T09:22:06.000Z');
  });

  it('day-first up to the 12th is still day-first — never November', () => {
    expect(utc(parseIstTimestamp('11 09 2026 19:10:30'))).toBe('2026-09-11T13:40:30.000Z');
    expect(utc(parseIstTimestamp('09 09 2026 15:24:33'))).toBe('2026-09-09T09:54:33.000Z');
  });

  it('year-first — their scan date, and one push in 811', () => {
    expect(parseIstTimestamp('2026-09-13 14:51:54')).toBe('2026-09-13T14:51:54+05:30');
    expect(parseIstTimestamp('2026-09-13T14:51:54.767')).toBe('2026-09-13T14:51:54.767+05:30');
  });

  it('day-first with dashes or slashes, and a named month', () => {
    expect(parseIstTimestamp('13-09-2026 14:02')).toBe('2026-09-13T14:02:00+05:30');
    expect(parseIstTimestamp('13/09/2026 14:02:00')).toBe('2026-09-13T14:02:00+05:30');
    expect(parseIstTimestamp('13-Sep-2026 14:02')).toBe('2026-09-13T14:02:00+05:30');
    expect(parseIstTimestamp('4 Sept 2026 09:37')).toBe('2026-09-04T09:37:00+05:30');
  });

  it('leaves an already-zoned ISO string alone', () => {
    expect(parseIstTimestamp('2026-09-13T09:22:06Z')).toBe('2026-09-13T09:22:06Z');
    expect(parseIstTimestamp('2026-09-13T14:52:06+05:30')).toBe('2026-09-13T14:52:06+05:30');
  });

  it('refuses what it cannot read — never a guess, never now()', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '   ',
      'not a date',
      '31 09 2026 10:00:00', // September has 30 days
      '13 13 2026 10:00:00', // no 13th month
      '99 99 2026 99:99:99',
      '13 09 2026', // a date is not an instant a scan happened at
      '13 09 2026 24:00:00',
      '13-Foo-2026 10:00',
    ]) {
      expect(parseIstTimestamp(bad)).toBeNull();
    }
  });
});

describe('toIsoWithIst (unchanged for Delhivery)', () => {
  it('appends IST to an unzoned ISO timestamp and leaves a zoned one alone', () => {
    expect(toIsoWithIst('2019-01-09T17:10:42.767')).toBe('2019-01-09T17:10:42.767+05:30');
    expect(toIsoWithIst('2019-01-09T17:10:42.767Z')).toBe('2019-01-09T17:10:42.767Z');
  });
});
