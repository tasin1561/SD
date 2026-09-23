/**
 * "Serials to reprint" — `(authed)/warehouse/consignments/[id]/_components/consignment-panel.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. `parseSerials()`
 * (:48-59, not exported, so pinned through the field and the request it
 * produces) splits on any run of whitespace or commas, trims, drops empties
 * and de-duplicates in first-seen order. The field has no Enter handler, so
 * Enter sends nothing — the request goes only through "Ask for approval".
 * A restyle must not change how the list is read or when it is sent.
 *
 * Newline-separated input is NOT pinned here: this is a single-line
 * `<input>`, and an input's value sanitisation strips line breaks before
 * `parseSerials` ever sees them (see the report on the inventory's
 * "Enter-separated" claim).
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsignmentPanel } from '@/app/(authed)/warehouse/consignments/[id]/_components/consignment-panel';
import { makeStaff, renderWithProviders } from './helpers';
import { requestsTo, scanFetch, writesSeen } from './scan-fetch';

const CONSIGNMENT = {
  id: 'cn-1',
  consignmentNumber: 'CN-2026-09-000001',
  sellerId: 'seller-1',
  route: 'DIRECT_IN',
  status: 'PENDING',
  labellingSite: 'IN',
  labelsPrintedAt: '2026-09-20T10:00:00.000Z',
  expectedArrivalAt: null,
  sellerReference: null,
  cancelledAt: null,
  cancelReason: null,
  inboundFreightMode: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  seller: { id: 'seller-1', companyName: 'Menev Store', emailDisplay: 'menev@example.com' },
  receipts: [],
  freightCharges: [],
};

function reprintReply(serials: readonly string[]): Record<string, unknown> {
  return {
    id: 'rr-1',
    consignmentId: 'cn-1',
    consignmentNumber: 'CN-2026-09-000001',
    serials,
    reason: 'Label torn in transit',
    state: 'PENDING',
    requestedBy: { id: 'staff-1', email: 't@example.com' },
    requestedAt: '2026-09-23T10:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    approvalExpiresAt: null,
    printedAt: null,
  };
}

const REPRINT = /\/api\/admin\/consignments\/cn-1\/labels\/reprint-requests$/;

async function openReprint(): Promise<ReturnType<typeof renderWithProviders>> {
  const r = renderWithProviders(<ConsignmentPanel id="cn-1" />, {
    identity: makeStaff(undefined, ['inventory.goods_receipts.manage']),
    fetchImpl: scanFetch([
      {
        match: REPRINT,
        method: 'POST',
        reply: (req) => ({
          status: 201,
          body: reprintReply((req.body as { serials: string[] }).serials),
        }),
      },
      { match: REPRINT, method: 'GET', reply: { status: 200, body: [] } },
      {
        match: /\/api\/admin\/consignments\/cn-1\/events$/,
        method: 'GET',
        reply: { status: 200, body: [] },
      },
      {
        match: /\/api\/admin\/consignments\/cn-1\/labels$/,
        method: 'GET',
        reply: { status: 200, body: { strictUnits: 0, strictSkus: 0 } },
      },
      {
        match: /\/api\/admin\/consignments\/cn-1$/,
        method: 'GET',
        reply: { status: 200, body: CONSIGNMENT },
      },
    ]),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'A label was damaged or lost' }));
  return r;
}

function serialsField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Serials to reprint' }) as HTMLInputElement;
}

async function askWith(raw: string): Promise<unknown> {
  const user = userEvent.setup();
  const { fetchImpl } = await openReprint();
  fireEvent.change(serialsField(), { target: { value: raw } });
  await user.type(screen.getByRole('textbox', { name: 'Why' }), 'Label torn in transit');
  await user.click(screen.getByRole('button', { name: 'Ask for approval' }));
  await waitFor(() => expect(requestsTo(fetchImpl, REPRINT, 'POST')).toHaveLength(1));
  return requestsTo(fetchImpl, REPRINT, 'POST')[0]?.body;
}

describe('consignment — serials to reprint', () => {
  // :48-59, :163-170 — space-separated.
  it('reads space-separated serials', async () => {
    expect(await askWith('SER-1 SER-2 SER-3')).toEqual({
      serials: ['SER-1', 'SER-2', 'SER-3'],
      reason: 'Label torn in transit',
    });
  });

  // Any whitespace run — several spaces, tabs — is one separator.
  it('reads tab- and multi-space-separated serials the same way', async () => {
    expect(await askWith('  SER-1\tSER-2    SER-3  ')).toEqual({
      serials: ['SER-1', 'SER-2', 'SER-3'],
      reason: 'Label torn in transit',
    });
  });

  // Commas, with or without spaces, and trailing commas.
  it('reads comma-separated serials the same way', async () => {
    expect(await askWith('SER-1,SER-2, SER-3,')).toEqual({
      serials: ['SER-1', 'SER-2', 'SER-3'],
      reason: 'Label torn in transit',
    });
  });

  // new Set — duplicates collapse, first-seen order kept.
  it('de-duplicates, keeping first-seen order', async () => {
    expect(await askWith('SER-2, SER-1 SER-2,SER-1')).toEqual({
      serials: ['SER-2', 'SER-1'],
      reason: 'Label torn in transit',
    });
  });

  // :443-448 — no onKeyDown: Enter in the field sends nothing.
  it('Enter in the serials field makes no request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await openReprint();
    await user.type(screen.getByRole('textbox', { name: 'Why' }), 'Label torn in transit');
    await user.type(serialsField(), 'SER-1{Enter}');
    await new Promise((r) => setTimeout(r, 50));
    expect(writesSeen(fetchImpl)).toEqual([]);
  });

  // :456-460 — the button stays disabled until at least one serial parses
  // and a reason is given; separators alone parse to nothing.
  it('"Ask for approval" is disabled for separators alone or a blank reason', async () => {
    const user = userEvent.setup();
    await openReprint();
    const ask = screen.getByRole('button', { name: 'Ask for approval' });
    fireEvent.change(serialsField(), { target: { value: ' , ,  ' } });
    await user.type(screen.getByRole('textbox', { name: 'Why' }), 'Label torn in transit');
    expect(ask).toBeDisabled();
    fireEvent.change(serialsField(), { target: { value: 'SER-1' } });
    expect(ask).not.toBeDisabled();
  });
});
