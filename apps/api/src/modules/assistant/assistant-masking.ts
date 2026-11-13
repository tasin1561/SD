/**
 * Phone masking for the staff conversation explorer (owner decision,
 * 2026-11-13): numbers are hidden by default and revealing one is a logged
 * click. Masking is applied on the SERVER; the browser is never sent the
 * unmasked text unless a reveal was audited.
 *
 * What counts as a phone number: an E.164 style `+<8..15 digits>`, an
 * Indian mobile (10 digits starting 6-9, optionally with 91 / +91 / 0), or a
 * Bangladeshi mobile (11 digits `01[3-9]…`, optionally with 880 / +880).
 * Digits may be separated by spaces, dots, dashes or brackets. Anything
 * shorter (an order number, a pincode, an amount) is left alone.
 */
const CANDIDATE = /(?<![\w])\+?\d(?:[\s().-]?\d){7,14}(?![\w])/g;
const BULLET = '•';

function isPhoneDigits(digits: string, plus: boolean): boolean {
  const n = digits.length;
  if (plus) return n >= 8 && n <= 15;
  if (n === 10 && /^[6-9]/.test(digits)) return true; // IN mobile
  if (n === 11 && /^01[3-9]/.test(digits)) return true; // BD mobile
  if (n === 11 && /^0[6-9]/.test(digits)) return true; // IN with trunk 0
  if (n === 12 && /^91[6-9]/.test(digits)) return true; // IN with country code
  if (n === 13 && /^8801[3-9]/.test(digits)) return true; // BD with country code
  return false;
}

/** `+91 98•••••606`: country code and first two national digits, last three. */
export function maskDigits(raw: string): string {
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  const n = digits.length;
  const ccLen = plus ? Math.min(Math.max(n - 10, 1), 3) : n === 12 ? 2 : n === 13 ? 3 : 0;
  const headLen = ccLen + 2;
  const tailLen = 3;
  const hidden = Math.max(n - headLen - tailLen, 1);
  const cc = digits.slice(0, ccLen);
  const head = digits.slice(ccLen, headLen);
  const tail = digits.slice(n - tailLen);
  const prefix = ccLen > 0 ? `${plus ? '+' : ''}${cc} ` : plus ? '+' : '';
  return `${prefix}${head}${BULLET.repeat(hidden)}${tail}`;
}

/** Mask every phone number in a piece of text. */
export function maskPhones(text: string): string {
  return text.replace(CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '');
    return isPhoneDigits(digits, m.trim().startsWith('+')) ? maskDigits(m) : m;
  });
}

/** Mask every string inside a JSON value (tool inputs / results), keys untouched. */
export function maskPhonesDeep(value: unknown): unknown {
  if (typeof value === 'string') return maskPhones(value);
  if (Array.isArray(value)) return value.map(maskPhonesDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskPhonesDeep(v)]),
    );
  }
  return value;
}
