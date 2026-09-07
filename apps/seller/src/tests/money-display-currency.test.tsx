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

  it('honours convert={false} for a figure beside a rupee input', () => {
    // "Available to withdraw" sits above a box that takes rupees. Showing
    // it in taka would invite someone to type the converted number, and
    // the request would be refused — or worse, quietly smaller than they
    // meant.
    inTaka(<Money amount="1000.00" convert={false} />);
    expect(screen.getByText(/₹/)).toBeInTheDocument();
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });
});

/**
 * The equivalent beside every figure.
 *
 * A BD seller reading rupees still prices in taka, so the sum was being
 * done in their head on every screen. `equivalentRate` is deliberately a
 * SEPARATE field from `rate`: they are non-null at different times, and
 * the case that matters most here — display currency INR — is exactly
 * the case where `rate` is null.
 */
function withEquivalent(ui: React.ReactElement, equivalentRate: string | null = '1.23') {
  return render(
    <MoneyDisplayProvider value={{ currency: 'INR', rate: null, equivalentRate }}>
      {ui}
    </MoneyDisplayProvider>,
  );
}

describe('Money — the equivalent beside the figure', () => {
  it('states a rupee figure in taka as well', () => {
    withEquivalent(<Money amount="1000.00" />);
    expect(screen.getByText(/₹1,000/)).toBeInTheDocument();
    expect(screen.getByText(/≈৳1,230/)).toBeInTheDocument();
  });

  it('restates a taka display in rupees — the same code, the other way', () => {
    render(
      // Round numbers on purpose: the point of the case is the
      // DIRECTION, and a real reciprocal (1/1.23) lands on 999.99 and
      // makes the assertion about floating point instead.
      <MoneyDisplayProvider value={{ currency: 'BDT', rate: '2', equivalentRate: '0.5' }}>
        <Money amount="1000.00" />
      </MoneyDisplayProvider>,
    );
    expect(screen.getByText(/৳2,000/)).toBeInTheDocument();
    expect(screen.getByText(/≈₹1,000/)).toBeInTheDocument();
  });

  it('says nothing extra when no rate could be resolved', () => {
    withEquivalent(<Money amount="1000.00" />, null);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('says nothing extra at zero', () => {
    // The restatement of nothing carries no information, and a column of
    // "≈৳0.00" is pure noise.
    withEquivalent(<Money amount="0" />);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('says nothing extra beside a figure pinned to a rupee input', () => {
    // convert={false} marks a figure that must agree with a box typed in
    // one currency. A second number beside it invites typing THAT one —
    // the same trap the flag exists to close.
    withEquivalent(<Money amount="1000.00" convert={false} />);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it('carries the sign into the equivalent', () => {
    // "−₹400.00 ≈৳492.00" reads as a debit and a credit side by side.
    withEquivalent(<Money amount="-400" direction="debit" />);
    expect(screen.getByText(/≈−৳492/)).toBeInTheDocument();
  });

  it('leaves admin alone — no provider, no second figure', () => {
    render(<Money amount="1000.00" />);
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
});
