import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@skydrop/ui/components';
import { RoleEditor } from '@/app/(authed)/roles/_components/role-editor';
import type { Catalogue } from '@/lib/rbac-hooks';
import { buildFetchMock, renderWithProviders } from './helpers';

/**
 * Searching the permission list must not lose what is already ticked.
 *
 * The catalogue is 68 permissions across ten groups, so the editor
 * filters it. The failure that matters is silent: tick a permission,
 * type a search that hides it, save — and if the filter were driving the
 * selection rather than only the rendering, the role would quietly lose
 * a permission nobody chose to remove. There is no error, no toast, and
 * the difference only shows up later as somebody unable to do their job.
 *
 * So the assertion is on the REQUEST BODY, not on the checkboxes: what
 * the server is told is the only thing that decides what the role holds.
 */

const CATALOGUE: Catalogue = {
  groups: ['Orders', 'Warehouse'],
  permissions: [
    {
      key: 'orders.view',
      label: 'View orders',
      description: 'The order list and an order’s detail.',
      group: 'Orders',
      dangerous: false,
    },
    {
      key: 'orders.override',
      label: 'God-mode override',
      description: 'Force an order into any status.',
      group: 'Orders',
      dangerous: true,
    },
    {
      key: 'warehouse.rto.finalize',
      label: 'Finalise a return',
      description: 'Decide restock or write-off per item.',
      group: 'Warehouse',
      dangerous: true,
    },
  ],
};

function renderEditor(fetchImpl: ReturnType<typeof vi.fn>) {
  return renderWithProviders(
    <Toaster>
      <RoleEditor role={null} catalogue={CATALOGUE} open onClose={() => {}} />
    </Toaster>,
    { fetchImpl },
  );
}

describe('role editor — permission search', () => {
  it('filters by label, by explanation and by permission key', async () => {
    const user = userEvent.setup();
    renderEditor(buildFetchMock([]));
    const box = screen.getByLabelText('Search permissions');

    await user.type(box, 'return');
    expect(screen.getByText('Finalise a return')).toBeInTheDocument();
    expect(screen.queryByText('View orders')).not.toBeInTheDocument();

    // Matches the DESCRIPTION, which is where the real vocabulary lives —
    // "write-off" appears in no label.
    await user.clear(box);
    await user.type(box, 'write-off');
    expect(screen.getByText('Finalise a return')).toBeInTheDocument();

    // Matches the KEY, which is what somebody reading a 403 in a log has.
    await user.clear(box);
    await user.type(box, 'orders.override');
    expect(screen.getByText('God-mode override')).toBeInTheDocument();
    expect(screen.queryByText('Finalise a return')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    const user = userEvent.setup();
    renderEditor(buildFetchMock([]));
    await user.type(screen.getByLabelText('Search permissions'), 'zzzznope');
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it('SAVES a permission that was ticked and then searched out of view', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/admin\/staff-roles$/,
        responses: [{ status: 201, body: { id: 'r1', key: 'x', name: 'x', permissions: [] } }],
      },
    ]);
    renderEditor(fetchImpl);

    await user.type(screen.getByLabelText('Name'), 'Returns desk');

    // Tick something in Orders…
    await user.click(screen.getByRole('checkbox', { name: /View orders/i }));
    // …then search for something else entirely, hiding it.
    await user.type(screen.getByLabelText('Search permissions'), 'return');
    expect(screen.queryByText('View orders')).not.toBeInTheDocument();
    // The count has to admit the hidden tick, or "1 of 3" over an empty
    // list reads as if it was dropped.
    expect(screen.getByText(/1 selected not shown/)).toBeInTheDocument();

    // …and tick a visible one too.
    await user.click(screen.getByRole('checkbox', { name: /Finalise a return/i }));
    await user.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        (c) =>
          String(c[0]).includes('/admin/staff-roles') &&
          (c[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(call, 'no create request was issued').toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: unknown } | undefined)?.body)) as {
        permissions: string[];
      };
      expect([...body.permissions].sort()).toEqual(['orders.view', 'warehouse.rto.finalize']);
    });
  });
});
