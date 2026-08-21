/**
 * Every figure in the seller app is shown in the money that seller
 * thinks in. INR stays canonical everywhere it is STORED and everywhere
 * it is TYPED; only the display turns over.
 *
 * The cases worth pinning are the ones that lose money quietly:
 * converting a figure that was already converted, and converting at a
 * rate we do not have.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money, MoneyDisplayProvider } from '@skydrop/ui/components';

function inTaka(ui: React.ReactElement, rate: string | null = '1.23') {
  return render(
    <MoneyDisplayProvider value={{ currency: 'BDT', rate }}>{ui}</MoneyDisplayProvider>,
  );
}

describe('Money — display currency', () => {
  it('shows a rupee amount in taka at the given rate', () => {
    inTaka(<Money amount="1000.00" />);
    expect(screen.getByText(/৳/)).toBeInTheDocument();
    expect(screen.getByText(/1,230/)).toBeInTheDocument();
  });

  it('keeps RUPEES when no rate could be resolved', () => {
    // A wrong number is worse than the wrong currency: a seller acts on
    // what the screen says.
    inTaka(<Money amount="1000.00" />, null);
    expect(screen.getByText(/₹/)).toBeInTheDocument();
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });

  it('does NOT convert a figure already stated in taka', () => {
    // A component passing currency="BDT" is stating a fact about that
    // figure — the taka we actually wired — not asking to be converted.
    // Converting it again multiplies by the rate twice.
    inTaka(<Money amount="1000.00" currency="BDT" />);
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(screen.queryByText(/1,230/)).not.toBeInTheDocument();
  });

  it('leaves everything in rupees with no provider — admin is untouched', () => {
    render(<Money amount="1000.00" />);
    expect(screen.getByText(/₹/)).toBeInTheDocument();
  });

  it('keeps the debit sign and Indian grouping through the conversion', () => {
    // ৳12,34,567 not ৳1,234,567 — the grouping belongs to the reader,
    // not the currency.
    inTaka(<Money amount="-1000000" direction="debit" />, '1');
    expect(screen.getByText(/−/)).toBeInTheDocument();
    expect(screen.getByText(/10,00,000/)).toBeInTheDocument();
  });
});
