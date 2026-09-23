/**
 * Trace a serial — `(authed)/inventory-units/_components/unit-trace-panel.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. "A barcode gun types
 * the number and presses Enter" (:79): Enter in the Serial field runs the
 * trace, for the chosen seller, with the serial trimmed and URL-encoded
 * exactly as `useUnitTrace` builds it. A restyle must not change that.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnitTracePanel } from '@/app/(authed)/inventory-units/_components/unit-trace-panel';
import { renderWithProviders } from './helpers';
import { requestsTo, scanFetch } from './scan-fetch';

const TRIAGE = {
  generatedAt: '2026-09-23T10:00:00.000Z',
  sellers: [
    {
      sellerId: 'seller-1',
      companyName: 'Menev Store',
      stuckUnits: 0,
      unresolvedDispatched: 0,
      countMismatches: 0,
      needsAttention: 0,
      thresholds: { stuckSlaHours: 48, dispatchedUnresolvedDays: 30 },
    },
  ],
  totalNeedsAttention: 0,
  truncated: false,
  examined: 1,
};

function renderPanel(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<UnitTracePanel />, {
    fetchImpl: scanFetch([
      {
        match: /\/api\/admin\/stock-units\/triage$/,
        method: 'GET',
        reply: { status: 200, body: TRIAGE },
      },
      {
        match: /\/api\/admin\/stock-units\/trace\//,
        method: 'GET',
        reply: { status: 200, body: { unit: null, events: [] } },
      },
    ]),
  });
}

async function chooseSeller(): Promise<void> {
  await screen.findByRole('option', { name: 'Menev Store' });
  const select = screen.getByRole('option', { name: 'Menev Store' }).closest('select');
  if (select === null) throw new Error('seller select not found');
  fireEvent.change(select, { target: { value: 'seller-1' } });
}

describe('unit trace — Enter traces', () => {
  // unit-trace-panel.tsx:80-85, ops-hooks.ts:2436 — Enter requests
  // GET /api/admin/stock-units/trace/{sellerId}/{encodeURIComponent(serial)}.
  it('Enter in the serial field requests the trace, trimmed and encoded', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderPanel();
    await chooseSeller();
    await user.type(screen.getByPlaceholderText('Scan or type'), '  SER 1/A  {Enter}');
    await waitFor(() =>
      expect(requestsTo(fetchImpl, /\/stock-units\/trace\//)).toEqual([
        {
          url: `/api/admin/stock-units/trace/seller-1/${encodeURIComponent('SER 1/A')}`,
          method: 'GET',
          body: undefined,
        },
      ]),
    );
    expect(
      await screen.findByText(/No unit with that serial belongs to this seller/),
    ).toBeInTheDocument();
  });

  // :46, ops-hooks.ts:2433 — typing alone asks nothing; only Enter (or the button) commits.
  it('typing without Enter makes no trace request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderPanel();
    await chooseSeller();
    await user.type(screen.getByPlaceholderText('Scan or type'), 'SER-1');
    await new Promise((r) => setTimeout(r, 50));
    expect(requestsTo(fetchImpl, /\/stock-units\/trace\//)).toEqual([]);
  });

  // ops-hooks.ts:2433 — with no seller chosen, Enter asks nothing (a serial
  // is only unique within one seller).
  it('with no seller chosen, Enter makes no trace request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderPanel();
    await screen.findByRole('option', { name: 'Menev Store' });
    await user.type(screen.getByPlaceholderText('Scan or type'), 'SER-1{Enter}');
    await new Promise((r) => setTimeout(r, 50));
    expect(requestsTo(fetchImpl, /\/stock-units\/trace\//)).toEqual([]);
  });
});
