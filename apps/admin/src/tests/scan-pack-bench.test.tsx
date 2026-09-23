/**
 * The pack bench — `(authed)/warehouse/pack/_components/pack-station.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. The bench is run off
 * ONE field by a barcode gun: focus must come back to it after every
 * state change, Enter decides what a scan means from state, the field
 * locks while a request is in flight or a refusal is up, and a refusal is
 * a blocking dialog. A visual change must not loosen any of this.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackStation } from '@/app/(authed)/warehouse/pack/_components/pack-station';
import { makeStaff, renderWithProviders } from './helpers';
import {
  deferred,
  requestsTo,
  scanFetch,
  writesSeen,
  type Reply,
  type ScanRoute,
} from './scan-fetch';

const OPEN_BOX = {
  packBoxId: 'pb-1',
  shipmentId: 'sh-1',
  orderId: 'ord-1',
  awbNumber: 'AWB100',
  expiresAt: '2026-09-23T10:00:00.000Z',
  expected: [
    { variantId: 'v-1', skuCode: 'SKU-A', productName: 'Aviator Sunglass', quantity: 2 },
    { variantId: 'v-2', skuCode: 'SKU-B', productName: 'Leather Case', quantity: 1 },
  ],
  alreadyOpen: false,
};

function scanResult(variantId: string, stockUnitId: string | null = null): Reply {
  return {
    status: 201,
    body: {
      packBoxId: 'pb-1',
      variantId,
      skuCode: variantId === 'v-1' ? 'SKU-A' : 'SKU-B',
      stockUnitId,
      scannedCount: 1,
      expectedCount: 3,
      complete: false,
    },
  };
}

const CLOSED = {
  status: 201,
  body: { shipmentId: 'sh-1', orderStatus: 'PACKED', manifestNumber: 'MF-2026-09-000001' },
};

/** The GETs the bench makes whatever happens: the scan-block check and the queue. */
const BACKGROUND: ScanRoute[] = [
  { match: /\/api\/admin\/courier\/scan-block$/, method: 'GET', reply: { status: 200 } },
  {
    match: /\/api\/warehouse\/packs\/queue/,
    method: 'GET',
    reply: { status: 200, body: { waiting: [] } },
  },
];

function scanField(): HTMLInputElement {
  const el = document.getElementById('pack-scan');
  if (!(el instanceof HTMLInputElement)) throw new Error('#pack-scan is not on screen');
  return el;
}

function renderBench(routes: ScanRoute[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<PackStation />, {
    identity: makeStaff(undefined, ['warehouse.pack']),
    fetchImpl: scanFetch([...routes, ...BACKGROUND]),
  });
}

/** Opens a box on AWB100 through the field, as a scanner would. */
async function openBox(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(scanField(), 'AWB100{Enter}');
  await screen.findByText('Aviator Sunglass');
}

describe('pack bench — focus', () => {
  // pack-station.tsx:108-111 — the field holds focus from the moment the
  // bench mounts, so the first scan lands in it.
  it('focuses #pack-scan on mount', async () => {
    renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });

  // :109-111 — focus comes back after each state change (box opened, a line counted).
  it('keeps focus on the field after the box opens and after each product scan', async () => {
    const user = userEvent.setup();
    renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
      { match: /\/boxes\/pb-1\/scan$/, method: 'POST', reply: scanResult('v-1') },
    ]);
    await openBox(user);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'SKU-A{Enter}');
    await screen.findByText('1 / 2');
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });
});

describe('pack bench — what an Enter means', () => {
  // :142-147 — no box open: the scan is a label, POST /boxes/open with it (trimmed).
  it('with no box open, POSTs /api/warehouse/packs/boxes/open with the scanned code', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), '  AWB100  {Enter}');
    await screen.findByText('Aviator Sunglass');
    expect(writesSeen(fetchImpl)).toEqual([
      { url: '/api/warehouse/packs/boxes/open', method: 'POST', body: { awbNumber: 'AWB100' } },
    ]);
    expect(scanField().value).toBe('');
    expect(screen.getByText('Scan a product — or the label again to close')).toBeInTheDocument();
  });

  // :137 — an empty Enter sends nothing.
  it('an empty Enter makes no request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), '   {Enter}');
    expect(writesSeen(fetchImpl)).toEqual([]);
  });

  // :174-177 — box open, any other code: POST /boxes/:id/scan, and that line counts up.
  it('with a box open, any other code POSTs /boxes/:id/scan', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
      { match: /\/boxes\/pb-1\/scan$/, method: 'POST', reply: scanResult('v-1') },
    ]);
    await openBox(user);
    await user.type(scanField(), 'SKU-A{Enter}');
    await screen.findByText('1 / 2');
    expect(writesSeen(fetchImpl)[1]).toEqual({
      url: '/api/warehouse/packs/boxes/pb-1/scan',
      method: 'POST',
      body: { code: 'SKU-A' },
    });
  });

  // :150-158 — box open, the code equals the box's AWB: POST /boxes/:id/close.
  it('a scan equal to the open box AWB POSTs /boxes/:id/close', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
      { match: /\/boxes\/pb-1\/close$/, method: 'POST', reply: CLOSED },
    ]);
    await openBox(user);
    await user.type(scanField(), 'AWB100{Enter}');
    // reset() — the bench goes back to "open a box".
    await screen.findByText('Scan the shipping label to open a box');
    expect(writesSeen(fetchImpl)).toEqual([
      { url: '/api/warehouse/packs/boxes/open', method: 'POST', body: { awbNumber: 'AWB100' } },
      {
        url: '/api/warehouse/packs/boxes/pb-1/close',
        method: 'POST',
        body: { awbNumber: 'AWB100' },
      },
    ]);
    expect(requestsTo(fetchImpl, /\/scan$/, 'POST')).toEqual([]);
  });
});

describe('pack bench — the field locks', () => {
  // :266-271, :315 — disabled while a request is in flight.
  it('is disabled while a request is in flight, and comes back focused', async () => {
    const user = userEvent.setup();
    const gate = deferred<Reply>();
    renderBench([{ match: /\/boxes\/open$/, method: 'POST', reply: () => gate.promise }]);
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
    await user.type(scanField(), 'AWB100{Enter}');
    await waitFor(() => expect(scanField()).toBeDisabled());
    await act(async () => {
      gate.resolve({ status: 201, body: OPEN_BOX });
    });
    await screen.findByText('Aviator Sunglass');
    await waitFor(() => expect(scanField()).not.toBeDisabled());
    await waitFor(() => expect(document.activeElement).toBe(scanField()));
  });

  // :181-189, :315, :525-552 — a refused scan opens a blocking dialog, the
  // field is disabled under it, and "I have fixed it" gives the field back.
  it('a refused scan opens "That scan was refused"; the field is locked until "I have fixed it"', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
      {
        match: /\/boxes\/pb-1\/scan$/,
        method: 'POST',
        reply: {
          status: 409,
          body: {
            code: 'UNIT_PICKED_FOR_OTHER_PARCEL',
            message: 'That unit was picked for a different parcel.',
          },
        },
      },
    ]);
    await openBox(user);
    await user.type(scanField(), 'SER-9{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'That scan was refused' });
    expect(dialog).toHaveTextContent(
      '[UNIT_PICKED_FOR_OTHER_PARCEL] That unit was picked for a different parcel.',
    );
    expect(scanField()).toBeDisabled();
    expect(requestsTo(fetchImpl, /\/scan$/, 'POST')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'I have fixed it' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'That scan was refused' }),
      ).not.toBeInTheDocument(),
    );
    expect(scanField()).not.toBeDisabled();
    expect(scanField().value).toBe('');
    // KNOWN BUG, pinned as it is today (verified in Chromium against the
    // local stack on 2026-09-23): the button clears the refusal and calls
    // focus() in the same tick, while the field is still disabled, so the
    // call does nothing and focus ends on <body>. The operator has to click
    // back into the field. Fixing it is an owner decision (a behaviour
    // change), not something the restyle may do quietly — when it is fixed,
    // this assertion flips to the field in the same commit.
    expect(document.activeElement).toBe(document.body);
    // Nothing was counted.
    expect(screen.getByText('0 / 2')).toBeInTheDocument();
  });
});

describe('pack bench — UNIT_SCAN_REQUIRED on close', () => {
  // :159-170, :346-386 — a close refused with UNIT_SCAN_REQUIRED switches
  // to the serial step, offering back the units the box already accepted.
  it('switches to the serial step with the scanned unit serials', async () => {
    const user = userEvent.setup();
    renderBench([
      { match: /\/boxes\/open$/, method: 'POST', reply: { status: 201, body: OPEN_BOX } },
      { match: /\/boxes\/pb-1\/scan$/, method: 'POST', reply: scanResult('v-1', 'su-1') },
      {
        match: /\/boxes\/pb-1\/close$/,
        method: 'POST',
        reply: {
          status: 409,
          body: { code: 'UNIT_SCAN_REQUIRED', message: 'List the unit serials to complete.' },
        },
      },
    ]);
    await openBox(user);
    await user.type(scanField(), 'SER-1{Enter}');
    await screen.findByText('1 / 2');
    await user.type(scanField(), 'AWB100{Enter}');

    await screen.findByText('One step left on');
    // The label field is gone — a scan would open a second box.
    expect(document.getElementById('pack-scan')).toBeNull();
    // The serial scanner is up, focused, carrying what the box accepted.
    const serials = document.getElementById('pack-finish-serials');
    expect(serials).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole('button', { name: 'Remove SER-1' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '[UNIT_SCAN_REQUIRED] List the unit serials to complete.',
    );
    expect(screen.getByRole('button', { name: 'Finish pack' })).not.toBeDisabled();
  });
});
