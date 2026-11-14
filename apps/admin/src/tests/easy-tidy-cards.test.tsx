/**
 * `TidyCards` marks table cells that hold nothing, so a phone card can
 * leave those lines out. What must hold: a dash or an empty cell is
 * marked; a real value is not, even a zero; a cell with a control in it
 * is never marked; and rows that arrive later are marked too.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TidyCards } from '@/components/easy/tidy-cards';

function Sheet({ extra = false }: { extra?: boolean }) {
  return (
    <div className="ez-phone">
      <TidyCards />
      <table className="sd-table-cards">
        <tbody>
          <tr>
            <td data-k="name">Dhaka Threads Ltd</td>
            <td data-k="dash">—</td>
            <td data-k="blank"> </td>
            <td data-k="zero">₹0.00</td>
            <td data-k="button">
              <button type="button">—</button>
            </td>
          </tr>
          {extra && (
            <tr>
              <td data-k="late">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const marked = (root: HTMLElement, k: string): boolean =>
  root.querySelector(`[data-k="${k}"]`)?.hasAttribute('data-ez-empty') === true;

describe('TidyCards', () => {
  it('marks a dash and a blank, never a value, a zero or a control', () => {
    const { container } = render(<Sheet />);
    expect(marked(container, 'dash')).toBe(true);
    expect(marked(container, 'blank')).toBe(true);
    expect(marked(container, 'name')).toBe(false);
    expect(marked(container, 'zero')).toBe(false);
    expect(marked(container, 'button')).toBe(false);
  });

  it('marks rows that arrive after the first paint', async () => {
    const { container, rerender } = render(<Sheet />);
    rerender(<Sheet extra />);
    await waitFor(() => expect(marked(container, 'late')).toBe(true));
  });
});
