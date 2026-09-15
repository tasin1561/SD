import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WithdrawCard } from '../app/(authed)/wallet/_components/withdraw-card';
import { renderStoreScreen } from './helpers';
import type { StoreWalletSummary } from '@/lib/store-wallet-hooks';

/**
 * Asking to be paid is a money form, so two things are pinned here.
 *
 * The CONFIRM: nothing is sent on the first click — a mistyped account
 * number is money sent to a stranger, and the confirmation is where the
 * payee and the amount are read back.
 *
 * IDEM-1: the key is minted when the card mounts and REUSED on a retry of
 * the same request, so a refusal the person corrects and resends does not
 * become two withdrawals.
 */

const SUMMARY = {
  storeId: '019fad84-0000-7000-8000-000000000002',
  storeName: 'Kurta Corner',
  displayName: null,
  sellerId: '019fad84-0000-7000-8000-000000000003',
  sellerCompanyName: 'Menev Store',
  walletManagedBy: 'SKYDROP',
  balanceInr: '5000.00',
  withdrawableInr: '4000.00',
  negativeLimit: { ownInr: '0.00', capInr: '25000.00', effectiveInr: '0.00' },
  pendingTopups: { count: 0, amountInr: '0.00' },
  pendingWithdrawals: { count: 0, amountInr: '0.00' },
} as StoreWalletSummary;

// `required` puts an asterisk inside the <label>, so these match by prefix.
function fill(): void {
  fireEvent.change(screen.getByLabelText(/^Amount/, { selector: 'input' }), {
    target: { value: '1500' },
  });
  fireEvent.change(screen.getByLabelText(/^Name on the account/, { selector: 'input' }), {
    target: { value: 'Kurta Corner' },
  });
  fireEvent.change(screen.getByLabelText(/^Account number/, { selector: 'input' }), {
    target: { value: '123456789' },
  });
  fireEvent.change(screen.getByLabelText(/^IFSC/, { selector: 'input' }), {
    target: { value: 'HDFC0001234' },
  });
  fireEvent.change(screen.getByLabelText(/^Bank$|^Bank\*/, { selector: 'input' }), {
    target: { value: 'HDFC Bank' },
  });
}

/** The dialog's confirm carries the same words as the form's submit. */
async function confirm(): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to withdraw' }));
}

function bodyOf(call: readonly unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string };
  return JSON.parse(init.body ?? '{}') as Record<string, unknown>;
}

describe('store withdrawal — confirm first, one key', () => {
  it('asks before sending, naming the amount and the payee', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 'w-1' }), { status: 201 }),
    );
    renderStoreScreen(<WithdrawCard summary={SUMMARY} />, { fetchImpl });
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to withdraw' }));

    // The confirmation is up — naming the payee and the account — and
    // NOTHING has been sent yet. (The title is several nodes: a Money
    // primitive sits inside it, so it is read off the dialog itself.)
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Ask Skydrop to pay');
    expect(dialog.textContent).toContain('Kurta Corner · 123456789');
    expect(fetchImpl).not.toHaveBeenCalled();

    await confirm();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = bodyOf(fetchImpl.mock.calls[0] as readonly unknown[]);
    expect(body.amountInr).toBe('1500');
    expect(body.payeeAccountNumber).toBe('123456789');
    expect(typeof body.idempotencyKey).toBe('string');
  });

  it('reuses the same idempotency key when the first attempt is refused', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: 'STORE_WITHDRAWAL_EXCEEDS_WITHDRAWABLE', message: 'Too much.' }),
          { status: 400 },
        ),
    );
    renderStoreScreen(<WithdrawCard summary={SUMMARY} />, { fetchImpl });
    fill();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Ask to withdraw' })[0] as HTMLElement);
      await confirm();
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    }

    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    const keys = fetchImpl.mock.calls.map((c) => bodyOf(c as readonly unknown[]).idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    // FE-2: the server's own words, code first.
    expect(screen.getByRole('alert')).toHaveTextContent(
      '[STORE_WITHDRAWAL_EXCEEDS_WITHDRAWABLE] Too much.',
    );
  });
});
