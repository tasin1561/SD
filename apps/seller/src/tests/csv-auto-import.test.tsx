/**
 * The orders importer imports WITHOUT a click only when the preview proved
 * there is nothing for a person to decide; otherwise it stops on the review
 * dialog with one line saying why. The guard is the point (ORD-9: a re-upload
 * UPDATES an existing order, so a mis-read file can overwrite good ones).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider as Toaster } from '@skydrop/ui/app/toast';
import { CsvImportPanel } from '@/app/(authed)/orders/_components/csv-import-panel';
import { decideAutoImport } from '@/app/(authed)/orders/_components/import-auto';
import { buildFetchMock, renderWithProviders } from './helpers';

const base = {
  rowCount: 14,
  headers: [],
  sampleRows: [],
  mapping: {},
  unmatchedHeaders: [],
  exceedsRowLimit: false,
  rowLimit: 5000,
};
const problem = { rowNumber: 4, field: 'addressLine2', reason: 'Landmark is required' };

async function uploadWith(preview: object, kind: 'orders' | 'catalog' = 'orders') {
  const fetchImpl = buildFetchMock([
    {
      match: /\/presign$/,
      responses: [{ status: 200, body: { spacesKey: 'k1', uploadUrl: 'https://spaces.test/put' } }],
    },
    { match: /spaces\.test\/put$/, responses: [{ status: 200 }] },
    { match: /\/preview$/, responses: [{ status: 200, body: preview }] },
    {
      match: /\/process$/,
      responses: [{ status: 200, body: { id: 'u1', fileName: 'o.csv', status: 'PENDING' } }],
    },
  ]);
  const { container } = renderWithProviders(
    <Toaster>
      <CsvImportPanel kind={kind} endpointBase="/api/seller/x" templateFileName="t.csv" />
    </Toaster>,
    { fetchImpl },
  );
  const user = userEvent.setup();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['a'], 'o.csv', { type: 'text/csv' }));
  await user.click(screen.getByRole('button', { name: /upload and check/i }));
  return fetchImpl;
}

const processCalls = (f: ReturnType<typeof buildFetchMock>): number =>
  f.mock.calls.filter((c) => /\/process$/.test(String(c[0]))).length;

describe('decideAutoImport', () => {
  const ok = { rowCount: 3, orderCount: 3, missingRequired: [], exceedsRowLimit: false };
  it('is allowed for a clean orders preview', () => {
    expect(decideAutoImport('orders', ok)).toEqual({ auto: true });
    expect(decideAutoImport('orders', { ...ok, rowsWithProblems: 3 })).toEqual({ auto: true });
  });
  it('stops on each reason', () => {
    expect(decideAutoImport('orders', { ...ok, missingRequired: ['x'] })).toMatchObject({
      reason: 'missing',
    });
    expect(decideAutoImport('orders', { ...ok, exceedsRowLimit: true })).toMatchObject({
      reason: 'blocked',
    });
    expect(decideAutoImport('orders', { ...ok, orderCount: 0 })).toMatchObject({ reason: 'none' });
    expect(decideAutoImport('orders', { ...ok, rowsWithProblems: 4 })).toMatchObject({
      reason: 'mostly',
    });
  });
  it('never applies to the catalogue importer', () => {
    expect(decideAutoImport('catalog', ok)).toEqual({ auto: false, reason: null });
  });
});

describe('the panel', () => {
  it('imports a clean mapping with no click, in progress, exactly once', async () => {
    const f = await uploadWith({
      ...base,
      orderCount: 5,
      missingRequired: [],
      rowsWithProblems: 2,
      problems: [problem],
    });
    const dlg = await screen.findByRole('dialog');
    // "being created", not "created": /process queues the job, so this
    // count is the check's, not a finished import's.
    await waitFor(() =>
      expect(dlg).toHaveAccessibleName('5 orders being created, 2 rows rejected.'),
    );
    expect(within(dlg).getByText('Row 4')).toBeTruthy();
    expect(within(dlg).queryByRole('button', { name: /import/i })).toBeNull();
    expect(processCalls(f)).toBe(1);
  });

  it('does not auto-import when a required column is missing', async () => {
    const f = await uploadWith({ ...base, orderCount: 5, missingRequired: ['customerPhone'] });
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/a required column was not found/)).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: /import 5 orders/i })).toBeTruthy();
    expect(processCalls(f)).toBe(0);
  });

  it('does not auto-import a mostly-rejected file', async () => {
    const f = await uploadWith({
      ...base,
      orderCount: 2,
      missingRequired: [],
      rowsWithProblems: 9,
      problems: [problem],
    });
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/most rows were rejected/)).toBeTruthy();
    expect(processCalls(f)).toBe(0);
  });

  it('does not auto-import when zero orders are importable', async () => {
    const f = await uploadWith({
      ...base,
      orderCount: 0,
      missingRequired: [],
      rowsWithProblems: 4,
      problems: [problem],
    });
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/no order in this file can be created/)).toBeTruthy();
    expect(processCalls(f)).toBe(0);
  });

  it('keeps the click for the catalogue importer', async () => {
    const f = await uploadWith({ ...base, missingRequired: [] }, 'catalog');
    await screen.findByRole('dialog');
    expect(processCalls(f)).toBe(0);
  });
});
