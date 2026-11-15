/**
 * "Cancel order" past the packing window asks Skydrop by ticket (2026-11-15).
 *
 * Pinned: the button is enabled with no ticket, visible-but-aria-disabled with
 * the reason line while one is open, pressing it does nothing then, and the
 * dialog posts once and shows the ticket link.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { ToastProvider } from '@skydrop/ui/app/toast';
import {
  CancelRequestButton,
  CancelRequestDialog,
} from '@/app/(authed)/orders/_components/cancel-request';
import { buildFetchMock, renderWithProviders } from './helpers';

describe('CancelRequestButton', () => {
  it('is a live button while no cancel ticket is open', () => {
    const onClick = vi.fn();
    renderWithProviders(<CancelRequestButton openTicket={null} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /cancel order/i });
    expect(btn).not.toHaveAttribute('aria-disabled');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('stays visible but disabled, with the reason, while the ticket is open', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <CancelRequestButton openTicket={{ id: 't1', number: 'TK-2026-000042' }} onClick={onClick} />,
    );
    const btn = screen.getByRole('button', { name: /cancel order/i });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Cancel requested — ticket TK-2026-000042 is open'),
    ).toBeInTheDocument();
    expect(btn).toHaveAccessibleDescription('Cancel requested — ticket TK-2026-000042 is open');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('CancelRequestDialog', () => {
  it('raises the ticket once and shows its number and link', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /orders\/o1\/cancel-request/,
        responses: [
          { status: 200, body: { created: true, ticket: { id: 't1', number: 'TK-2026-000042' } } },
        ],
      },
    ]);
    renderWithProviders(
      <ToastProvider>
        <CancelRequestDialog open orderId="o1" orderNumber="SD-1" onOpenChange={() => undefined} />
      </ToastProvider>,
      { fetchImpl },
    );
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() =>
      expect(screen.getByText('Request sent — ticket TK-2026-000042')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /view ticket/i })).toHaveAttribute(
      'href',
      '/tickets/t1',
    );
    const posts = fetchImpl.mock.calls.filter(
      ([, init]) => (init as RequestInit)?.method === 'POST',
    );
    expect(posts).toHaveLength(1);
  });
});
