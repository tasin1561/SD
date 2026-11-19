import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactElement } from 'react';
import { LocaleProvider, useUiT } from '@skydrop/ui/app/i18n-client';
import { useRowSelection } from '@skydrop/ui/app/data-table';
import {
  BulkActions,
  deliveryDecisionBulkActions,
  orderBulkActions,
  type BulkActionDef,
  type BulkConsole,
  type BulkResponse,
  type BulkTransport,
} from '@skydrop/ui/app/bulk-actions';
import { makeTranslator, UI_MESSAGES } from '@skydrop/ui/app/i18n';

const IDS = ['a1', 'a2', 'a3'];
const NAMES: Record<string, string> = { a1: 'SD-1', a2: 'SD-2', a3: 'SD-3' };

const t = makeTranslator(UI_MESSAGES.en, UI_MESSAGES.en);

const answer = (over: Partial<BulkResponse> = {}): BulkResponse => ({
  results: [
    { orderId: 'a1', outcome: 'DONE' },
    {
      orderId: 'a2',
      outcome: 'SKIPPED',
      code: 'ORDER_NOT_CANCELLABLE',
      message: 'Already packed. Ask us to cancel it instead.',
    },
  ],
  done: 1,
  skipped: 1,
  failed: 0,
  ...over,
});

function Harness({
  pick,
  transport,
  onDone = () => undefined,
  build,
  matching,
}: {
  readonly pick: readonly string[] | 'all';
  readonly transport: BulkTransport;
  readonly onDone?: () => void;
  readonly build: (tt: ReturnType<typeof useUiT>) => BulkActionDef[];
  readonly matching?: { total: number; filter: unknown };
}): ReactElement {
  const uiT = useUiT();
  const selection = useRowSelection(IDS);
  const { toggle, toggleAll } = selection;
  useEffect(() => {
    if (pick === 'all') toggleAll(true);
    else for (const id of pick) toggle(id, true);
  }, [pick, toggle, toggleAll]);
  return (
    <BulkActions
      selection={selection}
      actions={build(uiT)}
      transport={transport}
      labelFor={(id) => NAMES[id]}
      explain={(e) => (e instanceof Error ? e.message : String(e))}
      onDone={onDone}
      matching={matching}
    />
  );
}

function show(props: Parameters<typeof Harness>[0]) {
  return render(
    <LocaleProvider initialLocale="en">
      <Harness {...props} />
    </LocaleProvider>,
  );
}

const seller =
  (may: (p: string) => boolean = () => true) =>
  (tt: ReturnType<typeof useUiT>) =>
    orderBulkActions({ console: 'seller', t: tt, may });

function transportOf(over: Partial<BulkTransport> = {}) {
  const post = vi.fn(async () => answer());
  const download = vi.fn(
    async () =>
      new Response('order\nSD-1\n', {
        headers: {
          'content-disposition': 'attachment; filename="orders.csv"',
          'x-bulk-exported': '57',
          'x-bulk-skipped': '2',
        },
      }),
  );
  return { post, download, ...over } as BulkTransport & {
    post: typeof post;
    download: typeof download;
  };
}

describe('bulk actions: what each console is offered', () => {
  const ids = (c: BulkConsole, perms: readonly string[]) =>
    orderBulkActions({ console: c, t, may: (p) => perms.includes(p) }).map((a) => a.id);

  it('hides every action the person lacks the permission for', () => {
    expect(ids('seller', [])).toEqual([]);
    expect(ids('seller', ['orders.view'])).toEqual(['export']);
    expect(ids('seller', ['orders.view', 'charges.view'])).toEqual(['invoices', 'export']);
    expect(ids('seller', ['orders.cancel'])).toEqual(['cancel-request', 'cancel']);
    expect(ids('seller', ['orders.create'])).toEqual(['call', 'confirm-without-call', 'delivery']);
  });

  it('gives the member store and associate cancel, request and export only', () => {
    expect(ids('store', ['orders.view', 'orders.cancel', 'orders.create'])).toEqual([
      'export',
      'cancel-request',
      'cancel',
    ]);
  });

  it('gives staff calls, labels, export and cancel by their own permissions', () => {
    expect(
      ids('admin', ['orders.view', 'orders.cancel', 'callcenter.queue.manage', 'warehouse.pick']),
    ).toEqual(['call', 'confirm-without-call', 'labels', 'export', 'cancel']);
    expect(ids('admin', ['orders.view'])).toEqual(['export']);
  });

  it('sends a key only to the endpoints that take one', () => {
    const all = orderBulkActions({ console: 'seller', t, may: () => true });
    const keyed = all.filter((a) => a.withKey === true).map((a) => a.id);
    expect(keyed).toEqual(['delivery', 'cancel-request', 'cancel']);
    expect(all.find((a) => a.id === 'cancel')?.path).toBe('/api/seller/bulk/orders/cancel');
    expect(all.find((a) => a.id === 'call')?.path).toBe(
      '/api/seller/orders/bulk/confirmation-calls',
    );
  });

  it('offers staff approve and decline only with the courier permission', () => {
    expect(deliveryDecisionBulkActions({ t, may: () => false })).toEqual([]);
    const defs = deliveryDecisionBulkActions({ t, may: () => true });
    expect(defs.map((d) => [d.id, d.idsKey, d.path])).toEqual([
      ['approve', 'requestIds', '/api/admin/bulk/delivery-actions/approve'],
      ['reject', 'requestIds', '/api/admin/bulk/delivery-actions/reject'],
    ]);
  });
});

describe('bulk actions: the bar', () => {
  it('is absent until something is ticked', () => {
    const { container } = show({ pick: [], transport: transportOf(), build: seller() });
    expect(container.querySelector('.sk-bulk')).toBeNull();
  });

  it('asks before cancelling, posts the ids with a fresh key, then lists every result', async () => {
    const transport = transportOf();
    const onDone = vi.fn();
    show({ pick: ['a1', 'a2'], transport, onDone, build: seller() });
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Cancel orders' }));
    expect(transport.post).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel 2 orders?')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
      target: { value: ' customer asked ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel orders' }));

    await waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
    const [path, body] = transport.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('/api/seller/bulk/orders/cancel');
    expect(body.orderIds).toEqual(['a1', 'a2']);
    expect(body.note).toBe('customer asked');
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(8);

    // The results sheet: totals, order numbers, the server's words as sent.
    expect(await screen.findByText('1 done · 1 skipped · 0 failed')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Result for each row' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('SD-2');
    expect(rows[0]).toHaveTextContent('Already packed. Ask us to cancel it instead.');
    expect(rows[0]).toHaveTextContent('ORDER_NOT_CANCELLABLE');
    expect(rows[1]).toHaveTextContent('SD-1');
    expect(onDone).toHaveBeenCalledTimes(1);
    // The selection is spent: the bar goes away behind the sheet.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull());
  });

  it('sends a confirmation call at once, with the ids and nothing else', async () => {
    const transport = transportOf();
    show({ pick: ['a3'], transport, build: seller() });
    fireEvent.click(await screen.findByRole('button', { name: 'Send for confirmation call' }));
    await waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
    expect(transport.post.mock.calls[0]).toEqual([
      '/api/seller/orders/bulk/confirmation-calls',
      { orderIds: ['a3'] },
    ]);
  });

  it('keeps the dialog open and shows the server words when the request is refused', async () => {
    const transport = transportOf({
      post: vi.fn(async () => {
        throw new Error('[BULK_TOO_MANY] At most 200 orders at a time.');
      }),
    });
    show({ pick: ['a1'], transport, build: seller() });
    fireEvent.click(await screen.findByRole('button', { name: 'Request cancellation' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send requests' }));
    expect(
      await within(dialog).findByText('[BULK_TOO_MANY] At most 200 orders at a time.'),
    ).toBeInTheDocument();
  });

  it('waits for a reason before a failed-delivery request can be sent', async () => {
    const transport = transportOf();
    show({ pick: ['a1', 'a2'], transport, build: seller() });
    fireEvent.click(await screen.findByRole('button', { name: 'Failed delivery…' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send requests' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('What should happen'), {
      target: { value: 'RTO' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
      target: { value: 'Customer refused twice' },
    });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
    const body = (transport.post.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(body).toMatchObject({
      orderIds: ['a1', 'a2'],
      action: 'RTO',
      reason: 'Customer refused twice',
    });
  });

  it('needs five characters to decline requests in bulk', async () => {
    const transport = transportOf();
    show({
      pick: ['a1'],
      transport,
      build: (tt) => deliveryDecisionBulkActions({ t: tt, may: () => true }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Decline requests' });
    const reason = within(dialog).getByLabelText(/Reason the client sees/);
    fireEvent.change(reason, { target: { value: 'no' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'Address is wrong' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
    const [path, body] = transport.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('/api/admin/bulk/delivery-actions/reject');
    expect(body.requestIds).toEqual(['a1']);
    expect(body.note).toBe('Address is wrong');
    expect(body.orderIds).toBeUndefined();
  });
});

describe('bulk actions: select all matching', () => {
  const matching = { total: 57, filter: { status: 'CONFIRMED', search: 'pune' } };

  it('is offered once the whole page is ticked, and then only export remains', async () => {
    const transport = transportOf();
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    show({ pick: 'all', transport, build: seller(), matching });

    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('3 selected')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: /Select all 57 matching/ }));
    expect(within(bar).getByText('All 57 matching selected')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'Cancel orders' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'Invoices (PDF)' })).toBeNull();

    fireEvent.click(within(bar).getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(transport.download).toHaveBeenCalledTimes(1));
    expect(transport.download.mock.calls[0]).toEqual([
      '/api/seller/orders/bulk/export',
      { filter: matching.filter },
    ]);
    expect(
      await within(bar).findByText('Downloaded 57. 2 left out; the file says which.'),
    ).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('exports just the ticked rows when "all matching" was not chosen', async () => {
    const transport = transportOf();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    show({ pick: ['a1', 'a3'], transport, build: seller(), matching });
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).queryByRole('button', { name: /Select all 57 matching/ })).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(transport.download).toHaveBeenCalledTimes(1));
    expect(transport.download.mock.calls[0]).toEqual([
      '/api/seller/orders/bulk/export',
      { orderIds: ['a1', 'a3'] },
    ]);
  });
});
