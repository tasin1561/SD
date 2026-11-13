/**
 * The shared table of status labels. Three rules it must never break:
 * a known code reads in the chosen language, an unknown code is still
 * readable (never blank, never the raw code), and nothing is "undefined".
 */
import { describe, expect, it } from 'vitest';
import { codeLabel } from '@/components/easy/code-label';

describe('codeLabel', () => {
  it('writes a known code in each language', () => {
    expect(codeLabel('IN_PROGRESS', 'en')).toBe('In progress');
    expect(codeLabel('IN_PROGRESS', 'bn')).toBe('চলছে');
    expect(codeLabel('IN_PROGRESS', 'hi')).toBe('जारी है');
  });

  it('accepts a lower-case code', () => {
    expect(codeLabel('pending', 'en')).toBe('Waiting');
  });

  it('falls back to plain English words for a code it has never seen', () => {
    expect(codeLabel('SOME_NEW_STATE', 'bn')).toBe('Some new state');
  });

  it('shows a dash for nothing at all', () => {
    expect(codeLabel(null, 'en')).toBe('—');
    expect(codeLabel('', 'hi')).toBe('—');
  });
});
