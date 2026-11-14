/**
 * `PhoneFold` — a long list on a phone shows six cards, then "Show all N".
 * The hiding itself is CSS (phone only). What the component must do:
 * count the rows of the table it wraps, offer the button only when there
 * are more than six, name the full count, and open and close on a tap.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PhoneFold } from '@/components/easy/phone-fold';
import { renderWithProviders } from './helpers';

function Sheet({ rows }: { rows: number }) {
  return (
    <PhoneFold className="ez-wrap ez-cards">
      <table className="sd-table-cards">
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>row {i + 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PhoneFold>
  );
}

describe('PhoneFold', () => {
  it('offers "Show all" with the full count, and opens and closes', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Sheet rows={43} />);
    const button = await screen.findByRole('button', { name: 'Show all 43' });
    const fold = container.querySelector('.ez-fold');
    expect(fold?.hasAttribute('data-open')).toBe(false);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(43);
    await user.click(button);
    expect(fold?.hasAttribute('data-open')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(fold?.hasAttribute('data-open')).toBe(false);
  });

  it('adds no button to a short list', async () => {
    renderWithProviders(<Sheet rows={6} />);
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });
});
