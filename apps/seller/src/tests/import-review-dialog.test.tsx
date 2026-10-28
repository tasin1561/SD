import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactElement } from 'react';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { englishT } from '@/i18n/english';
import { ImportReviewDialog } from '@/app/(authed)/orders/_components/import-review-dialog';
import { readEnglish } from './english-source';

const PANEL = join(__dirname, '../app/(authed)/orders/_components/csv-import-panel.tsx');

const problems = [
  { rowNumber: 4, field: 'addressLine2', reason: 'Shipping Address Line2 is required' },
  { rowNumber: 9, field: 'quantity', reason: 'quantity must be a whole number' },
];

function Harness({
  onImport,
  rejected = 2,
  list = problems,
}: {
  onImport: () => void;
  rejected?: number;
  list?: typeof problems;
}): ReactElement {
  const [open, setOpen] = useState(true);
  const reopen = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={reopen} onClick={() => setOpen(true)}>
        inline-open
      </button>
      <ImportReviewDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) requestAnimationFrame(() => reopen.current?.focus());
        }}
        t={englishT}
        kind="orders"
        fileName="orders.xlsx"
        rowCount={14}
        willCreate={5}
        rejectedCount={rejected}
        problems={list}
        blocked={false}
        busy={false}
        importing={false}
        importLabel="Import 5 orders"
        onImport={onImport}
      />
    </>
  );
}

describe('the check result modal', () => {
  it('leads with the verdict, labelled as the dialog name', () => {
    render(<Harness onImport={vi.fn()} />);
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAccessibleName('5 orders will be created, 2 rows rejected.');
    expect(screen.getByText('orders.xlsx')).toBeTruthy();
  });

  it('lists only rejected rows, with their spreadsheet row numbers', () => {
    render(<Harness onImport={vi.fn()} />);
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('Row 4')).toBeTruthy();
    expect(within(dlg).getByText('Shipping Address Line2 is required')).toBeTruthy();
    expect(within(dlg).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows no rejection list for a clean file', () => {
    render(<Harness onImport={vi.fn()} rejected={0} list={[]} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      '5 orders will be created. No rows were rejected.',
    );
    expect(screen.queryByText('Rejected rows')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('fires the import action once', async () => {
    const onImport = vi.fn();
    render(<Harness onImport={onImport} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Import 5 orders' }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('Escape closes it and focus returns to the inline trigger', async () => {
    render(<Harness onImport={vi.fn()} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.activeElement).toBe(screen.getByText('inline-open'));
  });
});

describe('the panel wiring', () => {
  const src = readEnglish(PANEL);
  it('opens the modal when the preview returns', () => {
    expect(src).toMatch(
      /setPending\(\{ spacesKey: presign\.spacesKey[^}]*\}\);\s*setReviewOpen\(true\)/,
    );
  });
  it('keeps the inline section and its discard action', () => {
    expect(src).toContain('Check before importing');
    expect(src).toContain('setPending(null)');
  });
  it('still imports through the same /process call', () => {
    expect(src.match(/`\$\{endpointBase\}\/process`/g)).toHaveLength(1);
    expect(src).toContain('onImport={() => void confirmImport()}');
  });
});
