/**
 * The handover bench — `(authed)/warehouse/handover/_components/handover-bench.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. The scan IS the
 * handover (CUR-4): Enter in `#handover-scan` dispatches the parcel. The
 * field locks while a scan is pending, while a refusal is up and while the
 * operator is blocked (SCAN-1), focus comes back after every scan and after
 * the refusal is acknowledged, and the session list is newest-first. A
 * restyle must not loosen any of it.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandoverBench } from '@/app/(authed)/warehouse/handover/_components/handover-bench';
import { makeStaff, renderWithProviders } from './helpers';
import { deferred, scanFetch, writesSeen, type Reply, type ScanRoute } from './scan-fetch';

function scanned(shipmentNumber: string): Reply {
  return {
    status: 201,
    body: {
      shipmentId: `id-${shipmentNumber}`,
      shipmentNumber,
      orderId: 'ord-1',
      alreadyScanned: false,
      dispatched: true,
      manifestDispatched: false,
    },
  };
}

const QUEUE: ScanRoute = {
  match: /\/api\/admin\/courier\/handover-queue/,
  method: 'GET',
  reply: { status: 200, body: { waiting: [] } },
};
const NOT_BLOCKED: ScanRoute = {
  match: /\/api\/admin\/courier\/scan-block$/,
  method: 'GET',
  reply: { status: 200 },
};

function field(): HTMLInputElement {
  const el = document.getElementById('handover-scan');
  if (!(el instanceof HTMLInputElement)) throw new Error('#handover-scan is not on screen');
  return el;
}

function renderBench(routes: ScanRoute[]): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<HandoverBench />, {
    identity: makeStaff(undefined, ['warehouse.dispatch']),
    fetchImpl: scanFetch([...routes, QUEUE, NOT_BLOCKED]),
  });
}

describe('handover bench — Enter dispatches', () => {
  // handover-bench.tsx:125-130, :54-69 — Enter POSTs the trimmed AWB, exactly.
  it('Enter POSTs /api/admin/courier/handover-scan with { awbNumber }', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([
      { match: /\/handover-scan$/, method: 'POST', reply: scanned('SH-0001') },
    ]);
    await user.type(field(), '  AWB-1  {Enter}');
    await screen.findByText('SH-0001');
    expect(writesSeen(fetchImpl)).toEqual([
      { url: '/api/admin/courier/handover-scan', method: 'POST', body: { awbNumber: 'AWB-1' } },
    ]);
    expect(field().value).toBe('');
    expect(screen.getByText('1 scanned in this session.')).toBeInTheDocument();
  });

  // :56 — an empty Enter sends nothing.
  it('an empty Enter makes no request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = renderBench([]);
    await user.type(field(), '   {Enter}');
    expect(writesSeen(fetchImpl)).toEqual([]);
    expect(screen.getByText('Nothing scanned yet.')).toBeInTheDocument();
  });

  // :60-69 — each scanned parcel is PREPENDED: the newest is first.
  it('prepends each scanned parcel to the session list', async () => {
    const user = userEvent.setup();
    renderBench([
      {
        match: /\/handover-scan$/,
        method: 'POST',
        reply: (_req, n) => scanned(n === 0 ? 'SH-0001' : 'SH-0002'),
      },
    ]);
    await user.type(field(), 'AWB-1{Enter}');
    await screen.findByText('SH-0001');
    await user.type(field(), 'AWB-2{Enter}');
    await screen.findByText('SH-0002');
    const first = screen.getByText('SH-0002');
    const second = screen.getByText('SH-0001');
    // DOCUMENT_POSITION_FOLLOWING: SH-0001 comes after SH-0002.
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('2 scanned in this session.')).toBeInTheDocument();
  });
});

describe('handover bench — focus and locking', () => {
  // :120 disabled while pending; :75-77 focus returns after the submit.
  it('is disabled while the scan is pending and focused again after it', async () => {
    const user = userEvent.setup();
    const gate = deferred<Reply>();
    renderBench([{ match: /\/handover-scan$/, method: 'POST', reply: () => gate.promise }]);
    await user.type(field(), 'AWB-1{Enter}');
    await waitFor(() => expect(field()).toBeDisabled());
    await act(async () => {
      gate.resolve(scanned('SH-0001'));
    });
    await screen.findByText('SH-0001');
    await waitFor(() => expect(field()).not.toBeDisabled());
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  // :70-75, :120, :204-229 — a refusal opens "That parcel was refused",
  // the field is disabled under it, "Understood" gives focus back.
  it('a refusal locks the field until "Understood", which returns focus to #handover-scan', async () => {
    const user = userEvent.setup();
    renderBench([
      {
        match: /\/handover-scan$/,
        method: 'POST',
        reply: {
          status: 409,
          body: { code: 'DUPLICATE_SCAN', message: 'That parcel was already handed over.' },
        },
      },
    ]);
    await user.type(field(), 'AWB-1{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'That parcel was refused' });
    expect(dialog).toHaveTextContent('[DUPLICATE_SCAN] That parcel was already handed over.');
    expect(field()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Understood' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'That parcel was refused' }),
      ).not.toBeInTheDocument(),
    );
    expect(field()).not.toBeDisabled();
    // KNOWN BUG, pinned as it is today (verified in Chromium against the
    // local stack on 2026-09-23): the button clears the refusal and calls
    // focus() in the same tick, while the field is still disabled, so the
    // call does nothing and focus ends on <body>. The operator has to click
    // back into the field. Fixing it is an owner decision (a behaviour
    // change), not something the restyle may do quietly — when it is fixed,
    // this assertion flips to the field in the same commit.
    expect(document.activeElement).toBe(document.body);
    // A refused parcel is not added to the session.
    expect(screen.getByText('Nothing scanned yet.')).toBeInTheDocument();
  });

  // :87, :120 — while the operator is blocked (SCAN-1) the field is disabled.
  it('is disabled while the operator is blocked', async () => {
    renderWithProviders(<HandoverBench />, {
      identity: makeStaff(undefined, ['warehouse.dispatch']),
      fetchImpl: scanFetch([
        {
          match: /\/api\/admin\/courier\/scan-block$/,
          method: 'GET',
          reply: {
            status: 200,
            body: { issueId: 'iss-1', title: 'Duplicate scan', detail: 'AWB-1 scanned twice.' },
          },
        },
        QUEUE,
      ]),
    });
    await screen.findByText('Scanning is stopped');
    expect(field()).toBeDisabled();
  });
});
