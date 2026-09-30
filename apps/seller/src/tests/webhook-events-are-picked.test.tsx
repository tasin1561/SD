/**
 * The subscribed-events field was free text with no vocabulary check.
 *
 * A seller typing `shipment.delivery` or `order.confirm` — close, and
 * wrong — saved cleanly, showed on screen as configured, and matched
 * nothing we ever send. Silently and for ever: an endpoint subscribed
 * to nothing looks exactly like one whose events have not happened
 * yet. The reseller STORE's version of the same screen has picked from
 * the catalogue since RS-5, so one concept had two behaviours.
 *
 * ── THE SHAPE, AND WHY ───────────────────────────────────────────────
 * Not write-validation: a row already holding an unrecognised value
 * would then fail its NEXT save, including a save that does not touch
 * the events — somebody renaming an endpoint blocked by a typo from
 * months ago. So a picker makes a typo UNREPRESENTABLE, and a stored
 * value we do not know is kept, shown as a removable warning chip, and
 * carried through a save untouched.
 *
 * Measured on production first: ZERO rows hold a code outside the
 * catalogue (one endpoint row exists at all, soft-deleted, holding
 * `order.confirmed`). So the chip path has no live data behind it — it
 * is the guarantee that nobody's save breaks, not a migration.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { WebhookFormModal } from '@/app/(authed)/settings/webhooks/_components/webhook-form-modal';
import type { WebhookEndpointView } from '@skydrop/api-client';
import { buildFetchMock, renderWithProviders } from './helpers';

const CATALOGUE = [
  { code: 'order.confirmed', description: 'The customer confirmed the order on the call.' },
  { code: 'shipment.dispatched', description: 'The courier collected the parcel.' },
  { code: 'shipment.delivered', description: 'The parcel was delivered.' },
];

function endpoint(subscribedEvents: string[]): WebhookEndpointView {
  return {
    id: 'wh-1',
    url: 'https://example.com/hook',
    name: 'Ours',
    description: null,
    subscribedEvents,
    isActive: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailureCount: 0,
    autoDisabledAt: null,
    autoDisabledReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mocks(
  extra: Parameters<typeof buildFetchMock>[0] = [],
): ReturnType<typeof buildFetchMock> {
  return buildFetchMock([
    { match: /webhook-endpoints\/events/, responses: [{ status: 200, body: CATALOGUE }] },
    ...extra,
  ]);
}

const noop = (): void => undefined;

describe('webhook events are picked from the catalogue', () => {
  it('offers the catalogue and no way to type a code', async () => {
    renderWithProviders(
      <ToastProvider>
        <WebhookFormModal mode="create" onClose={noop} onSuccess={noop} />
      </ToastProvider>,
      { fetchImpl: mocks() },
    );

    await waitFor(() => expect(screen.getByText('shipment.delivered')).toBeInTheDocument());
    // A typo is now unrepresentable rather than merely detected.
    expect(screen.queryByLabelText(/comma-separated/i)).toBeNull();
    expect(screen.getAllByRole('checkbox').length).toBe(CATALOGUE.length);
  });

  it('reads the SAME list the store screen reads', async () => {
    const fetchImpl = mocks();
    renderWithProviders(
      <ToastProvider>
        <WebhookFormModal mode="create" onClose={noop} onSuccess={noop} />
      </ToastProvider>,
      { fetchImpl },
    );

    await waitFor(() => expect(screen.getByText('shipment.delivered')).toBeInTheDocument());
    // Served from WEBHOOK_EVENT_CATALOGUE, which the store's
    // /store/webhook-endpoints/events imports rather than restating.
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('/api/seller/webhook-endpoints/events'),
    );
  });

  it('keeps a stored code the catalogue does not know, and says what is wrong', async () => {
    renderWithProviders(
      <ToastProvider>
        <WebhookFormModal
          mode="edit"
          endpoint={endpoint(['order.confirmed', 'shipment.delivery'])}
          onClose={noop}
          onSuccess={noop}
        />
      </ToastProvider>,
      { fetchImpl: mocks() },
    );

    await waitFor(() => expect(screen.getByText('shipment.delivery')).toBeInTheDocument());
    expect(screen.getByText(/not one we send/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove shipment\.delivery/ })).toBeInTheDocument();
  });

  it('carries an unrecognised code through a save that never touched it', async () => {
    // The whole reason this is not write-validation: renaming an
    // endpoint must not be blocked — or silently corrected — by a typo
    // made months ago.
    const user = userEvent.setup();
    const fetchImpl = mocks([
      { match: /webhook-endpoints\/wh-1/, responses: [{ status: 200, body: {} }] },
    ]);
    renderWithProviders(
      <ToastProvider>
        <WebhookFormModal
          mode="edit"
          endpoint={endpoint(['order.confirmed', 'shipment.delivery'])}
          onClose={noop}
          onSuccess={noop}
        />
      </ToastProvider>,
      { fetchImpl },
    );

    await waitFor(() => screen.getByText('shipment.delivery'));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/wh-1'));
      expect(patch).toBeDefined();
      const body = JSON.parse(String((patch?.[1] as { body?: unknown }).body)) as {
        subscribedEvents: string[];
      };
      expect(body.subscribedEvents).toContain('shipment.delivery');
      expect(body.subscribedEvents).toContain('order.confirmed');
    });
  });

  it('removes an unrecognised code in one click', async () => {
    const user = userEvent.setup();
    const fetchImpl = mocks([
      { match: /webhook-endpoints\/wh-1/, responses: [{ status: 200, body: {} }] },
    ]);
    renderWithProviders(
      <ToastProvider>
        <WebhookFormModal
          mode="edit"
          endpoint={endpoint(['order.confirmed', 'shipment.delivery'])}
          onClose={noop}
          onSuccess={noop}
        />
      </ToastProvider>,
      { fetchImpl },
    );

    await waitFor(() => screen.getByRole('button', { name: /Remove shipment\.delivery/ }));
    await user.click(screen.getByRole('button', { name: /Remove shipment\.delivery/ }));
    await waitFor(() => expect(screen.queryByText(/not one we send/i)).toBeNull());

    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/wh-1'));
      const body = JSON.parse(String((patch?.[1] as { body?: unknown }).body)) as {
        subscribedEvents: string[];
      };
      expect(body.subscribedEvents).toEqual(['order.confirmed']);
    });
  });
});
