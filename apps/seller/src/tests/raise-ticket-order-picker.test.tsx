/**
 * "Raise an issue" asked a seller for an order's UUID.
 *
 * The field's own hint said "copy the ID from the order page" — and
 * that page shows a NUMBER, SD-2026-26-000365. So the instruction
 * described something the seller could not do, and the field was
 * fillable only by somebody who knew to read a URL or open dev tools.
 * In practice it stayed empty, which is the worse outcome: an issue
 * raised with no order on it is one nobody can act on without a reply
 * asking which parcel it was about.
 *
 * ── PICKER, NOT A WIDER LOOKUP ───────────────────────────────────────
 * The obvious fix is to accept the number too. `TicketService.open`'s
 * scoped order lookup is the TENANT boundary and is shared by five
 * callers, four of which already hand it a uuid resolved by their own
 * scoped read — so widening it would put a second definition of "which
 * order is this" into a security-relevant query, reachable by one
 * caller, in order to accept a second spelling of something nobody
 * should be typing. The picker removes the typing instead.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { RaiseTicketModal } from '@/app/(authed)/tickets/_components/raise-ticket-modal';
import { buildFetchMock, makeSeller, renderWithProviders } from './helpers';

const noop = (): void => undefined;

const ORDER = {
  id: '01a0f2a6-4f66-7bb0-9657-872a6237734b',
  orderNumber: 'SD-2026-26-000365',
  sellerOrderRef: null,
  status: 'CONFIRMED',
  source: 'MANUAL',
  recipientName: 'Asha Verma',
  recipientPhoneE164: '+919876543210',
  recipientCity: '',
  recipientStateProvince: '',
  recipientPostalCode: '560001',
  codAmountInr: '999.00',
  placedAt: '2026-09-01T00:00:00.000Z',
  sellerId: 'seller-1',
};

function mocks(): ReturnType<typeof buildFetchMock> {
  return buildFetchMock([
    { match: /issue-categories/, responses: [{ status: 200, body: [] }] },
    {
      match: /seller\/orders\?/,
      responses: [
        { status: 200, body: { items: [ORDER], total: 1, page: 1, pageSize: 8 } },
        { status: 200, body: { items: [ORDER], total: 1, page: 1, pageSize: 8 } },
      ],
    },
  ]);
}

describe('raising an issue picks the order rather than asking for its id', () => {
  it('asks for no uuid at all', async () => {
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} />
      </ToastProvider>,
      { fetchImpl: mocks() },
    );

    await waitFor(() => screen.getByLabelText(/^Order/i));
    const field = screen.getByLabelText(/^Order/i);
    // The old placeholder was a uuid stem, and the old hint told the
    // seller to copy an ID off a page that shows a number.
    // The old placeholder was a uuid stem — 8 hex digits and a dash.
    expect(field.getAttribute('placeholder') ?? '').not.toMatch(/[0-9a-f]{8}-/i);
    expect(screen.queryByText(/Copy the ID from the order page/i)).toBeNull();
  });

  it('finds an order by the NUMBER the seller can actually read', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} />
      </ToastProvider>,
      { fetchImpl: mocks() },
    );

    await waitFor(() => screen.getByLabelText(/^Order/i));
    await user.type(screen.getByLabelText(/^Order/i), '000365');

    await waitFor(
      () => {
        expect(screen.getByText('SD-2026-26-000365')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    // And by who it is going to, so two similar numbers are told apart
    // without opening either.
    expect(screen.getByText(/Asha Verma/)).toBeInTheDocument();
  });

  it('searches the server, and does not re-filter its answer away', async () => {
    // The server matches a phone number the option's LABEL never shows.
    // Filtering the result again in the browser would fetch the right
    // order and then hide it — which is why the picker runs the combobox
    // in remote mode.
    const user = userEvent.setup();
    const fetchImpl = mocks();
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} />
      </ToastProvider>,
      { fetchImpl },
    );

    await waitFor(() => screen.getByLabelText(/^Order/i));
    await user.type(screen.getByLabelText(/^Order/i), '9876543210');

    await waitFor(
      () => {
        expect(screen.getByText('SD-2026-26-000365')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    const searched = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(searched.some((u) => u.includes('search=9876543210'))).toBe(true);
  });

  it('sends the chosen order, not what was typed', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /issue-categories/, responses: [{ status: 200, body: [] }] },
      {
        match: /seller\/orders\?/,
        responses: [
          { status: 200, body: { items: [ORDER], total: 1, page: 1, pageSize: 8 } },
          { status: 200, body: { items: [ORDER], total: 1, page: 1, pageSize: 8 } },
        ],
      },
      { match: /seller\/tickets$/, responses: [{ status: 201, body: { id: 'tk-1' } }] },
    ]);
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} />
      </ToastProvider>,
      { fetchImpl },
    );

    await waitFor(() => screen.getByLabelText(/^Order/i));
    await user.type(screen.getByLabelText(/^Order/i), '000365');
    await waitFor(() => screen.getByText('SD-2026-26-000365'), { timeout: 3000 });
    await user.click(screen.getByText('SD-2026-26-000365'));

    // The field shows the number; the value carried is the id.
    await waitFor(() => {
      expect(screen.getByLabelText(/^Order/i)).toHaveValue('SD-2026-26-000365');
    });
  });

  it('is not offered to somebody who cannot see orders', async () => {
    // The order is optional on a ticket. Offering a search over records
    // they cannot read would 403 or come back empty, both of which read
    // as a broken form; they can still raise the issue in words.
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} />
      </ToastProvider>,
      {
        fetchImpl: mocks(),
        identity: makeSeller({ permissions: ['tickets.view', 'tickets.create'] }),
      },
    );

    await waitFor(() => screen.getByText(/Tell us what is wrong/i));
    expect(screen.queryByLabelText(/^Order/i)).toBeNull();
  });

  it('never shows the picker when the order is already known', async () => {
    // Raised FROM an order: there is nothing to choose.
    renderWithProviders(
      <ToastProvider>
        <RaiseTicketModal open onOpenChange={noop} orderId={ORDER.id} />
      </ToastProvider>,
      {
        fetchImpl: mocks(),
      },
    );

    await waitFor(() => screen.getByText(/Tell us what is wrong/i));
    expect(screen.queryByLabelText(/^Order/i)).toBeNull();
  });
});
