/**
 * CSV for a spreadsheet, safe to open in one.
 *
 * A cell that begins with = + - @ (or a tab / carriage return) is run as a
 * formula by Excel and Sheets, and a customer's name or a seller's own
 * reference is text somebody else typed. Those cells are prefixed with an
 * apostrophe, which the spreadsheet swallows on display. (A bare `+digits`
 * phone number is the one exemption — see below.)
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // A bare international number (`+919876543210`) is a phone, not a
  // formula: nothing after the plus can be evaluated, and prefixing it
  // would corrupt the one column every export exists to carry.
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

/** `2026-11-19 14:03:05` in India Standard Time; empty for a missing instant. */
export function istStamp(d: Date | null | undefined): string {
  if (d === null || d === undefined) return '';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

/** `2026-11-19`, the IST calendar day, for a file name. */
export function istDay(d: Date = new Date()): string {
  return istStamp(d).slice(0, 10);
}
