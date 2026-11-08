/**
 * Automatic confirmation calls: the setting and the awaiting list.
 *
 * What is pinned is honesty. The TTL field cannot be edited while calls are on,
 * the 1-168 bound is on screen before anyone submits, the send posts exactly
 * the ticked orders, a mixed result is reported as a mixed result, and the
 * empty list says WHY it is empty.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { ToastProvider } from '@skydrop/ui/app/toast';
import { CallConfirmationPanel } from '@/app/(authed)/settings/orders/_components/call-confirmation-panel';
import { AwaitingConfirmationIndex } from '@/app/(authed)/orders/awaiting-confirmation/_components/awaiting-confirmation-index';
import { buildFetchMock, renderWithProviders } from './helpers';

const SETTING = /order-defaults\/confirmation-calls/;
const LIST = /orders\/awaiting-confirmation/;
const SEND = /orders\/confirmation-calls/;

function row(n: number, hoursLeft: number) {
  return {
    id: `o${n}`,
    orderNumber: `SD-${n}`,
    recipientName: `Person ${n}`,
    recipientCity: 'Kolkata',
    codAmountInr: '999.00',
    itemCount: 2,
    createdAt: '2026-11-08T05:00:00.000Z',
    confirmationDeadlineAt: new Date(Date.now() + hoursLeft * 3_600_000).toISOString(),
  };
}
const many = <T,>(body: T, n = 6) => Array.from({ length: n }, () => ({ status: 200, body }));
const page = (items: ReturnType<typeof row>[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});

describe('call confirmation setting', () => {
  it('disables the TTL field while calls are on and shows the bound before submit', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: true, ttlHours: 24, isOwnValue: false }) },
    ]);
    renderWithProviders(
      <ToastProvider>
        <CallConfirmationPanel />
      </ToastProvider>,
      { fetchImpl },
    );
    const ttl = await screen.findByLabelText(/auto-confirm after/i);
    expect(ttl).toBeDisabled();
    expect(screen.getByText(/from 1 to 168/i)).toBeInTheDocument();
    expect(screen.getByText(/charged to you at the usual RTO fee/i)).toBeInTheDocument();
  });

  it('enables the TTL field once calls are off', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: false, ttlHours: 48, isOwnValue: true }) },
    ]);
    renderWithProviders(
      <ToastProvider>
        <CallConfirmationPanel />
      </ToastProvider>,
      { fetchImpl },
    );
    const ttl = await screen.findByLabelText(/auto-confirm after/i);
    await waitFor(() => expect(ttl).toBeEnabled());
    expect(ttl).toHaveValue(48);
  });
});

describe('awaiting confirmation list', () => {
  it('posts exactly the ticked orders and reports a mixed result honestly', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: false, ttlHours: 24, isOwnValue: true }) },
      { match: LIST, responses: many(page([row(1, 1), row(2, 5), row(3, 30)])) },
      {
        match: SEND,
        responses: [
          {
            status: 200,
            body: {
              results: [
                { orderId: 'o1', outcome: 'QUEUED' },
                { orderId: 'o2', outcome: 'ALREADY_QUEUED' },
              ],
            },
          },
        ],
      },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { fetchImpl });
    fireEvent.click(await screen.findByLabelText('Select order SD-1'));
    fireEvent.click(screen.getByLabelText('Select order SD-2'));
    fireEvent.click(screen.getByRole('button', { name: 'Send for confirmation call' }));

    const status = await screen.findByText('1 sent, 1 already queued');
    expect(status).toBeInTheDocument();
    const call = fetchImpl.mock.calls.find((c) => SEND.test(String(c[0])));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ orderIds: ['o1', 'o2'] });
  });

  it('shows a refusal with the server code and message verbatim', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: false, ttlHours: 24, isOwnValue: true }) },
      { match: LIST, responses: many(page([row(1, 1), row(2, 5)])) },
      {
        match: SEND,
        responses: [
          {
            status: 200,
            body: {
              results: [
                { orderId: 'o1', outcome: 'QUEUED' },
                {
                  orderId: 'o2',
                  outcome: 'FAILED',
                  message: 'Queue unavailable.',
                },
              ],
            },
          },
        ],
      },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { fetchImpl });
    fireEvent.click(await screen.findByLabelText('Select all orders on this page'));
    fireEvent.click(screen.getByRole('button', { name: 'Send for confirmation call' }));
    expect(await screen.findByText('1 sent, 1 not sent')).toBeInTheDocument();
    expect(screen.getByText(/\[FAILED\] Queue unavailable\./)).toBeInTheDocument();
  });

  it('marks near-expiry rows with a word and an absolute time on the element', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: false, ttlHours: 24, isOwnValue: true }) },
      { match: LIST, responses: many(page([row(1, 1), row(3, 30)])) },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { fetchImpl });
    const urgent = (await screen.findAllByText(/Auto-confirms in/))[0]!.closest('time')!;
    expect(urgent).toHaveAttribute('data-urgency', 'urgent');
    expect(within(urgent).getByText('Urgent')).toBeInTheDocument();
    expect(urgent.getAttribute('title')).toMatch(/Auto-confirms at/);
  });

  it('says calls are on, with a link to the setting, when the list is empty and calls are on', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: true, ttlHours: 24, isOwnValue: false }) },
      { match: LIST, responses: many(page([])) },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { fetchImpl });
    expect(await screen.findByText('Confirmation calls are on')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /open order settings/i })[0]).toHaveAttribute(
      'href',
      '/settings/orders',
    );
  });

  it('says nothing is waiting, not that calls are on, when calls are off', async () => {
    const fetchImpl = buildFetchMock([
      { match: SETTING, responses: many({ callsRequired: false, ttlHours: 24, isOwnValue: true }) },
      { match: LIST, responses: many(page([])) },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { fetchImpl });
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument();
    expect(screen.queryByText('Confirmation calls are on')).not.toBeInTheDocument();
  });
});
