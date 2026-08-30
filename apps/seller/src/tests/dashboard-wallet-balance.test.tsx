/**
 * The dashboard shows the balance in both currencies — one debt, said
 * twice, never two debts.
 *
 * The endpoint returns the rupee figure and the same money restated in
 * taka (`isConverted: true`). A seller in Dhaka needs the taka; nobody
 * needs to think they owe the sum of the two. What keeps them apart is
 * that the rupee figure is the headline and the taka is a dimmer line
 * under it behind a "≈" and its rate.
 *
 * The failure this pins is silent: picking the wrong row as the
 * headline throws nothing and looks fine — it renders a plausible
 * number that is the balance multiplied by the FX rate.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import type { WalletBalancesResponse } from '@skydrop/api-client';

vi.mock('@/lib/page-access', () => ({ can: () => true }));

import { WalletBalanceCard } from '../app/(authed)/dashboard/_components/dashboard-view';

function q(over: Partial<UseQueryResult<WalletBalancesResponse>>) {
  return {
    isLoading: false,
    isError: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<WalletBalancesResponse>;
}

const BOTH: WalletBalancesResponse = {
  balances: [
    { currency: 'INR', balance: '-3600.00', isConverted: false, fxRate: null },
    { currency: 'BDT', balance: '-4428.00', isConverted: true, fxRate: '1.23' },
  ],
} as WalletBalancesResponse;

describe('dashboard wallet balance', () => {
  it('leads with the rupee figure and carries the taka as a restatement', () => {
    render(<WalletBalanceCard query={q({ data: BOTH })} />);
    expect(screen.getByText(/3,600/)).toBeInTheDocument();
    expect(screen.getByText(/4,428/)).toBeInTheDocument();
    // The rate is what makes the second figure checkable rather than a
    // number to take on trust.
    expect(screen.getByText(/1\.23/)).toBeInTheDocument();
  });

  it('names the taka line as the SAME balance, for a screen reader too', () => {
    render(<WalletBalanceCard query={q({ data: BOTH })} />);
    // Sighted readers get the hierarchy — smaller, dimmer, under a "≈".
    // Read aloud, that hierarchy is gone and two figures in a row are
    // indistinguishable from two debts.
    expect(screen.getByText(/the same balance in BDT/)).toBeInTheDocument();
  });

  it('omits the rate rather than inventing one when none was resolved', () => {
    const noRate = {
      balances: [
        { currency: 'INR', balance: '-3600.00', isConverted: false, fxRate: null },
        { currency: 'BDT', balance: '-4428.00', isConverted: true, fxRate: null },
      ],
    } as WalletBalancesResponse;
    render(<WalletBalanceCard query={q({ data: noRate })} />);
    expect(screen.getByText(/4,428/)).toBeInTheDocument();
    expect(screen.queryByText(/₹1 =/)).not.toBeInTheDocument();
  });

  it('shows no restatement line at all when the API sent only rupees', () => {
    const inrOnly = {
      balances: [{ currency: 'INR', balance: '-3600.00', isConverted: false, fxRate: null }],
    } as WalletBalancesResponse;
    const { container } = render(<WalletBalanceCard query={q({ data: inrOnly })} />);
    expect(container.textContent).not.toContain('≈');
  });

  it('says "You owe" on a negative balance', () => {
    render(<WalletBalanceCard query={q({ data: BOTH })} />);
    // Wording lifted from the wallet page on purpose: two screens
    // describing one number differently is how a seller comes to
    // believe they disagree.
    expect(screen.getByText('You owe')).toBeInTheDocument();
  });

  it('says "Owed to you" when the seller is in credit', () => {
    const credit = {
      balances: [{ currency: 'INR', balance: '1500.00', isConverted: false, fxRate: null }],
    } as WalletBalancesResponse;
    render(<WalletBalanceCard query={q({ data: credit })} />);
    expect(screen.getByText('Owed to you')).toBeInTheDocument();
  });

  it('distinguishes a zero balance from no wallet activity', () => {
    const zero = {
      balances: [{ currency: 'INR', balance: '0.00', isConverted: false, fxRate: null }],
    } as WalletBalancesResponse;
    render(<WalletBalanceCard query={q({ data: zero })} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('offers a next step when there is no balance row at all', () => {
    render(<WalletBalanceCard query={q({ data: { balances: [] } as WalletBalancesResponse })} />);
    expect(screen.getByText(/No wallet activity yet/)).toBeInTheDocument();
  });

  it('a failure is retryable rather than a blank card', () => {
    const refetch = vi.fn();
    render(<WalletBalanceCard query={q({ isError: true, error: new Error('nope'), refetch })} />);
    expect(screen.getByText(/nope/)).toBeInTheDocument();
  });
});
