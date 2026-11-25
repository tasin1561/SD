/**
 * Courier decisions: "Send to manual placement" on a waiting parcel.
 * Success takes the parcel off the desk and says so; a refusal shows the
 * server's [CODE] message exactly as it arrives (FE-2).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { CourierDecisionIndex } from '@/app/(authed)/courier-decisions/_components/courier-decision-index';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const parcel = (n: number) => ({
  orderId: `o${n}`,
  orderNumber: `SD-000${n}`,
  shipmentId: `s${n}`,
  shipmentNumber: `SH-000${n}`,
  sellerId: 'sel',
  sellerCompanyName: 'Acme',
  recipientName: 'R',
  destCity: 'Kolkata',
  destPostalCode: '700001',
  totalWeightGrams: 500,
  codAmountInr: null,
  waitingSince: new Date().toISOString(),
  options: [{ courierCompanyId: 7, courierName: 'Xpress', rateInr: '80.00', estimatedDays: 3 }],
  optionsFetchedAt: null,
});

const manualCalls = (f: ReturnType<typeof buildFetchMock>) =>
  f.mock.calls.filter((c) => /\/manual-placement$/.test(String(c[0])));

describe('send to manual placement', () => {
  it('posts for that parcel, removes it from the desk and says so', async () => {
    const f = buildFetchMock([
      {
        match: /\/api\/admin\/courier-decisions$/,
        responses: [
          { status: 200, body: { parcels: [parcel(1), parcel(2)] } },
          { status: 200, body: { parcels: [parcel(2)] } },
        ],
      },
      {
        match: /\/shipments\/s1\/manual-placement$/,
        responses: [{ status: 200, body: { orderId: 'o1' } }],
      },
    ]);
    renderWithProviders(
      <ToastProvider>
        <CourierDecisionIndex />
      </ToastProvider>,
      { fetchImpl: f },
    );
    await screen.findByText('SD-0001');
    const buttons = screen.getAllByRole('button', { name: 'Send to manual placement' });
    expect(buttons).toHaveLength(2);

    await userEvent.setup().click(buttons[0]!);

    await waitFor(() => expect(screen.queryByText('SD-0001')).toBeNull());
    expect(screen.getByText('SD-0002')).toBeTruthy();
    expect(await screen.findByText('Sent to manual placement')).toBeTruthy();
    expect(manualCalls(f)).toHaveLength(1);
    expect((manualCalls(f)[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it.each(['AWB_ALREADY_GENERATED', 'ORDER_NOT_AWAITING_COURIER', 'SHIPMENT_SUPERSEDED'])(
    'shows the server’s %s message unchanged and keeps the parcel',
    async (code) => {
      const message = `The server's own words for ${code}.`;
      const f = buildFetchMock([
        {
          match: /\/api\/admin\/courier-decisions$/,
          responses: [{ status: 200, body: { parcels: [parcel(1)] } }],
        },
        { match: /\/manual-placement$/, responses: [{ status: 409, body: { code, message } }] },
      ]);
      renderWithProviders(
        <ToastProvider>
          <CourierDecisionIndex />
        </ToastProvider>,
        { fetchImpl: f },
      );
      await screen.findByText('SD-0001');
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Send to manual placement' }));

      expect((await screen.findByRole('alert')).textContent).toBe(`[${code}] ${message}`);
      expect(screen.getByText('SD-0001')).toBeTruthy();
      expect(screen.queryByText('Sent to manual placement')).toBeNull();
    },
  );
});

describe('cancel the order from the desk', () => {
  const render = (f: ReturnType<typeof buildFetchMock>, permissions?: readonly string[]) =>
    renderWithProviders(
      <ToastProvider>
        <CourierDecisionIndex />
      </ToastProvider>,
      {
        fetchImpl: f,
        ...(permissions ? { identity: makeStaff(['OPS'], permissions) } : {}),
      },
    );
  const cancelCalls = (f: ReturnType<typeof buildFetchMock>) =>
    f.mock.calls.filter((c) => /\/orders\/o1\/cancel$/.test(String(c[0])));

  it('asks for a reason, cancels that order, removes the parcel and says so', async () => {
    const f = buildFetchMock([
      {
        match: /\/api\/admin\/courier-decisions$/,
        responses: [
          { status: 200, body: { parcels: [parcel(1), parcel(2)] } },
          { status: 200, body: { parcels: [parcel(2)] } },
        ],
      },
      {
        match: /\/orders\/o1\/cancel$/,
        responses: [{ status: 200, body: { orderId: 'o1', status: 'CANCELLED_BY_ADMIN' } }],
      },
    ]);
    render(f);
    await screen.findByText('SD-0001');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Cancel order' })[0]!);
    const dlg = await screen.findByRole('dialog');
    await user.selectOptions(within(dlg).getByLabelText(/reason/i), 'CUSTOMER_REQUESTED');
    // Nothing is sent until the confirm.
    expect(cancelCalls(f)).toHaveLength(0);
    await user.click(within(dlg).getByRole('button', { name: 'Confirm cancel' }));

    await waitFor(() => expect(screen.queryByText('SD-0001')).toBeNull());
    expect(screen.getByText('SD-0002')).toBeTruthy();
    expect(await screen.findByText('Order SD-0001 cancelled')).toBeTruthy();
    expect(JSON.parse(String((cancelCalls(f)[0]?.[1] as RequestInit).body))).toEqual({
      cancellationReason: 'CUSTOMER_REQUESTED',
    });
  });

  it('shows a refusal in the dialog as the server worded it, and keeps the parcel', async () => {
    const f = buildFetchMock([
      {
        match: /\/api\/admin\/courier-decisions$/,
        responses: [{ status: 200, body: { parcels: [parcel(1)] } }],
      },
      {
        match: /\/orders\/o1\/cancel$/,
        responses: [{ status: 409, body: { code: 'NOT_CANCELLABLE', message: 'Not now.' } }],
      },
    ]);
    render(f);
    await screen.findByText('SD-0001');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm cancel' }));
    expect(await within(dlg).findByText('[NOT_CANCELLABLE] Not now.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'SD-0001', hidden: true })).toBeTruthy();
  });

  it('is hidden without orders.cancel', async () => {
    const f = buildFetchMock([
      {
        match: /\/api\/admin\/courier-decisions$/,
        responses: [{ status: 200, body: { parcels: [parcel(1)] } }],
      },
    ]);
    render(f, ['orders.courier_choice', 'orders.view']);
    await screen.findByText('SD-0001');
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send to manual placement' })).toBeTruthy();
  });
});
