import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStoreUser, renderStoreScreen } from './helpers';

const ASSOCIATE = '019fad84-0000-7000-8000-0000000000aa';
const VARIANT = '019fad84-0000-7000-8000-0000000000bb';

vi.mock('next/navigation', () => ({
  useParams: () => ({ storeUserId: ASSOCIATE }),
}));

// Imported AFTER the mock, so the page picks it up.
const { default: AssociatePricesPage } =
  await import('../app/(authed)/associates/[storeUserId]/prices/page');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PRICES = {
  storeUserId: ASSOCIATE,
  fullName: 'Rupa Das',
  email: 'rupa@kurtacorner.example',
  ordersPausedAt: null,
  rows: [
    {
      variantId: VARIANT,
      productName: 'Cotton Kurta',
      variantLabel: 'Blue / M',
      skuCode: 'KURTA-BLU-M',
      retailPriceInr: '500.00',
      minRetailInr: '450.00',
      maxRetailInr: '600.00',
      suggestedRetailInr: '550.00',
      outOfRange: false,
      setAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

/**
 * ASSOC-1 / FE-2 — the seller's range is SAID before the refusal, and
 * the refusal itself is the server's.
 *
 * Both halves matter and they pull in opposite directions. The range has
 * to be on screen beside the field, or the form is a guessing game. But
 * it must NOT be enforced here: a second copy of
 * `ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE` in a browser is a rule able to
 * disagree with the one that counts — and it would disagree the moment
 * the seller moved the range while this screen was open, refusing a
 * price the server would have taken.
 *
 * So the test submits a figure OUTSIDE the stated range and asserts the
 * request was actually sent. A client-side mirror would make that
 * assertion fail, which is the point.
 */
describe('an associate’s price — the range before the refusal (ASSOC-1, FE-2)', () => {
  function fetchImpl(onPut: () => Response): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/prices/') && method === 'PUT') return onPut();
      if (url.includes(`/associates/${ASSOCIATE}/prices`)) return json(PRICES);
      if (url.includes('/associates')) {
        return json({
          sellableProducts: 1,
          associates: [
            {
              storeUserId: ASSOCIATE,
              fullName: 'Rupa Das',
              email: 'rupa@kurtacorner.example',
              ordersPausedAt: null,
              lastLoginAt: null,
              pricedProducts: 1,
              unpricedProducts: 0,
              outOfRangePrices: 0,
            },
          ],
        });
      }
      return json({});
    });
  }

  it('states the seller’s range beside the field, before anything is refused', async () => {
    renderStoreScreen(<AssociatePricesPage />, {
      identity: makeStoreUser({ permissions: ['associates.manage'] }),
      fetchImpl: fetchImpl(() => json(PRICES.rows.at(0))),
    });

    // The range is the column, so it is readable while the price is
    // being typed rather than only after a refusal.
    expect(await screen.findByText('Sell between')).toBeInTheDocument();
    const row = (await screen.findByText('Cotton Kurta')).closest('tr');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('450');
    expect(row?.textContent).toContain('600');
  });

  it('SENDS a price outside the range and shows the server’s verdict verbatim', async () => {
    const put = vi.fn(() =>
      json(
        {
          code: 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE',
          message: 'Your seller allows between ₹450.00 and ₹600.00 for this product.',
        },
        409,
      ),
    );
    const { fetchImpl: calls } = renderStoreScreen(<AssociatePricesPage />, {
      identity: makeStoreUser({ permissions: ['associates.manage'] }),
      fetchImpl: fetchImpl(put),
    });

    const field = await screen.findByLabelText('What they sell Cotton Kurta at, in rupees');
    await userEvent.clear(field);
    await userEvent.type(field, '900');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The refusal, in the server's own words, code first (FE-2).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE] Your seller allows between ₹450.00 and ₹600.00 for this product.',
    );

    // And it really was SENT — nothing here re-implemented the range.
    // A client-side mirror of the rule would refuse before the request,
    // and this assertion is what would catch it.
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const sent = calls.mock.calls.find((c) => {
      const init = c[1] as RequestInit | undefined;
      return String(c[0]).includes('/prices/') && init?.method === 'PUT';
    });
    expect(sent).toBeDefined();
    expect(String((sent?.[1] as RequestInit | undefined)?.body)).toContain('900');
  });
});
