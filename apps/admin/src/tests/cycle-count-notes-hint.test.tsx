/**
 * The recording form on a cycle count.
 *
 * Bin and batch really are required — a count is per bin and per batch,
 * and the server refuses a line without them. Notes are not, and the box
 * carried the bin/batch sentence copied down onto it: an optional field
 * telling a counter it was required, with a reason belonging to two other
 * fields. Found by filming it (L2, 2026-10-01).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@skydrop/ui/app/toast';

const COUNT = {
  id: 'cc-1',
  warehouseId: '019fa2f0-01d3-7c5d-873e-24a58d37aaaa',
  zoneId: null,
  countType: 'FULL',
  countDate: '2026-10-01T00:00:00.000Z',
  status: 'IN_PROGRESS',
  startedAt: '2026-10-01T10:00:00.000Z',
  completedAt: null,
  discrepancyCount: 0,
  totalDiscrepancyValueInr: '0',
  items: [],
};

const idle = { isPending: false, isError: false, isSuccess: false, error: null, mutate: vi.fn() };

vi.mock('@/lib/inventory-hooks', () => ({
  useCycleCountsList: () => ({
    isLoading: false,
    isError: false,
    data: { items: [COUNT], total: 1 },
  }),
  useCreateCycleCount: () => ({ ...idle, reset: vi.fn() }),
  useStartCycleCount: () => ({ ...idle, reset: vi.fn() }),
  useRecordCycleCountItems: () => ({ ...idle, reset: vi.fn() }),
  useCompleteCycleCount: () => ({ ...idle, reset: vi.fn() }),
}));
vi.mock('@/lib/ops-hooks', () => ({ useWarehouseOptions: () => ({ data: [] }) }));

import { CycleCountsIndex } from '../app/(authed)/inventory/cycle-counts/_components/cycle-counts-index';

async function openTheCount(): Promise<void> {
  render(
    <ToastProvider>
      <CycleCountsIndex />
    </ToastProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
}

describe('recording a counted line', () => {
  it('says bin and batch are required', async () => {
    await openTheCount();
    expect(screen.getAllByText('Required — a count is per bin and batch')).toHaveLength(2);
  });

  it('does not tell the counter that notes are required', async () => {
    await openTheCount();
    const notes = screen.getByLabelText('Notes');
    const hint = document.getElementById(`${notes.id}-hint`);
    expect(hint?.textContent ?? '').not.toMatch(/required/i);
    expect(hint?.textContent ?? '').toMatch(/optional/i);
  });
});
