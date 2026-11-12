/**
 * The shared AddressCheckPanel renders EXACTLY what it always did unless a
 * caller opts in.
 *
 * The order detail page turns on `embedded` to drop the duplicated
 * post-office chips. The same component is used by the order forms and the
 * call centre, which must not move by a single node. The snapshot below
 * was recorded against the component BEFORE the opt-in prop existed; it is
 * the proof that adding the prop changed nothing for anyone not using it.
 * (Second test: the opt-in really does dedupe, so the snapshot test is not
 * guarding an option that does nothing.)
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddressCheckPanel, type AddressCheckResult } from '@skydrop/ui/app/address-check';

const RESULT: AddressCheckResult = {
  available: true,
  status: 'needs_review',
  action: 'confirm_with_customer',
  score: 58,
  poConfidence: null,
  completedAddress: null,
  issues: [
    { code: 'no_house', message: 'No house or flat number' },
    { code: 'po_mismatch', message: 'Deonapur is not a post office of 732210' },
  ],
  suggestions: [
    {
      field: 'post_office',
      candidates: ['Krishnapur', 'Nandalalpur', 'Lakshmipur'],
      reason: 'Pincode 732210 covers these post offices',
    },
  ],
  extracted: { house: '12', post_office: 'Deonapur' },
  fieldSource: { house: 'customer', post_office: 'customer' },
  rtoRisk: null,
  rtoRiskStatus: 'model_not_ready',
  rechecked: false,
  questions: [
    {
      field: 'post_office',
      text: 'Which is your post office?',
      options: ['Krishnapur', 'Nandalalpur', 'Lakshmipur'],
    },
  ],
  providersUsed: ['ola'],
};

describe('AddressCheckPanel default output (order forms, call centre)', () => {
  it('read-only default render is unchanged', () => {
    const { container } = render(<AddressCheckPanel result={RESULT} readOnly />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('interactive default render is unchanged', () => {
    const { container } = render(
      <AddressCheckPanel result={RESULT} onApplySuggestion={() => undefined} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('by default the post-office candidates appear twice (the form/call-centre behaviour)', () => {
    render(<AddressCheckPanel result={RESULT} readOnly />);
    expect(screen.getAllByText('Krishnapur')).toHaveLength(2);
  });

  it('with embedded the candidates appear ONCE', () => {
    render(<AddressCheckPanel result={RESULT} readOnly embedded />);
    expect(screen.getAllByText('Krishnapur')).toHaveLength(1);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '58');
  });
});
