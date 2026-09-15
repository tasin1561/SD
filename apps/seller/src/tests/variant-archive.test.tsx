/**
 * Archiving / restoring ONE variant.
 *
 * Restoring a product deliberately leaves its variants archived, and the
 * product page's toast tells the seller to restore the ones they want —
 * which was impossible until this button existed. Pinned: the archive
 * asks first, the restore does not, the endpoint is the right one, a
 * server refusal is shown VERBATIM (FE-2), and a role without
 * catalog.manage does not see the control.
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@skydrop/ui/components';
import { ArchiveVariantButton } from '@/app/(authed)/products/[id]/variants/[variantId]/_components/variant-detail';
import { buildFetchMock, makeSeller, renderWithProviders } from './helpers';

const VARIANT = { id: 'v-1', skuCode: 'SKU-1', status: 'ARCHIVED' };

function ui(archived: boolean): ReactElement {
  return (
    <Toaster>
      <ArchiveVariantButton productId="p-1" variantId="v-1" skuCode="SKU-1" archived={archived} />
    </Toaster>
  );
}

describe('variant archive / restore', () => {
  it('asks before archiving, then calls the archive endpoint', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/seller\/products\/p-1\/variants\/v-1\/archive$/,
        responses: [{ status: 200, body: VARIANT }],
      },
    ]);
    renderWithProviders(ui(false), { fetchImpl });

    await user.click(screen.getByRole('button', { name: 'Archive variant' }));
    // Nothing sent until confirmed.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await screen.findByText('Archive SKU-1?')).toBeTruthy();

    const buttons = screen.getAllByRole('button', { name: 'Archive variant' });
    const confirm = buttons[buttons.length - 1];
    if (confirm === undefined) throw new Error('no confirm button');
    await user.click(confirm);

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/variants\/v-1\/archive$/);
    expect(await screen.findByText(/SKU-1 archived/)).toBeTruthy();
  });

  it('shows the server refusal verbatim inside the confirm', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/variants\/v-1\/archive$/,
        responses: [
          {
            status: 409,
            body: { code: 'VARIANT_HAS_OPEN_ORDERS', message: 'Not while orders are open' },
          },
        ],
      },
    ]);
    renderWithProviders(ui(false), { fetchImpl });

    await user.click(screen.getByRole('button', { name: 'Archive variant' }));
    const buttons = await screen.findAllByRole('button', { name: 'Archive variant' });
    const confirm = buttons[buttons.length - 1];
    if (confirm === undefined) throw new Error('no confirm button');
    await user.click(confirm);

    const verdict = await screen.findByRole('alert');
    expect(verdict.textContent).toBe('[VARIANT_HAS_OPEN_ORDERS] Not while orders are open');
  });

  it('restores without a confirm, through the unarchive endpoint', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/variants\/v-1\/unarchive$/,
        responses: [{ status: 200, body: { ...VARIANT, status: 'ACTIVE' } }],
      },
    ]);
    renderWithProviders(ui(true), { fetchImpl });

    await user.click(screen.getByRole('button', { name: 'Restore variant' }));
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/variants\/v-1\/unarchive$/);
    expect(await screen.findByText(/SKU-1 restored/)).toBeTruthy();
  });

  it('is not offered to a role without catalog.manage', () => {
    renderWithProviders(ui(false), {
      identity: makeSeller({ permissions: ['catalog.view'] }),
    });
    expect(screen.queryByRole('button', { name: 'Archive variant' })).toBeNull();
  });
});
