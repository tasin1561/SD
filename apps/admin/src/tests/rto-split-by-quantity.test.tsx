import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  RtoItemRow,
  remainingLabel,
  type RtoInspectPayload,
} from '../app/(authed)/warehouse/rto/_components/rto-item-row';

/**
 * WMS-8d — "what if this product has 2 qty? one is good and another is
 * damaged?" A line of more than one unit can be split into rows, each with
 * its own quantity and decision. One decision stays the default; the
 * screen shows the arithmetic live and the SERVER decides whether it adds
 * up (FE-2).
 */
const item = {
  shipmentItemId: 'si-1',
  skuCode: 'AVIATO-GREE-BLAC',
  productName: 'Aviator OG Sunglass',
  variantLabel: null,
  quantity: 2,
  rtoCondition: null,
  rtoDisposition: null,
  rtoInspectionNotes: null,
  thumbnailUrl: null,
};

function select(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('RTO split by quantity', () => {
  it('is offered on a line of more than one unit, and one decision stays the default', () => {
    render(<RtoItemRow item={item} saving={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Condition')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Split by quantity' })).toBeTruthy();
  });

  it('1 good put back + 1 damaged kept aside is sent as two rows', () => {
    const onSave = vi.fn<(p: RtoInspectPayload) => Promise<void>>(async () => undefined);
    render(<RtoItemRow item={item} saving={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Split by quantity' }));

    select('Condition, row 1', 'GOOD');
    select('What happens to them, row 1', 'RESTOCK');
    select('Condition, row 2', 'DAMAGED');
    select('What happens to them, row 2', 'HOLD_DAMAGED');
    fireEvent.change(screen.getByLabelText('Notes, row 2'), { target: { value: 'cracked lens' } });
    expect(screen.getByRole('status').textContent).toBe('All 2 units have a decision.');

    fireEvent.click(screen.getByRole('button', { name: 'Save inspection' }));
    expect(onSave).toHaveBeenCalledWith({
      rows: [
        { quantity: 1, condition: 'GOOD', disposition: 'RESTOCK' },
        { quantity: 1, condition: 'DAMAGED', disposition: 'HOLD_DAMAGED', notes: 'cracked lens' },
      ],
    });
  });

  it('shows what is left to decide as the quantities change, without refusing to send', () => {
    const onSave = vi.fn<(p: RtoInspectPayload) => Promise<void>>(async () => undefined);
    render(<RtoItemRow item={{ ...item, quantity: 3 }} saving={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Split by quantity' }));
    // Starts as 1 + the rest.
    expect(screen.getByRole('status').textContent).toBe('All 3 units have a decision.');
    fireEvent.change(screen.getByLabelText('Units in row 2'), { target: { value: '1' } });
    expect(screen.getByRole('status').textContent).toBe('1 of 3 units still need a decision.');
    fireEvent.change(screen.getByLabelText('Units in row 2'), { target: { value: '4' } });
    expect(screen.getByRole('status').textContent).toBe('2 more than the 3 units on this line.');

    // The server is the authority on the sum (RTO_SPLIT_QUANTITY_MISMATCH):
    // a complete-looking form is sent even when the count is off.
    select('Condition, row 1', 'GOOD');
    select('What happens to them, row 1', 'RESTOCK');
    select('Condition, row 2', 'DAMAGED');
    select('What happens to them, row 2', 'WRITE_OFF');
    fireEvent.click(screen.getByRole('button', { name: 'Save inspection' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('opens an existing split as rows, and can go back to one decision', () => {
    render(
      <RtoItemRow
        item={{
          ...item,
          rtoCondition: 'DAMAGED',
          rtoDisposition: 'RESTOCK',
          rtoInspections: [
            { quantity: 1, condition: 'GOOD', disposition: 'RESTOCK', notes: null },
            { quantity: 1, condition: 'DAMAGED', disposition: 'HOLD_DAMAGED', notes: null },
          ],
        }}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('What happens to them, row 2') as HTMLSelectElement).value).toBe(
      'HOLD_DAMAGED',
    );
    fireEvent.click(screen.getByRole('button', { name: 'One decision for all 2' }));
    expect(screen.getByLabelText('Condition')).toBeTruthy();
  });

  it('flags a likely slip on a row, without refusing it', () => {
    render(<RtoItemRow item={item} saving={false} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Split by quantity' }));
    select('Condition, row 2', 'GOOD');
    select('What happens to them, row 2', 'HOLD_DAMAGED');
    expect(screen.getByText(/can never be sold/)).toBeTruthy();
  });

  it('remainingLabel ignores a row that is not a whole number yet', () => {
    expect(
      remainingLabel(2, [
        { quantity: '1', condition: '', disposition: '', notes: '' },
        { quantity: '', condition: '', disposition: '', notes: '' },
      ]),
    ).toBe('1 of 2 units still need a decision.');
  });
});
