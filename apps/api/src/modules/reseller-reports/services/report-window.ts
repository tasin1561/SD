import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest window a report may cover — a year and a month, generous for a store. */
const MAX_DAYS = 400;

/**
 * A report window `[from, to)` from two query strings — the reseller
 * reports' twin of the admin P&L's `pnlWindow`, with the same refusals.
 *
 * The frontends send IST midnights (the start of the first day, and the
 * start of the day AFTER the last), so windows tile. A bad date silently
 * becoming "now" would report the wrong window as confidently as the
 * right one, so it is refused; so is a window that starts after it ends,
 * or one long enough to turn a report into a scan.
 */
export function reportWindow(
  from: string | undefined,
  to: string | undefined,
  defaultDays = 30,
): { from: Date; to: Date } {
  const parse = (v: string | undefined, fallback: Date): Date => {
    if (v === undefined || v === '') return fallback;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: `"${v}" is not a date` });
    }
    return d;
  };
  const toDate = parse(to, new Date());
  const fromDate = parse(from, new Date(toDate.getTime() - defaultDays * DAY_MS));
  if (fromDate > toDate) {
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: 'The window starts after it ends',
    });
  }
  if (toDate.getTime() - fromDate.getTime() > MAX_DAYS * DAY_MS) {
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: `A report covers at most ${MAX_DAYS} days — pick a shorter window.`,
    });
  }
  return { from: fromDate, to: toDate };
}
