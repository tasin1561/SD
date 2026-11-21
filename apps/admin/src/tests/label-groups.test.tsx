import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  LabelGroupsPanel,
  oldestAgo,
} from '@/app/(authed)/warehouse/printing/_components/label-groups';
import { buildFetchMock, renderWithProviders } from './helpers';

vi.mock('@/lib/print-pdf', () => ({ downloadPdf: vi.fn(), printPdf: vi.fn() }));
import { downloadPdf } from '@/lib/print-pdf';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const GROUPS = /printing\/label-groups$/;
const PRINT = /printing\/label-groups\/print$/;
const CONFIRM = /printing\/labels\/confirm-printed$/;

const many = (body: unknown) => Array.from({ length: 6 }, () => ({ status: 200, body }));

const LIST = {
  groupSize: 30,
  totalParcels: 5,
  groups: [
    {
      key: 'g1',
      courierCode: 'DELHIVERY',
      courierName: 'Delhivery',
      warehouseId: 'w1',
      label: 'Delhivery · Group 1',
      size: 3,
      shipmentIds: ['s1', 's2', 's3'],
      oldestPlacedAt: '2026-11-19T12:00:00Z',
    },
    {
      key: 'g2',
      courierCode: 'DELHIVERY',
      courierName: 'Delhivery',
      warehouseId: 'w1',
      label: 'Delhivery · Group 2',
      size: 2,
      shipmentIds: ['s4', 's5'],
      oldestPlacedAt: null,
    },
  ],
};

const DONE = {
  batchId: 'b1',
  batchNumber: 'PB-2026-11-000042',
  pdfBase64: 'JVBERi0=',
  fileName: 'labels-PB-2026-11-000042.pdf',
  shipmentCount: 4,
  pageCount: 4,
  failed: [{ shipmentId: 's5', shipmentNumber: 'SHP-2026-00095', reason: 'No AWB yet.' }],
  replayed: false,
};

function mount(extra: Parameters<typeof buildFetchMock>[0] = []) {
  const fetchImpl = buildFetchMock([...extra, { match: GROUPS, responses: many(LIST) }]);
  const onOpenBatch = vi.fn();
  const onOpenReprint = vi.fn();
  renderWithProviders(
    <LabelGroupsPanel onOpenBatch={onOpenBatch} onOpenReprint={onOpenReprint} now={NOW} />,
    { fetchImpl },
  );
  return { fetchImpl, onOpenBatch, onOpenReprint };
}

const posted = (fetchImpl: ReturnType<typeof buildFetchMock>, re: RegExp) =>
  fetchImpl.mock.calls
    .filter((c) => re.test(String(c[0])) && (c[1] as RequestInit | undefined)?.method === 'POST')
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

afterEach(() => vi.clearAllMocks());

describe('printing: label groups', () => {
  it('shows each group as a card with its size and how old its oldest order is', async () => {
    mount();
    const list = await screen.findByRole('list', { name: 'Label groups' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Delhivery · Group 1');
    expect(cards[0]).toHaveTextContent('3 parcels');
    expect(cards[0]).toHaveTextContent('oldest 2 days ago');
    expect(cards[1]).toHaveTextContent('2 parcels');
    expect(cards[1]).not.toHaveTextContent('oldest');
    expect(screen.getByText('2 groups · 5 parcels')).toBeInTheDocument();
  });

  it('keeps Print off until a group is ticked, then shows the parcel count', async () => {
    mount();
    const print = await screen.findByRole('button', { name: 'Print labels' });
    expect(print).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Delhivery · Group 2/ }));
    expect(screen.getByRole('button', { name: 'Print 2 labels' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all groups' }));
    expect(screen.getByRole('button', { name: 'Print 5 labels' })).toBeEnabled();
    expect(screen.getByText('2 groups ticked · 5 parcels')).toBeInTheDocument();
  });

  it('prints the ticked groups with one fresh key, downloads the file, and names the batch', async () => {
    const { fetchImpl, onOpenBatch } = mount([
      { match: PRINT, responses: [{ status: 200, body: DONE }] },
      { match: CONFIRM, responses: [{ status: 200, body: { confirmed: 4, alreadyPrinted: 0 } }] },
    ]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all groups' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print 5 labels' }));

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    expect(downloadPdf).toHaveBeenCalledWith('JVBERi0=', 'labels-PB-2026-11-000042.pdf');
    const bodies = posted(fetchImpl, PRINT);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.shipmentIds).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(String(bodies[0]!.idempotencyKey).length).toBeGreaterThanOrEqual(8);

    // The "labels are on paper" step, with the same parcels.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Picking batch PB-2026-11-000042 created')).toBeInTheDocument();
    expect(within(dialog).getByText('SHP-2026-00095')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Yes, they printed/i }));
    await waitFor(() => expect(posted(fetchImpl, CONFIRM)).toHaveLength(1));
    expect(posted(fetchImpl, CONFIRM)[0]!.shipmentIds).toEqual(['s1', 's2', 's3', 's4', 's5']);

    // The result stays on the tab: the batch, the failed parcel by name, the way on.
    // (The toast is a status too, so the panel's own is picked by its class.)
    const status = document.querySelector<HTMLElement>('.lg-result')!;
    expect(status).toHaveTextContent('Picking batch PB-2026-11-000042 created');
    expect(status).toHaveTextContent('SHP-2026-00095');
    expect(status).toHaveTextContent('No AWB yet.');
    fireEvent.click(within(status).getByRole('button', { name: 'Print its picking list' }));
    expect(onOpenBatch).toHaveBeenCalledWith('PB-2026-11-000042');
  });

  it('says "Already printed" on a replay: no file, no paper question, reprint offered', async () => {
    const { onOpenReprint } = mount([
      {
        match: PRINT,
        responses: [
          {
            status: 200,
            body: { ...DONE, pdfBase64: null, fileName: null, failed: [], replayed: true },
          },
        ],
      },
    ]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Group 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Print 3 labels' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Already printed as PB-2026-11-000042');
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(status).getByRole('button', { name: 'Reprint a label' }));
    expect(onOpenReprint).toHaveBeenCalled();
    expect(within(status).getByRole('button', { name: 'Print its picking list' })).toBeEnabled();
  });

  it('shows a refusal in the server words, clears the ticks and re-reads the groups', async () => {
    const { fetchImpl } = mount([
      {
        match: PRINT,
        responses: [
          {
            status: 409,
            body: {
              code: 'NOT_IN_LABEL_POOL',
              message: '2 of the selected parcels are no longer waiting for a label.',
            },
          },
        ],
      },
    ]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all groups' }));
    const before = fetchImpl.mock.calls.filter((c) => GROUPS.test(String(c[0]))).length;
    fireEvent.click(screen.getByRole('button', { name: 'Print 5 labels' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '[NOT_IN_LABEL_POOL] 2 of the selected parcels are no longer waiting for a label.',
    );
    expect(alert).toHaveTextContent('Tick them again.');
    expect(screen.getByRole('checkbox', { name: 'Select all groups' })).not.toBeChecked();
    await waitFor(() =>
      expect(fetchImpl.mock.calls.filter((c) => GROUPS.test(String(c[0]))).length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('tells the person to wait when the same print is still running', async () => {
    mount([
      {
        match: PRINT,
        responses: [
          {
            status: 409,
            body: { code: 'LABEL_GROUPS_IN_PROGRESS', message: 'This print is already running.' },
          },
        ],
      },
    ]);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Group 2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Print 2 labels' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('[LABEL_GROUPS_IN_PROGRESS] This print is already running.');
    expect(alert).toHaveTextContent('Wait for it to finish');
  });

  it('words the age in minutes, hours or days and never in the future', () => {
    expect(oldestAgo('2026-11-21T11:30:00Z', NOW, 'en-IN')).toBe('30 minutes ago');
    expect(oldestAgo('2026-11-21T07:00:00Z', NOW, 'en-IN')).toBe('5 hours ago');
    expect(oldestAgo('2026-11-18T12:00:00Z', NOW, 'en-IN')).toBe('3 days ago');
    expect(oldestAgo('2026-11-21T12:05:00Z', NOW, 'en-IN')).toBe('this minute');
  });
});
