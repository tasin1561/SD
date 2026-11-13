/**
 * The pack bench's scan field, pinned BEFORE the bench is restyled
 * (2026-11-13). A scan gun types a code and presses Enter by itself, into
 * whatever has focus, so three things are the whole bench:
 *
 *   1. Enter in the field sends the scan — and WHAT it sends depends on
 *      state: no box → open by label; box open → a product goes in; the
 *      label again → close.
 *   2. Focus comes back to the field after every scan, or the next one
 *      goes nowhere.
 *   3. A refused scan STOPS the field until somebody says they fixed it.
 *
 * None of this had a test. A restyle that moved the field, dropped the
 * Enter handler or lost the refocus would have stopped the warehouse with
 * every other suite green.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { PackStation } from '@/app/(authed)/warehouse/pack/_components/pack-station';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const AWB = '38061110634966';
const BOX = {
  packBoxId: 'box-1',
  shipmentId: 'ship-1',
  orderId: 'order-1',
  awbNumber: AWB,
  expiresAt: '2099-01-01T00:00:00.000Z',
  alreadyOpen: false,
  expected: [
    {
      variantId: 'v1',
      skuCode: 'AVIATO-BLAC-GOLD',
      productName: 'Aviator',
      quantity: 2,
      thumbnailUrl: null,
    },
  ],
};
const SCAN_OK = {
  packBoxId: 'box-1',
  variantId: 'v1',
  skuCode: 'AVIATO-BLAC-GOLD',
  stockUnitId: null,
  expiresAt: '2099-01-01T00:05:00.000Z',
};

const ok = <T,>(body: T, n = 1): Array<{ status: number; body: T }> =>
  Array.from({ length: n }, () => ({ status: 200, body }));

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function sent(fetchImpl: ReturnType<typeof buildFetchMock>): Sent[] {
  return fetchImpl.mock.calls
    .map(([input, init]) => {
      const i = init as RequestInit | undefined;
      return {
        url: String(input),
        method: (i?.method ?? 'GET').toUpperCase(),
        body: typeof i?.body === 'string' ? (JSON.parse(i.body) as unknown) : null,
      };
    })
    .filter((c) => c.method !== 'GET');
}

function mount(scanResponses: Array<{ status: number; body: unknown }>) {
  const fetchImpl = buildFetchMock([
    { match: /\/courier\/scan-block/, responses: ok(null, 20) },
    { match: /\/packs\/boxes\/open$/, responses: ok(BOX) },
    { match: /\/packs\/boxes\/box-1\/scan$/, responses: scanResponses },
    { match: /\/packs\/boxes\/box-1\/close$/, responses: ok({ manifestNumber: null }) },
  ]);
  const view = renderWithProviders(
    <ToastProvider>
      <PackStation />
    </ToastProvider>,
    { fetchImpl, identity: makeStaff(['WAREHOUSE'], ['warehouse.pack']) },
  );
  return { ...view, fetchImpl };
}

const field = (): HTMLInputElement => document.getElementById('pack-scan') as HTMLInputElement;

describe('pack bench: the scan field', () => {
  it('Enter sends the scan; label → product → label again is open → scan → close', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount(ok(SCAN_OK, 2));
    await waitFor(() => expect(field()).not.toBeNull());

    // 1. Nothing open: the code is a shipping label.
    await user.type(field(), `${AWB}{Enter}`);
    await waitFor(() => expect(sent(fetchImpl)).toHaveLength(1));
    expect(sent(fetchImpl)[0]?.url).toMatch(/\/packs\/boxes\/open$/);
    expect(sent(fetchImpl)[0]?.body).toEqual({ awbNumber: AWB });
    // Cleared and holding focus, ready for the next scan with no click.
    await waitFor(() => expect(field().value).toBe(''));
    await waitFor(() => expect(document.activeElement).toBe(field()));

    // 2. Box open: anything else is a product going in. Surrounding
    //    whitespace from a reader is trimmed.
    await user.type(field(), ` AVIATO-BLAC-GOLD {Enter}`);
    await waitFor(() => expect(sent(fetchImpl)).toHaveLength(2));
    expect(sent(fetchImpl)[1]?.url).toMatch(/\/packs\/boxes\/box-1\/scan$/);
    expect(sent(fetchImpl)[1]?.body).toEqual({ code: 'AVIATO-BLAC-GOLD' });
    await waitFor(() => expect(document.activeElement).toBe(field()));

    await user.type(field(), `AVIATO-BLAC-GOLD{Enter}`);
    await waitFor(() => expect(sent(fetchImpl)).toHaveLength(3));
    await waitFor(() => expect(document.activeElement).toBe(field()));

    // 3. The label again closes the box.
    await user.type(field(), `${AWB}{Enter}`);
    await waitFor(() => expect(sent(fetchImpl)).toHaveLength(4));
    expect(sent(fetchImpl)[3]?.url).toMatch(/\/packs\/boxes\/box-1\/close$/);
    expect(sent(fetchImpl)[3]?.body).toEqual({ awbNumber: AWB });
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it('an empty Enter sends nothing', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([]);
    await waitFor(() => expect(field()).not.toBeNull());
    await user.type(field(), `   {Enter}`);
    expect(sent(fetchImpl)).toHaveLength(0);
  });

  it('a refused scan stops the field until it is acknowledged, then gives focus back', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([
      {
        status: 409,
        body: { code: 'PACK_ITEM_NOT_ON_ORDER', message: 'That product is not on this order' },
      },
    ]);
    await waitFor(() => expect(field()).not.toBeNull());
    await user.type(field(), `${AWB}{Enter}`);
    await waitFor(() => expect(sent(fetchImpl)).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(field()));

    await user.type(field(), `WRONG-THING{Enter}`);
    // Blocking: a dialog is up, the server's words are on it verbatim
    // (FE-2), and the field is disabled so the next scan cannot land.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      '[PACK_ITEM_NOT_ON_ORDER] That product is not on this order',
    );
    expect(field().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: /i have fixed it/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field().disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });
});
