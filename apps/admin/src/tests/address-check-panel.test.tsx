import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddressCheckPanel, type AddressCheckResult } from '@skydrop/ui/app/address-check';

function result(over: Partial<AddressCheckResult> = {}): AddressCheckResult {
  return {
    available: true,
    status: 'valid',
    action: 'approve',
    score: 75,
    poConfidence: null,
    completedAddress: null,
    issues: [],
    suggestions: [],
    extracted: {},
    fieldSource: {},
    rtoRisk: null,
    rtoRiskStatus: 'model_not_ready',
    rechecked: false,
    questions: [],
    providersUsed: [],
    ...over,
  };
}

describe('AddressCheckPanel read-only extras', () => {
  it('credits SOLUSTATION, never the map data behind them (owner, 2026-11-12)', () => {
    // Solustation is who we buy the answer from. Which provider they
    // lean on is their arrangement, and a call agent can only act on
    // "who do I chase when this is wrong" — so their suppliers' names
    // must never reach this panel, whichever one answered.
    const { rerender } = render(<AddressCheckPanel result={result()} readOnly />);
    // Nothing answered at all — nobody to credit.
    expect(screen.queryByText('Solustation')).toBeNull();

    for (const providers of [['OLA'], ['database', 'google'], ['ola', 'google', 'database']]) {
      rerender(<AddressCheckPanel result={result({ providersUsed: providers })} readOnly />);
      expect(screen.getByText('Solustation'), providers.join(',')).toBeTruthy();
      expect(screen.queryByText('Ola Maps'), providers.join(',')).toBeNull();
      expect(screen.queryByText(/google/i), providers.join(',')).toBeNull();
    }
  });

  it('renders question text verbatim, in order, with options as non-buttons', () => {
    render(
      <AddressCheckPanel
        readOnly
        result={result({
          questions: [
            {
              field: 'post_office',
              text: 'Which is your post office?',
              options: ['Raidighi', 'Damkal'],
            },
            { field: 'street', text: 'What is the road name?' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Which is your post office?')).toBeTruthy();
    expect(screen.getByText('What is the road name?')).toBeTruthy();
    expect(screen.getByText('Raidighi')).toBeTruthy();
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText('02')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('does not number a single question', () => {
    render(
      <AddressCheckPanel
        readOnly
        result={result({ questions: [{ field: 'x', text: 'Only one?' }] })}
      />,
    );
    expect(screen.queryByText('01')).toBeNull();
  });
});
