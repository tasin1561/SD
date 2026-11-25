/**
 * Picking a NEW file retires the one already checked (2026-11-25).
 *
 * The bug: after file A was uploaded and checked, its review stayed on the
 * page with its Import button while the dialog was closed. Choosing file B
 * only changed the picked name, so pressing that still-visible button sent
 * A's spacesKey to /process and A was imported instead of B.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider as Toaster } from '@skydrop/ui/app/toast';
import { CsvImportPanel } from '@/app/(authed)/orders/_components/csv-import-panel';
import { buildFetchMock, renderWithProviders } from './helpers';

const base = {
  headers: [],
  sampleRows: [],
  mapping: {},
  unmatchedHeaders: [],
  exceedsRowLimit: false,
  rowLimit: 5000,
  missingRequired: [],
};
// A file that STOPS on the review (the server would refuse it over stock),
// so its Import button is live and the review stays up after closing.
const fileAPreview = {
  ...base,
  rowCount: 15,
  orderCount: 15,
  stockCheck: {
    holdsAtPlacement: true,
    blocksImport: true,
    oversold: [{ skuCode: 'AVIATO-BLAC', requested: 500, available: 3 }],
    headline: 'Your account is set to Book Stock At Order Placement.',
    waysForward: 'Either reduce the quantities, or import anyway.',
    lasting: 'That switch applies to EVERY FUTURE ORDER.',
    message: 'all three joined',
  },
};
const fileBPreview = { ...base, rowCount: 55, orderCount: 55, rowsWithProblems: 0, problems: [] };

describe('choosing a new file after one was checked', () => {
  it('removes the old file’s Import, and the next import carries the NEW file', async () => {
    const fetchImpl = buildFetchMock([
      {
        match: /\/presign$/,
        responses: [
          { status: 200, body: { spacesKey: 'key-A', uploadUrl: 'https://spaces.test/put' } },
          { status: 200, body: { spacesKey: 'key-B', uploadUrl: 'https://spaces.test/put' } },
        ],
      },
      { match: /spaces\.test\/put$/, responses: [{ status: 200 }, { status: 200 }] },
      {
        match: /\/preview$/,
        responses: [
          { status: 200, body: fileAPreview },
          { status: 200, body: fileBPreview },
        ],
      },
      {
        match: /\/process$/,
        responses: [{ status: 200, body: { id: 'u2', fileName: 'B.csv', status: 'PENDING' } }],
      },
    ]);
    const { container } = renderWithProviders(
      <Toaster>
        <CsvImportPanel kind="orders" endpointBase="/api/seller/x" templateFileName="t.csv" />
      </Toaster>,
      { fetchImpl },
    );
    const user = userEvent.setup();
    const input = (): HTMLInputElement =>
      container.querySelector('input[type="file"]') as HTMLInputElement;

    // File A: uploaded and checked; it stops on the review.
    await user.upload(input(), new File(['a'], 'A.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: /upload and check/i }));
    await screen.findByRole('dialog');
    // The button names the file it imports.
    expect(screen.getByRole('button', { name: /import 15 orders from A\.csv/i })).toBeTruthy();
    // Close the dialog: A's inline review keeps its Import button.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /from A\.csv/i })).toBeTruthy();

    // File B is picked: nothing on the page can import A any more.
    await user.upload(input(), new File(['b'], 'B.csv', { type: 'text/csv' }));
    expect(screen.queryByRole('button', { name: /from A\.csv/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import \d+ orders/i })).toBeNull();

    // The only way on is Upload & check for B, and /process gets B's key.
    await user.click(screen.getByRole('button', { name: /upload and check/i }));
    await waitFor(() =>
      expect(fetchImpl.mock.calls.filter((c) => /\/process$/.test(String(c[0])))).toHaveLength(1),
    );
    const call = fetchImpl.mock.calls.find((c) => /\/process$/.test(String(c[0])));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
      spacesKey: 'key-B',
      fileName: 'B.csv',
    });
  });
});
