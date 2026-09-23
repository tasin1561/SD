/**
 * The "Cycle count" modal — `(authed)/inventory/cycle-counts/_components/cycle-counts-index.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. A counter reads one
 * bin and types one number: Enter in "Counted quantity" records nothing
 * (only the "Record line" button does), and the request carries the
 * trimmed ids exactly as the source builds them — both bin and batch sent
 * unconditionally, notes only when given (:426-444). A restyle must not
 * wire Enter to record, nor change the body.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CycleCountsIndex } from '@/app/(authed)/inventory/cycle-counts/_components/cycle-counts-index';
import { renderWithProviders } from './helpers';
import { scanFetch, writesSeen } from './scan-fetch';

const COUNT = {
  id: 'cc-1',
  warehouseId: 'wh-1',
  zoneId: null,
  countType: 'FULL',
  countDate: '2026-09-20T00:00:00.000Z',
  status: 'IN_PROGRESS',
  startedAt: '2026-09-20T09:00:00.000Z',
  completedAt: null,
  totalBinsCounted: null,
  totalSkusCounted: null,
  discrepancyCount: 0,
  totalDiscrepancyValueInr: '0.00',
  items: [],
};

async function openCount(): Promise<ReturnType<typeof renderWithProviders>> {
  const r = renderWithProviders(<CycleCountsIndex />, {
    fetchImpl: scanFetch([
      {
        match: /\/api\/admin\/cycle-counts\/cc-1\/items$/,
        method: 'POST',
        reply: { status: 201, body: COUNT },
      },
      {
        match: /\/api\/admin\/cycle-counts/,
        method: 'GET',
        reply: { status: 200, body: { items: [COUNT], total: 1, page: 1, pageSize: 25 } },
      },
    ]),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog', { name: 'Cycle count' });
  return r;
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    throw new Error(`#${id} not found`);
  }
  return el;
}

describe('cycle count — Record a counted line', () => {
  // cycle-counts-index.tsx:373-381 — a plain number input with no Enter handler.
  it('Enter in Counted quantity makes no request', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await openCount();
    await user.type(byId('cc-variant'), 'v-1');
    await user.type(byId('cc-bin'), 'bin-1');
    await user.type(byId('cc-batch'), 'batch-1');
    await user.type(byId('cc-qty'), '7{Enter}');
    await new Promise((r) => setTimeout(r, 50));
    expect(writesSeen(fetchImpl)).toEqual([]);
    expect(byId('cc-qty').getAttribute('type')).toBe('number');
    expect(byId('cc-qty').getAttribute('min')).toBe('0');
  });

  // :426-444 — Record POSTs /items with trimmed ids; notes omitted when blank.
  it('Record line POSTs /items with the trimmed variant, bin and batch ids', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await openCount();
    await user.type(byId('cc-variant'), '  v-1  ');
    await user.type(byId('cc-qty'), '7');
    await user.type(byId('cc-bin'), '  bin-1  ');
    await user.type(byId('cc-batch'), '  batch-1  ');
    await user.click(screen.getByRole('button', { name: 'Record line' }));
    await waitFor(() =>
      expect(writesSeen(fetchImpl)).toEqual([
        {
          url: '/api/admin/cycle-counts/cc-1/items',
          method: 'POST',
          body: {
            items: [{ variantId: 'v-1', countedQty: 7, binId: 'bin-1', batchId: 'batch-1' }],
          },
        },
      ]),
    );
  });

  // :439 — notes are trimmed and sent only when given.
  it('sends trimmed notes when given', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = await openCount();
    await user.type(byId('cc-variant'), 'v-1');
    await user.type(byId('cc-qty'), '0');
    await user.type(byId('cc-bin'), 'bin-1');
    await user.type(byId('cc-batch'), 'batch-1');
    await user.type(byId('cc-notes'), '  shelf was empty  ');
    await user.click(screen.getByRole('button', { name: 'Record line' }));
    await waitFor(() =>
      expect(writesSeen(fetchImpl)[0]?.body).toEqual({
        items: [
          {
            variantId: 'v-1',
            countedQty: 0,
            binId: 'bin-1',
            batchId: 'batch-1',
            notes: 'shelf was empty',
          },
        ],
      }),
    );
  });

  // :416-425 — Record stays disabled until variant, quantity, bin and batch are all filled.
  it('Record line is disabled while bin or batch is blank', async () => {
    const user = userEvent.setup();
    await openCount();
    await user.type(byId('cc-variant'), 'v-1');
    await user.type(byId('cc-qty'), '7');
    await user.type(byId('cc-bin'), '   ');
    expect(screen.getByRole('button', { name: 'Record line' })).toBeDisabled();
    await user.clear(byId('cc-bin'));
    await user.type(byId('cc-bin'), 'bin-1');
    expect(screen.getByRole('button', { name: 'Record line' })).toBeDisabled();
    await user.type(byId('cc-batch'), 'batch-1');
    expect(screen.getByRole('button', { name: 'Record line' })).not.toBeDisabled();
  });
});
