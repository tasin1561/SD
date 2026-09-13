import { describe, expect, it } from 'vitest';
import { adjustmentHref, prefillFromSearchParams } from '../lib/adjustment-prefill';

const line = {
  sellerId: 's-1',
  variantId: 'v-1',
  batchId: 'b-1',
  binId: 'bin-1',
};

describe('adjustment prefill from a bin line', () => {
  it('a Damaged-bin line opens as "returned to seller"; any other as a miscount', () => {
    const damaged = new URL(adjustmentHref({ ...line, binType: 'DAMAGED' }), 'https://x');
    expect(damaged.pathname).toBe('/inventory/adjustments');
    expect(damaged.searchParams.get('reason')).toBe('RETURNED_TO_SELLER');
    const floor = new URL(adjustmentHref({ ...line, binType: 'STORAGE' }), 'https://x');
    expect(floor.searchParams.get('reason')).toBe('COUNTING_ERROR');
  });

  it('round-trips through the page URL', () => {
    const url = new URL(adjustmentHref({ ...line, binType: 'DAMAGED' }), 'https://x');
    expect(prefillFromSearchParams(Object.fromEntries(url.searchParams))).toEqual({
      sellerId: 's-1',
      variantId: 'v-1',
      binId: 'bin-1',
      batchId: 'b-1',
      reasonCode: 'RETURNED_TO_SELLER',
    });
  });

  it('opens nothing unless the whole line is named, and never an unknown reason', () => {
    expect(prefillFromSearchParams({ sellerId: 's-1', variantId: 'v-1' })).toBeNull();
    expect(prefillFromSearchParams({ ...line, reason: 'MADE_UP' })?.reasonCode).toBe(
      'COUNTING_ERROR',
    );
  });
});
