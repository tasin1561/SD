import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { CourierWhatsappSection } from '@/app/(authed)/orders/_components/detail/courier-whatsapp-section';
import { buildFetchMock, renderWithProviders } from './helpers';

const ORDER = '019a0000-0000-7000-8000-000000000001';
const MESSAGES = /orders\/[^/]+\/courier-messages/;

const many = (body: unknown) => Array.from({ length: 4 }, () => ({ status: 200, body }));

const base = {
  enabled: true,
  shipmentId: 's1',
  lastCheckedAt: '2026-11-19T10:00:00Z',
  checking: false,
  pausedUntil: null,
};

describe('client order page: failed-delivery line', () => {
  it('shows attempts, deadline and the remark check above the WhatsApp messages', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: MESSAGES,
        responses: many({
          ...base,
          messages: [{ text: 'We tried to deliver', sentLabel: 'Today', sentAt: null }],
          ndr: {
            open: true,
            attemptsFailed: 1,
            attemptsMax: 3,
            deadlineDays: 2,
            remarkVerified: false,
          },
        }),
      },
    ]);
    renderWithProviders(<CourierWhatsappSection orderId={ORDER} />, { fetchImpl });
    const attempts = await screen.findByText('Attempt 1 of 3 failed');
    expect(screen.getByText('Delhivery deadline: 2 days')).toBeInTheDocument();
    expect(screen.getByText('Remark:')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    // Above the messages, not after them.
    const message = screen.getByText('We tried to deliver');
    expect(
      attempts.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the line on its own when there are no messages yet', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: MESSAGES,
        responses: many({
          ...base,
          messages: [],
          ndr: {
            open: true,
            attemptsFailed: 2,
            attemptsMax: 3,
            deadlineDays: 0,
            remarkVerified: true,
          },
        }),
      },
    ]);
    renderWithProviders(<CourierWhatsappSection orderId={ORDER} />, { fetchImpl });
    expect(await screen.findByText('Attempt 2 of 3 failed')).toBeInTheDocument();
    expect(screen.getByText('Delhivery deadline: under a day')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('draws nothing when there is neither a line nor a message', async () => {
    const fetchImpl = buildFetchMock([
      { match: MESSAGES, responses: many({ ...base, messages: [], ndr: null }) },
    ]);
    const { container } = renderWithProviders(<CourierWhatsappSection orderId={ORDER} />, {
      fetchImpl,
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
