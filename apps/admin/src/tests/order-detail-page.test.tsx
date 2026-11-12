/**
 * The WHOLE redesigned page, against complete fixtures (the same ones the
 * /dev/order-detail harness serves). Rendering OrderDetailView needs a
 * ToastProvider, `items: []`-style complete data, uppercase statuses and
 * valid dates — a sparse fixture fails for reasons unrelated to the page.
 *
 * What this pins is the gating the redesign must not change: the same
 * admin without `orders.override` / `courier.ops.write` sees god-mode
 * items DISABLED with a reason, and Edit / Fix address HIDDEN.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { OrderDetailView } from '@/app/(authed)/orders/_components/order-detail';
import { fixture, DEV_ORDER_ID, type FixtureId } from '@/app/dev/order-detail/fixtures.dev';
import { makeStaff, renderWithProviders } from './helpers';
import { vi } from 'vitest';

function api(id: FixtureId): ReturnType<typeof vi.fn> {
  const f = fixture(id);
  const base = `/api/admin/orders/${DEV_ORDER_ID}`;
  const json = (b: unknown, status = 200): Response =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://x').pathname;
    if (path === base) return json(f.order);
    if (path === `${base}/shipments`) return json(f.shipments);
    if (path === `${base}/journey`) return json(f.journey);
    if (path === `${base}/address-check`) return f.check === null ? json({}, 404) : json(f.check);
    if (path === `${base}/consignee`) return json(f.consignee);
    if (path === `${base}/consignee/history`) return json([]);
    if (path === `${base}/charges`) return json(f.charges);
    if (path === `${base}/parcel-activity`) return json(f.audit);
    if (path === `${base}/customer-reputation`) {
      return json({
        phoneE164: '+919883596606',
        platform: {
          totalOrders: 0,
          delivered: 0,
          returned: 0,
          refusedOnCall: 0,
          returnRatePercent: null,
          firstOrderAt: null,
          lastOrderAt: null,
        },
        yours: { totalOrders: 0, delivered: 0, returned: 0, recentOrders: [], openOrders: [] },
        riskLevel: 'NONE',
        riskNotes: null,
        customerName: null,
      });
    }
    return json({ code: 'NOT_MOCKED', message: path }, 404);
  });
}

/** The page header — the shipment card has its own ⋯ menu also named More. */
function header(): HTMLElement {
  return document.querySelector('.od-header') as HTMLElement;
}

function mount(id: FixtureId): void {
  renderWithProviders(
    <ToastProvider>
      <OrderDetailView orderId={DEV_ORDER_ID} />
    </ToastProvider>,
    { identity: makeStaff(['X'], [...fixture(id).permissions]), fetchImpl: api(id) },
  );
}

describe('OrderDetailView gating', () => {
  it('a full-permission admin: Fix address is offered, Edit enters edit mode and Cancel returns to Edit', async () => {
    const user = userEvent.setup();
    mount('a');
    expect(await screen.findByRole('button', { name: 'Fix address' })).toBeInTheDocument();
    const recipient = await screen.findByRole('region', { name: 'Recipient & address' });
    const edit = await within(recipient).findByRole('button', { name: 'Edit' });
    await user.click(edit);
    expect(await within(recipient).findByLabelText('Name')).toHaveFocus();
    await user.click(within(recipient).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(recipient).getByRole('button', { name: 'Edit' })).toHaveFocus(),
    );
  });

  it('without orders.override and courier.ops.write: Edit and Fix address are hidden, god-mode items disabled with a reason', async () => {
    const user = userEvent.setup();
    mount('f');
    await screen.findByRole('region', { name: 'Recipient & address' });
    await screen.findByText('Address needs attention');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fix address' })).toBeNull();
    // the shipment exists, so the header offers courier actions instead
    expect(
      await screen.findAllByRole('button', { name: 'Courier actions & costs' }),
    ).not.toHaveLength(0);

    await user.click(within(header()).getByRole('button', { name: 'More' }));
    for (const name of [/Force-mutate/, /Release reservations/, /Restore stock claim/]) {
      const item = screen.getByRole('menuitem', { name });
      expect(item).toHaveAttribute('aria-disabled', 'true');
    }
    // no money.treasury.manage → no cost item; no compute permission → no compute item
    expect(screen.queryByRole('menuitem', { name: 'Record courier cost' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Compute & persist charges' })).toBeNull();
    // but Cancel is enabled (orders.cancel held, order not terminal)
    expect(screen.getByRole('menuitem', { name: /Cancel order/ })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('an order with no shipment offers no scan/cost item and no courier button', async () => {
    const user = userEvent.setup();
    mount('b');
    await screen.findByRole('region', { name: 'Recipient & address' });
    expect(screen.queryByRole('button', { name: 'Courier actions & costs' })).toBeNull();
    await user.click(within(header()).getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: /scan manually/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Record courier cost' })).toBeNull();
  });

  it('the Cancel dialog opens on "Keep order", Escape closes it, and focus returns to More', async () => {
    const user = userEvent.setup();
    mount('a');
    await screen.findByRole('region', { name: 'Recipient & address' });
    const more = within(header()).getByRole('button', { name: 'More' });
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: /Cancel order/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel order SD-2026-26-000065?')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Keep order' })).toHaveFocus(),
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(more).toHaveFocus();
  });

  it('keeps the AWB in the header (orderAwbs is still the source)', async () => {
    mount('a');
    expect(await screen.findAllByText('38061110627406')).not.toHaveLength(0);
  });
});
