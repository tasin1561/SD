/**
 * One client's settings (`seller-settings-section.tsx`).
 *
 * The page used to list every setting, most of them on their default.
 * It now opens on what is CHANGED for this client. What must hold: the
 * changed ones are shown first, nothing is lost (All settings shows the
 * rest), a search finds a setting by its plain name or its key whichever
 * list is open, and a client with nothing changed sees every setting.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from './helpers';

const state = vi.hoisted(() => ({ overridden: true }));

vi.mock('@/lib/use-permission', () => ({ usePermission: () => true }));
vi.mock('@/app/(authed)/sellers/_components/seller-settings-hooks', () => {
  const idle = {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  };
  return {
    useSetOverride: () => idle,
    useClearOverride: () => idle,
    useSellerSettings: () => ({
      isLoading: false,
      isError: false,
      data: [
        {
          key: 'pricing.flat_delivery_fee',
          valueType: 'DECIMAL',
          value: state.overridden ? '79.00' : '85.00',
          source: state.overridden ? 'SELLER_OVERRIDE' : 'SYSTEM_DEFAULT',
          systemDefault: '85.00',
        },
        {
          key: 'wallet.withdrawal_max_per_day',
          valueType: 'INTEGER',
          value: 1,
          source: 'SYSTEM_DEFAULT',
          systemDefault: 1,
        },
        {
          key: 'ops.stock_reservation_ttl_hours',
          valueType: 'INTEGER',
          value: 48,
          source: 'SYSTEM_DEFAULT',
          systemDefault: 48,
        },
      ],
    }),
  };
});

import { SellerSettingsSection } from '@/app/(authed)/sellers/_components/seller-settings-section';

const KEYS = [
  'pricing.flat_delivery_fee',
  'wallet.withdrawal_max_per_day',
  'ops.stock_reservation_ttl_hours',
];

const keysShown = (): string[] =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => KEYS.find((k) => (r.textContent ?? '').includes(k)) ?? '?');

describe('one client’s settings', () => {
  it('opens on what is changed for this client, with the rest one tap away', async () => {
    state.overridden = true;
    const user = userEvent.setup();
    renderWithProviders(<SellerSettingsSection sellerId="s1" />);
    expect(keysShown()).toEqual(['pricing.flat_delivery_fee']);
    await user.click(screen.getByRole('button', { name: /All settings/ }));
    expect(keysShown()).toHaveLength(3);
  });

  it('finds a setting by its key or its plain name, even one on its default', async () => {
    state.overridden = true;
    const user = userEvent.setup();
    renderWithProviders(<SellerSettingsSection sellerId="s1" />);
    await user.type(screen.getByLabelText('Find a setting'), 'reservation');
    expect(keysShown()).toEqual(['ops.stock_reservation_ttl_hours']);
    await user.clear(screen.getByLabelText('Find a setting'));
    await user.type(screen.getByLabelText('Find a setting'), 'withdrawals allowed per day');
    expect(keysShown()).toEqual(['wallet.withdrawal_max_per_day']);
  });

  it('shows every setting when nothing is changed for this client', () => {
    state.overridden = false;
    renderWithProviders(<SellerSettingsSection sellerId="s1" />);
    expect(keysShown()).toHaveLength(3);
  });
});
