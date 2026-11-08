/**
 * Orders awaiting confirmation (across every client).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AwaitingConfirmationIndex } from '@/app/(authed)/call-center/awaiting-confirmation/_components/awaiting-confirmation-index';
import { readOutcomes, remainingUntil } from '@/lib/confirmation-hooks';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const NOW = Date.now();
const inHours = (h: number): string => new Date(NOW + h * 3_600_000).toISOString();

function row(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: id,
    orderNumber: `SD-${id}`,
    clientName: 'Acme Traders',
    recipientName: 'Ravi',
    recipientCity: 'Pune',
    codAmount: '1299.00',
    itemCount: 2,
    createdAt: inHours(-5),
    confirmationDeadlineAt: inHours(2.5),
    callsRequired: false,
    ...over,
  };
}
const PAGE = (items: unknown[]): unknown => ({ items, total: items.length, page: 1, pageSize: 20 });
const WITH = makeStaff(['SUPER_ADMIN'], ['callcenter.queue.manage']);

describe('AwaitingConfirmationIndex', () => {
  it('renders nothing without the permission', () => {
    const { container } = renderWithProviders(<AwaitingConfirmationIndex />, {
      identity: makeStaff(['CALL_AGENT'], ['orders.view']),
    });
    expect(container.querySelector('.aw-page')).toBeNull();
    expect(screen.queryByRole('button', { name: /send for confirmation call/i })).toBeNull();
  });

  it('says honestly when no client has calls off', async () => {
    const fetchImpl = buildFetchMock([
      { match: /awaiting-confirmation/, responses: [{ status: 200, body: PAGE([]) }] },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { identity: WITH, fetchImpl });
    expect(
      await screen.findByText(/No client has phone confirmation switched off/i),
    ).toBeInTheDocument();
  });

  it('shows time remaining in words with the absolute time, not colour alone', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /awaiting-confirmation/,
        responses: [
          {
            status: 200,
            body: PAGE([row('1'), row('2', { confirmationDeadlineAt: inHours(-1) })]),
          },
        ],
      },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { identity: WITH, fetchImpl });
    expect(await screen.findByText(/Auto-confirms in 2h/)).toBeInTheDocument();
    expect(screen.getByText(/Under 3 hours left/)).toBeInTheDocument();
    expect(screen.getByText(/Auto-confirm due now/)).toBeInTheDocument();
    expect(screen.getAllByText(/^at /).length).toBe(2);
  });

  it('posts exactly the selected ids, then reports a partial result honestly', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /awaiting-confirmation/,
        responses: [
          { status: 200, body: PAGE([row('1'), row('2'), row('3')]) },
          { status: 200, body: PAGE([row('3')]) },
        ],
      },
      {
        match: /confirmation-calls/,
        responses: [
          {
            status: 200,
            body: {
              results: [
                { orderId: '1', outcome: 'QUEUED' },
                { orderId: '2', outcome: 'ALREADY_QUEUED' },
              ],
            },
          },
        ],
      },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { identity: WITH, fetchImpl });
    await screen.findByText('SD-1');
    await user.click(screen.getByLabelText('Select SD-1'));
    await user.click(screen.getByLabelText('Select SD-2'));
    await user.click(screen.getByRole('button', { name: /send for confirmation call/i }));

    await waitFor(() => {
      const post = fetchImpl.mock.calls.find((c) => /confirmation-calls/.test(String(c[0])));
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ orderIds: ['1', '2'] });
    });
    const status = await screen.findByText(/1 sent, 1 already queued, 0 not sent/);
    expect(status).toBeInTheDocument();
    // Re-fetched from the server, nothing optimistic.
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.filter((c) => /awaiting-confirmation/.test(String(c[0]))).length,
      ).toBe(2),
    );
  });

  it('lists a refused order with the server verdict verbatim', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /awaiting-confirmation/,
        responses: [
          { status: 200, body: PAGE([row('1')]) },
          { status: 200, body: PAGE([row('1')]) },
        ],
      },
      {
        match: /confirmation-calls/,
        responses: [
          {
            status: 200,
            body: [
              {
                orderId: '1',
                outcome: 'REJECTED',
                code: 'ORDER_NOT_WAITING',
                message: 'order already left the wait',
              },
            ],
          },
        ],
      },
    ]);
    renderWithProviders(<AwaitingConfirmationIndex />, { identity: WITH, fetchImpl });
    await screen.findByText('SD-1');
    await user.click(screen.getByLabelText('Select SD-1'));
    await user.click(screen.getByRole('button', { name: /send for confirmation call/i }));
    const region = await screen.findByText(/Nothing was sent/);
    expect(region).toBeInTheDocument();
    expect(
      within(region.closest('.aw-result') as HTMLElement).getByText(
        /\[ORDER_NOT_WAITING\] order already left the wait/,
      ),
    ).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('buckets outcomes', () => {
    expect(
      readOutcomes({
        results: [
          { orderId: 'a', outcome: 'queued' },
          { orderId: 'b', outcome: 'already_queued' },
          { orderId: 'c', outcome: 'x', code: 'E' },
        ],
      }).map((r) => r.kind),
    ).toEqual(['sent', 'already', 'failed']);
  });
  it('grades urgency', () => {
    expect(remainingUntil(inHours(1), NOW).level).toBe('urgent');
    expect(remainingUntil(inHours(8), NOW).level).toBe('soon');
    expect(remainingUntil(inHours(30), NOW).level).toBe('calm');
    expect(remainingUntil(inHours(-1), NOW).level).toBe('overdue');
  });
});
