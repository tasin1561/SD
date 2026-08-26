import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Money, Num, Ident, Stat, SortableTh, EmptyState } from '@skydrop/ui/components';

/**
 * The shared ops primitives.
 *
 * Money gets the most attention here because it renders the numbers a
 * seller reconciles their income against — a formatting bug in a
 * ledger is a trust bug, not a cosmetic one.
 */
describe('Money', () => {
  it('groups in the INDIAN convention, not the western one', () => {
    // ₹12,34,567 — not ₹1,234,567. Getting this wrong quietly signals
    // "not built for this market" to every seller who reads it.
    render(<Money amount="1234567" decimals={false} />);
    expect(screen.getByText(/12,34,567/)).toBeTruthy();
  });

  it('renders paise by default, because money columns line up on the decimal', () => {
    render(<Money amount="176.29" />);
    expect(screen.getByText(/176\.29/)).toBeTruthy();
  });

  it('uses TABULAR figures — the fix for jittering ledger columns', () => {
    // Proportional digits have different widths, so amounts shift
    // horizontally as values change and decimals stop aligning.
    const { container } = render(<Money amount="1000" />);
    expect(container.querySelector('.skydrop-tabular')).toBeTruthy();
  });

  it('marks a credit with BOTH a sign and a colour, never colour alone', () => {
    // Colour-only encoding is invisible to a colour-blind reader, and
    // "did money come in or go out" is not a detail to lose.
    const { container } = render(<Money amount="500" direction="credit" />);
    expect(container.textContent).toContain('+');
    expect(container.querySelector('.text-\\[var\\(--color-credit\\)\\]')).toBeTruthy();
  });

  it('marks a debit with a minus and the debit colour', () => {
    const { container } = render(<Money amount="500" direction="debit" />);
    expect(container.textContent).toContain('−');
    expect(container.querySelector('.text-\\[var\\(--color-debit\\)\\]')).toBeTruthy();
  });

  it('treats a negative amount as a debit without being told', () => {
    const { container } = render(<Money amount="-250" />);
    expect(container.textContent).toContain('−');
    // …and does not print a double negative.
    expect(container.textContent).not.toContain('−−');
    expect(container.textContent).toContain('250');
  });

  it('announces direction in WORDS to a screen reader', () => {
    // "minus 1,200 rupees" reads as arithmetic; "debit ₹1,200" reads
    // as a fact about the account.
    render(<Money amount="1200" direction="debit" />);
    expect(screen.getByLabelText(/debit/i)).toBeTruthy();
  });

  it('supports BDT for the seller-facing display currency', () => {
    const { container } = render(<Money amount="1000" currency="BDT" decimals={false} />);
    expect(container.textContent).toContain('৳');
  });

  it('passes a non-numeric value through instead of rendering NaN', () => {
    render(<Money amount="—" />);
    expect(screen.getByText(/—/)).toBeTruthy();
  });
});

describe('Num and Ident', () => {
  it('Num groups and stays tabular, with an optional unit', () => {
    const { container } = render(<Num value={1500} suffix="g" />);
    expect(container.textContent).toContain('1,500');
    expect(container.textContent).toContain('g');
    expect(container.querySelector('.skydrop-tabular')).toBeTruthy();
  });

  it('Ident renders monospaced — AWBs get compared against a physical label', () => {
    const { container } = render(<Ident value="38061110478262" />);
    expect(container.querySelector('.font-mono')).toBeTruthy();
  });
});

describe('SortableTh', () => {
  it('exposes sort state via aria-sort, not just an arrow glyph', () => {
    // The arrow tells sighted users; aria-sort is how everyone else
    // learns the table is sorted at all.
    render(
      <table>
        <thead>
          <tr>
            <SortableTh
              label="Amount"
              columnKey="amount"
              activeKey="amount"
              direction="desc"
              onSort={() => {}}
            />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending');
  });

  it('reports "none" for a column that is not the active sort', () => {
    render(
      <table>
        <thead>
          <tr>
            <SortableTh
              label="Amount"
              columnKey="amount"
              activeKey="date"
              direction="asc"
              onSort={() => {}}
            />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none');
  });

  it('makes the WHOLE header the target, not a tiny chevron', async () => {
    const onSort = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortableTh
              label="Amount"
              columnKey="amount"
              activeKey={null}
              direction="asc"
              onSort={onSort}
            />
          </tr>
        </thead>
      </table>,
    );
    await userEvent.click(screen.getByRole('button', { name: /amount/i }));
    expect(onSort).toHaveBeenCalledWith('amount');
  });
});

describe('EmptyState', () => {
  it('offers a next step rather than dead-ending on "no results"', () => {
    render(
      <EmptyState
        title="No settlements recorded"
        description="Enter Delhivery's weekly withdrawal to start reconciling."
        action={<button type="button">Record a withdrawal</button>}
      />,
    );
    expect(screen.getByText(/No settlements recorded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /record a withdrawal/i })).toBeTruthy();
  });

  it('can drop its card chrome for use inside an already-bordered table', () => {
    const { container } = render(<EmptyState title="Nothing here" bare />);
    expect(container.querySelector('.border')).toBeNull();
  });
});

describe('Stat', () => {
  it('carries tone without relying on colour alone — the label says what it is', () => {
    render(<Stat label="Outstanding float" value="₹94,000" tone="bad" hint="12 orders overdue" />);
    expect(screen.getByText(/Outstanding float/i)).toBeTruthy();
    expect(screen.getByText(/12 orders overdue/)).toBeTruthy();
  });
});
