import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { PendingOrdersIndex } from '@/app/(authed)/orders/pending/_components/pending-orders-index';
import { buildFetchMock, makeSeller, renderWithProviders } from './helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders/pending',
  useSearchParams: () => new URLSearchParams(),
}));

const FULL = /orders-pending$/;
const COMPACT = /orders-pending\/compact$/;
const FIXES = /orders-pending\/bulk-fix$/;
const APPLY = /orders-pending\/bulk-fix\/apply$/;
const SET_FIELD = /orders-pending\/bulk\/set-field$/;
const DISCARD = /orders-pending\/bulk\/discard$/;

const many = (body: unknown) => Array.from({ length: 8 }, () => ({ status: 200, body }));

function full(n: number, sku: string, problems: { field: string; reason: string }[]) {
  return {
    id: `r${n}`,
    uploadId: 'u1',
    rowNumber: n + 1,
    status: 'NEEDS_INPUT',
    data: {
      externalRef: `FB-${n}`,
      productSku: sku,
      quantity: '1',
      customerName: `Customer ${n}`,
      customerPhone: '+919800000000',
      pinCode: '742202',
      codAmount: '900',
    },
    problems,
    duplicateOf: null,
    resolvedOrderId: null,
    createdAt: '2026-11-19T10:00:00Z',
  };
}
const SKU_BAD = [{ field: 'productSku', reason: "SKU 'Elite Collagen' not found." }];
const ROWS = [
  full(1, 'Elite Collagen', SKU_BAD),
  full(2, 'Elite Collagen', SKU_BAD),
  full(3, 'AV-BLK', []),
];
const LINES = ROWS.map((r) => ({
  id: r.id,
  rowNumber: r.rowNumber,
  externalRef: r.data.externalRef,
  customerName: r.data.customerName,
  phone: r.data.customerPhone,
  pinCode: r.data.pinCode,
  sku: r.data.productSku,
  qty: '1',
  codAmount: '900',
  problemCount: r.problems.length,
  status: 'NEEDS_INPUT',
}));
const GROUPS = {
  groups: [
    {
      field: 'productSku',
      kind: 'SKU_NOT_FOUND',
      badValue: 'Elite Collagen',
      reason: "SKU 'Elite Collagen' not found",
      rowCount: 2,
      rowIds: ['r1', 'r2'],
      suggestions: [{ value: 'COFFEE-250', label: 'Coffee' }],
    },
  ],
};

function mount(extra: Parameters<typeof buildFetchMock>[0] = []) {
  const fetchImpl = buildFetchMock([
    ...extra,
    { match: COMPACT, responses: many(LINES) },
    { match: FIXES, responses: many(GROUPS) },
    { match: FULL, responses: many(ROWS) },
  ]);
  renderWithProviders(
    <ToastProvider>
      <PendingOrdersIndex />
    </ToastProvider>,
    {
      fetchImpl,
      // The page's own permission: without it the full rows are never asked for.
      identity: makeSeller({
        permissions: ['orders.view', 'orders.create', 'orders.pending.manage'],
      }),
    },
  );
  return fetchImpl;
}

const bodyOf = (fetchImpl: ReturnType<typeof buildFetchMock>, re: RegExp) => {
  const call = fetchImpl.mock.calls.find(
    (c) => re.test(String(c[0])) && (c[1] as RequestInit | undefined)?.method === 'POST',
  );
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
};

describe('pending orders, list-first', () => {
  it('opens on a compact list: one line per row, editors closed', async () => {
    mount();
    const table = await screen.findByRole('table', { name: 'Rows waiting' });
    expect(within(table).getByText('Row 2')).toBeInTheDocument();
    expect(within(table).getByText('Row 4')).toBeInTheDocument();
    expect(within(table).getAllByText('1 to fix')).toHaveLength(2);
    expect(within(table).getByText('Ready to import')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import as order' })).toBeNull();
  });

  it('opens a row into its editor, and Next / Previous walk the rows that need fixing', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open row 2' }));
    expect(await screen.findByRole('button', { name: 'Import as order' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('FB-1')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByDisplayValue('FB-2')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    // Row 4 has nothing to fix, so there is nowhere further to go.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close row 3' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('applies one fix to a whole group and shows a result per row, amber when more is needed', async () => {
    const fetchImpl = mount([
      {
        match: APPLY,
        responses: [
          {
            status: 200,
            body: {
              matched: 2,
              results: [
                {
                  rowId: 'r1',
                  rowNumber: 2,
                  outcome: 'fixed',
                  problems: [],
                  imported: false,
                  orderId: null,
                  importError: null,
                },
                {
                  rowId: 'r2',
                  rowNumber: 3,
                  outcome: 'stillHasProblems',
                  problems: [{ field: 'pinCode', reason: 'The PIN code is missing.' }],
                  imported: false,
                  orderId: null,
                  importError: null,
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(await screen.findByText("SKU 'Elite Collagen' not found")).toBeInTheDocument();
    expect(screen.getByLabelText('Change to')).toHaveValue('COFFEE-250');
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 rows' }));

    const results = await screen.findByRole('list', { name: 'Result for each row' });
    expect(bodyOf(fetchImpl, APPLY)).toEqual({
      field: 'productSku',
      fromValue: 'Elite Collagen',
      toValue: 'COFFEE-250',
      rowIds: ['r1', 'r2'],
    });
    const chips = within(results).getAllByRole('listitem');
    expect(chips[0]).toHaveTextContent('Row 2');
    expect(within(chips[0]!).getByText('Fixed')).toHaveAttribute('data-tone', 'good');
    expect(
      within(chips[1]!).getByText('Saved, but still needs: The PIN code is missing.'),
    ).toHaveAttribute('data-tone', 'warn');
  });

  it('asks before "Apply and import", then sends importAfterFix', async () => {
    const fetchImpl = mount([
      { match: APPLY, responses: [{ status: 200, body: { matched: 0, results: [] } }] },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply and import' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Apply and import 2 rows?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply and import' }));
    await waitFor(() => expect(bodyOf(fetchImpl, APPLY).importAfterFix).toBe(true));
    expect(
      await screen.findByText('No waiting row still has this value. Nothing changed.'),
    ).toBeInTheDocument();
  });

  it('selects the rows of one problem, then sets a field on them with a fresh key', async () => {
    const fetchImpl = mount([
      {
        match: SET_FIELD,
        responses: [
          {
            status: 200,
            body: {
              action: 'set-field',
              results: [
                { rowId: 'r1', outcome: 'DONE' },
                {
                  rowId: 'r2',
                  outcome: 'DONE',
                  message: 'Saved, but still needs: The PIN code is missing.',
                },
              ],
              done: 2,
              skipped: 0,
              failed: 0,
              replayed: false,
            },
          },
        ],
      },
    ]);
    fireEvent.change(await screen.findByLabelText('Select rows with this problem'), {
      target: { value: '0' },
    });
    const bar = await screen.findByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Row 4')).not.toBeChecked();

    fireEvent.click(within(bar).getByRole('button', { name: 'Set field…' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Set value' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Field'), { target: { value: 'productSku' } });
    fireEvent.change(within(dialog).getByLabelText(/New value/), {
      target: { value: 'COFFEE-250' },
    });
    fireEvent.click(confirm);

    expect(
      await screen.findByText('Set field…: 2 done · 0 skipped · 0 failed'),
    ).toBeInTheDocument();
    const body = bodyOf(fetchImpl, SET_FIELD);
    expect(body).toMatchObject({ rowIds: ['r1', 'r2'], field: 'productSku', value: 'COFFEE-250' });
    expect(String(body.idempotencyKey).length).toBeGreaterThanOrEqual(8);
    // On the row itself too, amber.
    const table = screen.getByRole('table', { name: 'Rows waiting' });
    expect(
      within(table).getByText('Saved, but still needs: The PIN code is missing.'),
    ).toHaveAttribute('data-tone', 'warn');
  });

  it('confirms before discarding the ticked rows', async () => {
    const fetchImpl = mount([
      {
        match: DISCARD,
        responses: [
          {
            status: 200,
            body: {
              action: 'discard',
              results: [{ rowId: 'r3', outcome: 'DONE' }],
              done: 1,
              skipped: 0,
              failed: 0,
              replayed: false,
            },
          },
        ],
      },
    ]);
    fireEvent.click(await screen.findByLabelText('Select Row 4'));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard selected' }));
    expect(fetchImpl.mock.calls.some((c) => DISCARD.test(String(c[0])))).toBe(false);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard 1 rows?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard rows' }));
    await waitFor(() => expect(bodyOf(fetchImpl, DISCARD).rowIds).toEqual(['r3']));
  });
});
