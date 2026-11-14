/**
 * The "Ask Skydrop AI" launcher lifts above every sticky bottom bar. It sat
 * on the order forms' submit buttons because their bars were not listed
 * (found while re-filming the tutorials, 2026-11-14).
 */
import { describe, expect, it } from 'vitest';
import { BOTTOM_BAR_SELECTOR } from '@skydrop/ui/app/assistant';

describe('launcher bottom bars', () => {
  it.each(['.ord-bar', '.ro-bar', '.as-bar', '.prd-savebar', '[data-bottom-bar]'])(
    'lists %s',
    (sel) => {
      expect(BOTTOM_BAR_SELECTOR.split(',').map((s) => s.trim())).toContain(sel);
    },
  );
});
