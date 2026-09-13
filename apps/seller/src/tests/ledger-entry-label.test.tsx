/**
 * A staff wallet transfer reaches the seller as ONE line on their ledger:
 * who moved the money and which way, and — beneath it — the reason the
 * member of staff gave. That reason is the only explanation the seller
 * ever gets, so its absence would be a debit nobody can account for.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletEntryDirection } from '@skydrop/db';
import { isWalletCredit } from '@skydrop/ui/status';
import { LedgerEntryLabel } from '@/app/(authed)/wallet/_components/ledger-entry-label';

describe('a staff wallet transfer on the seller’s ledger', () => {
  it('a debit reads "Debited by Skydrop" with the reason beneath it', () => {
    render(
      <LedgerEntryLabel
        direction={WalletEntryDirection.STAFF_DEBIT}
        note="Carton lost by your own forwarder — agreed on the phone"
      />,
    );
    expect(screen.getByText('Debited by Skydrop')).toBeInTheDocument();
    expect(
      screen.getByText('Carton lost by your own forwarder — agreed on the phone'),
    ).toBeInTheDocument();
  });

  it('a credit reads "Credited by Skydrop" with the reason beneath it', () => {
    render(
      <LedgerEntryLabel
        direction={WalletEntryDirection.STAFF_CREDIT}
        note="Goodwill for the delayed September payout"
      />,
    );
    expect(screen.getByText('Credited by Skydrop')).toBeInTheDocument();
    expect(screen.getByText('Goodwill for the delayed September payout')).toBeInTheDocument();
  });

  it('points the money the right way (WAL-1)', () => {
    expect(isWalletCredit(WalletEntryDirection.STAFF_CREDIT)).toBe(true);
    expect(isWalletCredit(WalletEntryDirection.STAFF_DEBIT)).toBe(false);
  });
});
