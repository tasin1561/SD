/**
 * Printing → "Find a product" → Labels — `(authed)/warehouse/printing/_components/printing-station.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. The label quantity for
 * a sticker that fell off is asked with `window.prompt` (:870-874), parsed
 * as an integer, and sent as ONE item to `sku-labels/variants`. A cancelled
 * or nonsensical answer sends nothing. If a restyle replaces the prompt
 * with an in-page field, this spec must be rewritten deliberately — the
 * body and the "cancel sends nothing" rule must survive the change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrintingStation } from '@/app/(authed)/warehouse/printing/_components/printing-station';
import { renderWithProviders } from './helpers';
import { requestsTo, scanFetch } from './scan-fetch';

const LOCATION = {
  variantId: 'v-1',
  skuCode: 'SKU-A',
  productName: 'Aviator Sunglass',
  variantLabel: null,
  barcode: null,
  sellerCompanyName: 'Menev Store',
  locations: [],
};

async function openLocate(): Promise<ReturnType<typeof renderWithProviders>> {
  const r = renderWithProviders(<PrintingStation />, {
    fetchImpl: scanFetch([
      {
        match: /\/api\/admin\/warehouse\/printing\/sku-labels\/variants$/,
        method: 'POST',
        // A refusal keeps the page on the search (a success would swap in
        // the sticker sheet); the body is what is pinned either way.
        reply: {
          status: 409,
          body: { code: 'STRICT_PRODUCT_USES_SERIALS', message: 'Strict products use serials.' },
        },
      },
      {
        match: /\/api\/admin\/warehouse\/printing\/product-locations\?/,
        method: 'GET',
        reply: { status: 200, body: [LOCATION] },
      },
      {
        match: /\/api\/admin\/warehouse\/printing\/sku-labels\/history$/,
        method: 'GET',
        reply: { status: 200, body: [] },
      },
      {
        match: /\/api\/admin\/warehouse\/printing\//,
        method: 'GET',
        reply: { status: 200, body: [] },
      },
    ]),
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Find a product' }));
  await user.type(screen.getByRole('textbox', { name: 'Find a product' }), 'SKU-A');
  await screen.findByText('Aviator Sunglass');
  return r;
}

const LABELS = /\/sku-labels\/variants$/;

/**
 * `window.prompt` replaced for the test (the setup file's afterEach
 * unstubs every global). happy-dom's own prompt answers nothing useful.
 */
function stubPrompt(answer: string | null): ReturnType<typeof vi.fn> {
  const prompt = vi.fn<(message?: string, defaultValue?: string) => string | null>(() => answer);
  vi.stubGlobal('prompt', prompt);
  return prompt;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('printing — label quantity via window.prompt', () => {
  // printing-station.tsx:870-878 — the prompt's answer is parsed and POSTed as one item.
  it('parses the prompt answer and POSTs sku-labels/variants with { items: [{ variantId, quantity }] }', async () => {
    const prompt = stubPrompt('3');
    const user = userEvent.setup();
    const { fetchImpl } = await openLocate();
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    expect(prompt).toHaveBeenCalledWith('How many labels for SKU-A?', '1');
    await waitFor(() =>
      expect(requestsTo(fetchImpl, LABELS, 'POST')).toEqual([
        {
          url: '/api/admin/warehouse/printing/sku-labels/variants',
          method: 'POST',
          body: { items: [{ variantId: 'v-1', quantity: 3 }] },
        },
      ]),
    );
  });

  // :872 — Number.parseInt: "4 labels" is 4.
  it('parses the leading integer of the answer', async () => {
    stubPrompt('4 labels');
    const user = userEvent.setup();
    const { fetchImpl } = await openLocate();
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await waitFor(() =>
      expect(requestsTo(fetchImpl, LABELS, 'POST')[0]?.body).toEqual({
        items: [{ variantId: 'v-1', quantity: 4 }],
      }),
    );
  });

  // :871 — a cancelled prompt sends nothing.
  it('a cancelled prompt makes no request', async () => {
    stubPrompt(null);
    const user = userEvent.setup();
    const { fetchImpl } = await openLocate();
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(requestsTo(fetchImpl, LABELS, 'POST')).toEqual([]);
  });

  // :873 — zero, negative or non-numeric answers send nothing.
  it('an answer below 1 or not a number makes no request', async () => {
    const prompt = stubPrompt(null);
    const user = userEvent.setup();
    const { fetchImpl } = await openLocate();
    for (const answer of ['0', '-2', 'abc', '']) {
      prompt.mockReturnValueOnce(answer);
      await user.click(screen.getByRole('button', { name: 'Labels' }));
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(requestsTo(fetchImpl, LABELS, 'POST')).toEqual([]);
  });
});
