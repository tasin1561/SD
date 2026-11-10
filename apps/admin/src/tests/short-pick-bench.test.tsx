/**
 * Printing → Past batches → "Short" — a picker reports "found N of M".
 * The one-tap "Picked" action must stay, the call carries exactly the
 * line and count, the result is shown, and a refusal is the server's
 * own words (FE-2).
 */
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrintingStation } from '@/app/(authed)/warehouse/printing/_components/printing-station';
import { wh } from '@/i18n/messages/wh';
import { renderWithProviders } from './helpers';
import { requestsTo, scanFetch, type Reply } from './scan-fetch';

/**
 * The lines a picker reads on this bench. Listed, not prefix-matched: the
 * keys share no single prefix, and a filter that matched none of them
 * would pass vacuously — which is the failure mode this test exists to
 * prevent in the first place.
 */
const SHORT_PICK_KEYS = [
  'warehousePrintingPrintingStation.shortPick',
  'warehousePrintingPrintingStation.shortPickFor',
  'warehousePrintingPrintingStation.shortPickTitle',
  'warehousePrintingPrintingStation.sheetAsked',
  'warehousePrintingPrintingStation.oneLess',
  'warehousePrintingPrintingStation.oneMore',
  'warehousePrintingPrintingStation.record',
  'warehousePrintingPrintingStation.recordFound',
  'warehousePrintingPrintingStation.recordedShort',
] as const;

const BATCH = {
  id: 'b-1',
  batchNumber: 'PB-1',
  status: 'PRINTED',
  warehouseId: 'w-1',
  warehouseName: 'Delhi',
  shipmentCount: 1,
  totalUnits: 0,
  createdAtIso: '2026-11-10T00:00:00Z',
  createdByName: null,
  printedAtIso: '2026-11-10T01:00:00Z',
  printedByName: null,
  printCount: 1,
  shipments: [
    {
      shipmentId: 's-1',
      shipmentNumber: 'SHP-1',
      orderNumber: 'SD-1',
      awbNumber: null,
      items: [
        {
          shipmentItemId: 'si-1',
          skuCode: 'SKU-A',
          productName: 'Aviator',
          variantLabel: null,
          quantity: 3,
        },
      ],
    },
  ],
};

async function open(reply: Reply): Promise<ReturnType<typeof renderWithProviders>> {
  const r = renderWithProviders(<PrintingStation />, {
    fetchImpl: scanFetch([
      { match: /\/short-pick$/, method: 'POST', reply },
      { match: /\/pick-batches/, method: 'GET', reply: { status: 200, body: [BATCH] } },
      { match: /\/warehouse\/printing\//, method: 'GET', reply: { status: 200, body: [] } },
    ]),
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Past batches' }));
  await screen.findByText('PB-1');
  return r;
}

describe('short pick', () => {
  it('keeps the one-tap Picked action beside the new Short action', async () => {
    await open({ status: 200, body: {} });
    expect(screen.getByRole('button', { name: 'Mark PB-1 picked' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report a short pick on PB-1' })).toBeTruthy();
  });

  it('shows the sheet count, steps down, POSTs the line and count, and shows what was saved', async () => {
    const { fetchImpl } = await open({
      status: 200,
      body: { shipmentNumber: 'SHP-1', expected: 3, found: 1 },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Report a short pick on PB-1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('The sheet asks for 3')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'One less' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save: found 1 of 3' }));
    const status = await within(dialog).findByRole('status');
    expect(status.textContent).toContain('1 / 3');
    expect(requestsTo(fetchImpl, /\/short-pick$/, 'POST')).toEqual([
      {
        url: '/api/admin/warehouse/printing/pick-batches/b-1/short-pick',
        method: 'POST',
        body: { shipmentItemId: 'si-1', qtyFound: 1 },
      },
    ]);
  });

  it("renders the server's refusal verbatim and shows no success", async () => {
    await open({
      status: 400,
      body: { code: 'NOT_A_SHORT_PICK', message: 'A short pick must be 0 to 2' },
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Report a short pick on PB-1' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Save: found/ }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('NOT_A_SHORT_PICK');
    expect(alert.textContent).toContain('A short pick must be 0 to 2');
    expect(within(dialog).queryByRole('status')).toBeNull();
  });

  it('never steps the found count below zero', async () => {
    await open({ status: 200, body: {} });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Report a short pick on PB-1' }));
    const dialog = await screen.findByRole('dialog');

    // The sheet asks for 3, so the stepper opens on 2. Five taps of "one
    // less" is more than enough to run past the floor — a picker holding
    // the button down must not be able to send the server a negative.
    const less = within(dialog).getByRole('button', { name: 'One less' });
    for (let i = 0; i < 5; i++) await user.click(less);

    expect(within(dialog).getByRole('button', { name: 'Save: found 0 of 3' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /found -/ })).toBeNull();
  });

  it('is written in all three languages, with Western numerals in Bangla', () => {
    // Guards the vacuous pass: if a key is renamed and dropped from the
    // list above, this count is what notices.
    expect(SHORT_PICK_KEYS.length).toBe(9);
    for (const key of SHORT_PICK_KEYS) {
      const line = (wh as Record<string, readonly string[]>)[key];
      expect(line, key).toBeDefined();
      // en, bn AND hi. The catalogue permits a two-entry line, so Hindi
      // going missing here would be silent without this.
      expect(line?.length, key).toBe(3);
      for (const lang of line ?? []) expect(lang.trim(), key).not.toBe('');
      // Bangla numerals (০-৯) are unreadable to these pickers as counts —
      // every number on this bench stays 0-9 in all three languages.
      expect(line?.[1] ?? '', key).not.toMatch(/[০-৯]/);
    }
  });
});
