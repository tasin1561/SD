import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { InstantPayAdvances } from '../app/(authed)/liabilities/instant-pay/_components/instant-pay-advances';
import { buildFetchMock, renderWithProviders } from './helpers';

/**
 * The drill-down behind "Instant Pay: advanced to sellers, awaiting
 * courier" — the answer to "which sellers did we pay in advance, and who
 * owes us for it".
 */

const row = (over: Record<string, unknown>) => ({
  orderId: 'o1',
  orderNumber: 'SD-2026-26-000007',
  sellerId: 's1',
  sellerName: 'Menev Store',
  deliveredAt: '2026-09-08T10:00:00.000Z',
  creditedAt: '2026-09-08T10:00:00.000Z',
  codInr: '1180.00',
  netCreditedInr: '975.00',
  frontedInr: '550.00',
  frontAccountId: 'b1',
  frontAccountLabel: 'HDFC current',
  courierCode: 'delhivery',
  courierAccountId: 'ca1',
  courierAccountLabel: 'Delhivery main',
  ageDays: 4,
  ...over,
});

const report = (rows: ReturnType<typeof row>[]) => ({
  rows,
  count: rows.length,
  totalCodInr: '1580.00',
  totalNetCreditedInr: '1375.00',
  totalFrontedInr: '950.00',
  bySeller: [
    {
      key: 's1',
      label: 'Menev Store',
      count: rows.length,
      codInr: '1580.00',
      frontedInr: '950.00',
    },
  ],
  byCourierAccount: [
    {
      key: 'ca1',
      label: 'Delhivery main',
      count: rows.length,
      codInr: '1580.00',
      frontedInr: '950.00',
    },
  ],
});

describe('Instant Pay advances list', () => {
  it('lists every advance, oldest first, with what we fronted and who owes it', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/treasury\/instant-pay-advances/,
        responses: [
          {
            status: 200,
            body: report([
              row({}),
              row({
                orderId: 'o2',
                orderNumber: 'SD-2026-26-000009',
                ageDays: 11,
                codInr: '400.00',
              }),
            ]),
          },
        ],
      },
    ]);
    renderWithProviders(<InstantPayAdvances initialSellerId="" initialCourierAccountId="" />, {
      fetchImpl,
    });

    await waitFor(() => expect(screen.getByText('SD-2026-26-000007')).toBeInTheDocument());
    const older = screen.getByText('SD-2026-26-000009');
    const newer = screen.getByText('SD-2026-26-000007');
    // The courier has sat on the 11-day one longest — it leads.
    expect(older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('HDFC current').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delhivery main').length).toBeGreaterThan(0);
  });

  it('says there is nothing outstanding, and where to look next, when the list is empty', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/treasury\/instant-pay-advances/,
        responses: [{ status: 200, body: report([]) }],
      },
    ]);
    renderWithProviders(<InstantPayAdvances initialSellerId="" initialCourierAccountId="" />, {
      fetchImpl,
    });
    await waitFor(() =>
      expect(screen.getByText(/has been paid by its courier/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'See courier payouts' })).toBeInTheDocument();
  });

  it('passes the seller filter it was opened with to the server', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/treasury\/instant-pay-advances/,
        responses: [
          { status: 200, body: report([row({})]) },
          { status: 200, body: report([row({})]) },
        ],
      },
    ]);
    renderWithProviders(
      <InstantPayAdvances
        initialSellerId="0192f000-0000-7000-8000-000000000001"
        initialCourierAccountId=""
      />,
      { fetchImpl },
    );
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([url]) =>
          String(url).includes('sellerId=0192f000-0000-7000-8000-000000000001'),
        ),
      ).toBe(true),
    );
  });
});
