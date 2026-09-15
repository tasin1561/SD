/**
 * FE-2 boundary — settling a reseller store ↔ seller dispute (RS-7).
 *
 * The form could decide for itself whether the amount is "valid" or the
 * ticket still open. It must not: the server owns both, and its verdict
 * is rendered exactly as it came. Pinned here, together with the body the
 * request carries (payer and amount as the operator chose them).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreDisputeSettle } from '@/app/(authed)/tickets/_components/store-dispute-settle';
import { buildFetchMock, renderWithProviders, makeStaff } from './helpers';

const TICKET = '019fad84-7acd-754e-8ee4-43cf858fed99';

describe('FE-2 boundary — store dispute settlement', () => {
  it('a refusal from the SERVER renders VERBATIM, after the request was made', async () => {
    const user = userEvent.setup();
    const rejection = {
      code: 'TICKET_ALREADY_MOVED',
      message:
        'Ticket TK-2026-000042 is no longer OPEN — someone else settled or closed it first. Reload to see where it landed; no money moved for this request.',
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/store-dispute-settlement$/,
        responses: [{ status: 409, body: rejection }],
      },
    ]);

    renderWithProviders(<StoreDisputeSettle ticketId={TICKET} storeName="Kolkata Kurtis" />, {
      fetchImpl,
      identity: makeStaff(),
    });

    await user.selectOptions(screen.getByLabelText(/who pays/i), 'STORE');
    await user.type(screen.getByLabelText(/amount/i), '450.00');
    await user.click(screen.getByRole('button', { name: /^settle$/i }));
    // The confirm dialog carries its own Settle button.
    const buttons = await screen.findAllByRole('button', { name: /^settle$/i });
    await user.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => /store-dispute-settlement$/.test(String(c[0])))).toBe(
        true,
      );
    });
    const call = fetchImpl.mock.calls.find((c) => /store-dispute-settlement$/.test(String(c[0])));
    const init = call?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({ payer: 'STORE', amountInr: '450.00' });

    expect(
      await screen.findByText(`[${rejection.code}] ${rejection.message}`, { exact: false }),
    ).toBeInTheDocument();
  });

  it('an amount the UI might think is wrong is still ASKED of the server', async () => {
    const user = userEvent.setup();
    const rejection = {
      code: 'SETTLEMENT_AMOUNT_INVALID',
      message: 'The amount must be more than ₹0, with at most two decimal places.',
    };
    const fetchImpl = buildFetchMock([
      { match: /\/store-dispute-settlement$/, responses: [{ status: 400, body: rejection }] },
    ]);
    renderWithProviders(<StoreDisputeSettle ticketId={TICKET} storeName={null} />, {
      fetchImpl,
      identity: makeStaff(),
    });

    await user.selectOptions(screen.getByLabelText(/who pays/i), 'SELLER');
    await user.type(screen.getByLabelText(/amount/i), '0.001');
    await user.click(screen.getByRole('button', { name: /^settle$/i }));
    const buttons = await screen.findAllByRole('button', { name: /^settle$/i });
    await user.click(buttons[buttons.length - 1] as HTMLElement);

    expect(
      await screen.findByText(`[${rejection.code}] ${rejection.message}`, { exact: false }),
    ).toBeInTheDocument();
  });
});
