import { describe, expect, it } from 'vitest';
import { IN_DIAL, isCompleteLocal, sanitiseLocal, toE164, toLocalDigits } from '@/lib/phone';

/**
 * The recipient phone rule, tested once for both screens.
 *
 * The create form and the edit form share this module precisely so they
 * cannot disagree — twice in this codebase a field change to one had to
 * be chased into the other by hand. These tests pin the behaviour the
 * two of them rely on.
 *
 * The paste cases are the ones worth having. A seller copying a number
 * out of WhatsApp or a spreadsheet does not paste ten bare digits; they
 * paste "+91 98123 45678" or "0091-98123-45678" or a number with a
 * leading zero. Rejecting those would be technically correct and
 * infuriating, so the sanitiser reduces them to the ten that matter.
 */

describe('sanitiseLocal — what a seller can type or paste', () => {
  it('keeps ten plain digits', () => {
    expect(sanitiseLocal('9812345678')).toBe('9812345678');
  });

  it('strips everything that is not a digit', () => {
    expect(sanitiseLocal('98123 45678')).toBe('9812345678');
    expect(sanitiseLocal('98123-45678')).toBe('9812345678');
    expect(sanitiseLocal('(981) 234-5678')).toBe('9812345678');
  });

  it('absorbs a pasted country code in its several forms', () => {
    expect(sanitiseLocal('+91 98123 45678')).toBe('9812345678');
    expect(sanitiseLocal('0091 9812345678')).toBe('9812345678');
    expect(sanitiseLocal('919812345678')).toBe('9812345678');
  });

  it('drops a domestic trunk zero', () => {
    expect(sanitiseLocal('09812345678')).toBe('9812345678');
  });

  it('never yields more than ten digits', () => {
    expect(sanitiseLocal('98123456789999')).toHaveLength(10);
  });

  it('does NOT strip a leading 91 from a legitimate ten-digit number', () => {
    // 9187654321 is a real ten-digit number that happens to start "91".
    // Stripping it would silently mangle the seller's input, so the
    // country-code rule only fires when the result is too long.
    expect(sanitiseLocal('9187654321')).toBe('9187654321');
  });
});

describe('isCompleteLocal — the submit gate', () => {
  it('requires exactly ten', () => {
    expect(isCompleteLocal('9812345678')).toBe(true);
    expect(isCompleteLocal('981234567')).toBe(false);
    expect(isCompleteLocal('98123456789')).toBe(false);
    expect(isCompleteLocal('')).toBe(false);
  });

  it('refuses anything non-numeric', () => {
    expect(isCompleteLocal('98123abcde')).toBe(false);
  });
});

describe('toLocalDigits — E.164 back to what the field shows', () => {
  it('strips the Indian dial code', () => {
    expect(toLocalDigits('+919812345678')).toBe('9812345678');
  });

  it('handles an empty or missing stored value', () => {
    expect(toLocalDigits('')).toBe('');
    expect(toLocalDigits(null)).toBe('');
    expect(toLocalDigits(undefined)).toBe('');
  });

  it('shows a NON-Indian stored number as bare digits rather than re-badging it', () => {
    // An imported or admin-entered BD number must not be silently
    // reinterpreted as +91. It surfaces as too many digits, fails the
    // gate, and the operator has to correct it deliberately.
    const shown = toLocalDigits('+8801712345678');
    expect(shown).toBe('8801712345678');
    expect(isCompleteLocal(shown)).toBe(false);
  });
});

describe('round trip', () => {
  it('composes back to the E.164 the API stores', () => {
    expect(toE164(sanitiseLocal('+91 98123 45678'))).toBe('+919812345678');
  });

  it('is stable through a display → edit → store cycle', () => {
    const stored = '+919812345678';
    expect(toE164(sanitiseLocal(toLocalDigits(stored)))).toBe(stored);
  });

  it('uses the shared dial constant, not a literal', () => {
    expect(toE164('9812345678').startsWith(IN_DIAL)).toBe(true);
  });
});
