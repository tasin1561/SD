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
  it('shows the Ola attribution only when providersUsed contains ola (any case)', () => {
    const { rerender } = render(<AddressCheckPanel result={result()} readOnly />);
    expect(screen.queryByText('Ola Maps')).toBeNull();
    rerender(
      <AddressCheckPanel result={result({ providersUsed: ['database', 'google'] })} readOnly />,
    );
    expect(screen.queryByText('Ola Maps')).toBeNull();
    rerender(<AddressCheckPanel result={result({ providersUsed: ['OLA'] })} readOnly />);
    expect(screen.getByText('Ola Maps')).toBeTruthy();
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
