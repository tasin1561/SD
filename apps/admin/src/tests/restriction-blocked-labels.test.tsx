/**
 * "Blocked: …" on a standing account hold.
 *
 * The dialog that PLACES a hold has always offered "Placing new orders"
 * and "Handing their parcels to the courier"; the card that reports one
 * printed `ORDER_CREATE` — the raw database value — to the same
 * operator, about the same decision, three inches further down the same
 * page. A hold's whole job is to be explicable to the seller on the
 * telephone, and nothing failed: the figures beside it were right, the
 * reason beside THAT was right, and a string is a string to typecheck.
 * Found by filming it (O2, 2026-10-01).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@skydrop/ui/app/toast';

const HOLD = {
  id: 'rest-1',
  blockedCapabilities: ['ORDER_CREATE', 'SHIPMENT_DISPATCH'],
  clearAtBalanceInr: '0.00',
  balanceInr: '-18400.00',
  shortfallInr: '18400.00',
  reason: 'August courier charges are unpaid.',
  createdAt: '2026-10-01T06:30:00.000Z',
};

const idle = { isPending: false, mutateAsync: vi.fn() };

vi.mock('@/lib/restriction-hooks', () => ({
  useSellerRestriction: () => ({ data: HOLD }),
  useApplyRestriction: () => idle,
  useLiftRestriction: () => idle,
}));

import {
  RestrictionPanel,
  capabilityLabel,
} from '../app/(authed)/sellers/_components/restriction-panel';

function open(): void {
  render(
    <ToastProvider>
      <RestrictionPanel sellerId="seller-1" canManage />
    </ToastProvider>,
  );
}

describe('a hold that is standing', () => {
  it('names what is blocked in the words the dialog used to choose it', () => {
    open();
    const line = screen.getByText(/^Blocked:/);
    expect(line.textContent ?? '').toContain('Placing new orders');
    expect(line.textContent ?? '').toContain('Handing their parcels to the courier');
  });

  it('does not print the raw enum value', () => {
    open();
    const line = screen.getByText(/^Blocked:/);
    expect(line.textContent ?? '').not.toContain('ORDER_CREATE');
    expect(line.textContent ?? '').not.toContain('SHIPMENT_DISPATCH');
  });

  /*
    A capability the two lists do not know about is SHOWN rather than
    swallowed. There is no such value today — the enum has seven and
    both lists are complete — but a hold nobody can read is strictly
    better than a hold that appears to block nothing.
  */
  it('falls back to the raw code for a capability it has no name for', () => {
    expect(capabilityLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
