/**
 * "Cancel this order" past the packing window asks Skydrop by ticket
 * (2026-11-15): enabled with no ticket, visible-but-aria-disabled with the
 * reason while one is open, and the dialog raises it once.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { CancelRequestAction } from '../app/(authed)/orders/[id]/_components/cancel-request';
import { fetchFrom, renderAssociateScreen } from './helpers';

const ORDER = '019fad84-7acd-754e-8ee4-43cf858fed83';

describe('CancelRequestAction', () => {
  it('opens the dialog from a live button and shows the ticket once raised', async () => {
    const fetchImpl = fetchFrom({
      [`/store/orders/${ORDER}/cancel-request`]: {
        created: true,
        ticket: { id: 't1', number: 'TK-2026-000042' },
      },
    });
    renderAssociateScreen(
      <CancelRequestAction orderId={ORDER} orderNumber="SD-1" openTicket={null} />,
      { fetchImpl },
    );
    const btn = screen.getByRole('button', { name: /cancel this order/i });
    expect(btn).not.toHaveAttribute('aria-disabled');
    fireEvent.click(btn);
    fireEvent.click(await screen.findByRole('button', { name: /send request/i }));
    await waitFor(() =>
      expect(screen.getByText('Request sent — ticket TK-2026-000042')).toBeInTheDocument(),
    );
  });

  it('is visible but disabled, with the reason, while the ticket is open', () => {
    renderAssociateScreen(
      <CancelRequestAction
        orderId={ORDER}
        orderNumber="SD-1"
        openTicket={{ id: 't1', number: 'TK-2026-000042' }}
      />,
    );
    const btn = screen.getByRole('button', { name: /cancel this order/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Cancel requested — ticket TK-2026-000042 is open'),
    ).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByRole('button', { name: /send request/i })).toBeNull();
  });
});
