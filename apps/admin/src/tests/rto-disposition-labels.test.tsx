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
    // HOLD_DAMAGED (WMS-8d) is the owner's "keep aside damaged".
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).toEqual([
      'RESTOCK',
      'HOLD_DAMAGED',
      'WRITE_OFF',
      'INSPECT_LATER',
    ]);
    render(<RtoItemRow item={item} saving={false} onSave={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Put back in stock' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Keep aside (damaged)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Write off (not sellable)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Decide later' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'WRITE_OFF' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'HOLD_DAMAGED' })).toBeNull();
  });

  it('says where a kept-aside unit goes and how it leaves later', () => {
    const keep = DISPOSITION_OPTIONS.find((o) => o.value === 'HOLD_DAMAGED');
    expect(keep?.effect).toMatch(/Damaged bin/);
    expect(keep?.effect).toMatch(/never sellable/);
    expect(keep?.effect).toMatch(/Inventory → Adjustments/);
  });

  it('says where each choice takes a unit out of the returns hold (WMS-8e)', () => {
    const effect = (v: string): string =>
      DISPOSITION_OPTIONS.find((o) => o.value === v)?.effect ?? '';
    // Put back in stock is sellable at once — no shelving step after.
    expect(effect('RESTOCK')).toMatch(/Sellable immediately/);
    expect(effect('RESTOCK')).toMatch(/floor bin/);
    expect(effect('RESTOCK')).not.toMatch(/On the bench|once it is shelved/);
    expect(effect('HOLD_DAMAGED')).toMatch(/from the returns hold into .*Damaged bin/);
    expect(effect('WRITE_OFF')).toMatch(/Removed from the returns hold/);
    expect(effect('INSPECT_LATER')).toMatch(/Stays in the returns hold/);
  });

  it('names a combination that is usually a slip, without refusing it', () => {
    expect(dispositionMismatch('DAMAGED', 'RESTOCK')).toMatch(/sold to the next customer/);
    expect(dispositionMismatch('MISSING', 'RESTOCK')).toMatch(/Write off/);
    expect(dispositionMismatch('GOOD', 'WRITE_OFF')).toMatch(/Put it back in stock/);
    expect(dispositionMismatch('GOOD', 'HOLD_DAMAGED')).toMatch(/can never be sold/);
    expect(dispositionMismatch('MISSING', 'HOLD_DAMAGED')).toMatch(/Write off/);
    expect(dispositionMismatch('GOOD', 'RESTOCK')).toBeNull();
    expect(dispositionMismatch('DAMAGED', 'WRITE_OFF')).toBeNull();
    expect(dispositionMismatch('DAMAGED', 'HOLD_DAMAGED')).toBeNull();
    expect(dispositionMismatch('DAMAGED', 'INSPECT_LATER')).toBeNull();
  });

  it('a one-unit line has nothing to split', () => {
    render(<RtoItemRow item={item} saving={false} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Split by quantity' })).toBeNull();
  });
});
