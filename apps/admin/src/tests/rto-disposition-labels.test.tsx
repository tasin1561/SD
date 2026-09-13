import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DISPOSITION_OPTIONS,
  RtoItemRow,
  dispositionMismatch,
} from '../app/(authed)/warehouse/rto/_components/rto-item-row';

const item = {
  shipmentItemId: 'si-1',
  skuCode: 'AVIATO-GREE-BLAC',
  productName: 'Aviator OG Sunglass',
  variantLabel: null,
  quantity: 1,
  rtoCondition: null,
  rtoDisposition: null,
  rtoInspectionNotes: null,
  thumbnailUrl: null,
};

describe('RTO disposition labels', () => {
  it('offers every disposition the API accepts, in plain words', () => {
    // Pinned against the enum: INSPECT_LATER was accepted by the API and
    // offered nowhere, so "decide later" could not be chosen at the bench.
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).toEqual([
      'RESTOCK',
      'WRITE_OFF',
      'INSPECT_LATER',
    ]);
    render(<RtoItemRow item={item} saving={false} onSave={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Put back in stock' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Write off (not sellable)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Decide later' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'WRITE_OFF' })).toBeNull();
  });

  it('names a combination that is usually a slip, without refusing it', () => {
    expect(dispositionMismatch('DAMAGED', 'RESTOCK')).toMatch(/sold to the next customer/);
    expect(dispositionMismatch('MISSING', 'RESTOCK')).toMatch(/Write off/);
    expect(dispositionMismatch('GOOD', 'WRITE_OFF')).toMatch(/Put it back in stock/);
    expect(dispositionMismatch('GOOD', 'RESTOCK')).toBeNull();
    expect(dispositionMismatch('DAMAGED', 'WRITE_OFF')).toBeNull();
    expect(dispositionMismatch('DAMAGED', 'INSPECT_LATER')).toBeNull();
  });
});
