/**
 * The RTO station's AWB field — `(authed)/warehouse/rto/_components/rto-station.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. Unlike the pack and
 * handover benches, Enter here does NOTHING: receiving a return drives the
 * order to RTO_RECEIVED and starts its inspection, so it stays a deliberate
 * click on "Receive" (a misread digit that silently received the wrong
 * parcel is the worse trade — see the comment at :322-327). A restyle must
 * not wire Enter to submit, nor change the body the click sends.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=receive'),
}));

import { RtoStation } from '@/app/(authed)/warehouse/rto/_components/rto-station';
import { renderWithProviders } from './helpers';
import { scanFetch, writesSeen, type ScanRoute } from './scan-fetch';

const BACKGROUND: ScanRoute[] = [
  {
    match: /\/api\/warehouse\/rto\/awaiting-receipt$/,
    method: 'GET',
    reply: { status: 200, body: { items: [] } },
  },
  {
    match: /\/api\/warehouse\/rto\/shipments$/,
    method: 'GET',
    reply: { status: 200, body: { items: [] } },
  },
  {
    match: /\/api\/warehouse\/rto\/shipments\/[^/]+\/putaway$/,
    method: 'GET',
    reply: { status: 200, body: [] },
  },
  {
    match: /\/api\/warehouse\/rto\/shipments\/[^/]+$/,
    method: 'GET',
    reply: { status: 404, body: { code: 'NOT_FOUND', message: 'Not found' } },
  },
];

const RECEIVED = {
  status: 201,
  body: {
    shipmentId: 'sh-1',
    orderId: 'ord-1',
    orderStatus: 'RTO_RECEIVED',
    rtoReceivedAt: '2026-09-23T10:00:00.000Z',
    alreadyReceived: false,
    holdBooking: { outcome: 'BOOKED', unitsBooked: 1 },
  },
};

function awbField(): HTMLInputElement {
  return screen.getByPlaceholderText('DL12345678') as HTMLInputElement;
}

describe('RTO station — AWB field', () => {
  // rto-station.tsx:216-223 — no onKeyDown: Enter in the AWB field sends nothing.
  it('pressing Enter does NOT receive the parcel', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderWithProviders(<RtoStation />, {
      fetchImpl: scanFetch([
        { match: /\/api\/warehouse\/rto\/receive$/, method: 'POST', reply: RECEIVED },
        ...BACKGROUND,
      ]),
    });
    await user.type(awbField(), 'AWB-RTO-1{Enter}');
    // Give any stray handler a chance to fire before asserting silence.
    await new Promise((r) => setTimeout(r, 50));
    expect(writesSeen(fetchImpl)).toEqual([]);
    expect(awbField().value).toBe('AWB-RTO-1');
  });

  // :228-235, :139-147 — the Receive button POSTs the trimmed AWB, exactly.
  it('clicking Receive POSTs /api/warehouse/rto/receive with { awbNumber }', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderWithProviders(<RtoStation />, {
      fetchImpl: scanFetch([
        { match: /\/api\/warehouse\/rto\/receive$/, method: 'POST', reply: RECEIVED },
        ...BACKGROUND,
      ]),
    });
    await user.type(awbField(), '  AWB-RTO-1  ');
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(() =>
      expect(writesSeen(fetchImpl)).toEqual([
        { url: '/api/warehouse/rto/receive', method: 'POST', body: { awbNumber: 'AWB-RTO-1' } },
      ]),
    );
  });

  // :231 — Receive is disabled until something other than spaces is typed.
  it('Receive is disabled while the AWB field is empty or blank', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RtoStation />, { fetchImpl: scanFetch(BACKGROUND) });
    expect(screen.getByRole('button', { name: 'Receive' })).toBeDisabled();
    await user.type(awbField(), '   ');
    expect(screen.getByRole('button', { name: 'Receive' })).toBeDisabled();
  });
});
