/**
 * The dashboard shows the seller's balance, and shows exactly ONE.
 *
 * The wallet endpoint returns the rupee balance AND the same money
 * restated in taka (`isConverted: true`). The wallet page renders both
 * and needs three paragraphs of caption to stop them reading as two
 * balances — a summary card has no room for that argument, so it must
 * pick the one that is real.
 *
 * Getting this wrong does not throw and does not look broken: it shows
 * a plausible number that is the balance multiplied by the FX rate.
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
  it('shows the canonical figure and NOT its restatement', () => {
    render(<WalletBalanceCard query={q({ data: BOTH })} />);
    expect(screen.getByText(/3,600/)).toBeInTheDocument();
    // The taka figure is the same money counted again. Two numbers on a
    // summary card read as two balances.
    expect(screen.queryByText(/4,428/)).not.toBeInTheDocument();
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
