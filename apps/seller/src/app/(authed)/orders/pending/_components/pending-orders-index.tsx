'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import {
  useDiscardPendingRow,
  useImportPendingRow,
  usePatchPendingRow,
  usePendingRows,
  type StagedRow,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The rows your upload could not turn into orders.
 *
 * This replaces a downloadable error report, which was a dead end: it
 * told you WHAT was wrong and gave you nowhere to fix it. The only way
 * back was to edit the spreadsheet and re-upload the whole file,
 * re-running every row that had already worked.
 *
 * Each row is fixed and imported on its own. Rows that imported cleanly
 * are already orders and never appear here.
 */

/** The fields a CSV row maps to, in the order a person reads an address. */
const FIELDS: ReadonlyArray<{ key: string; label: string; hint?: string }> = [
  { key: 'externalRef', label: 'Your order ref' },
  { key: 'productSku', label: 'SKU' },
  { key: 'quantity', label: 'Qty' },
  { key: 'customerName', label: 'Customer name' },
  { key: 'customerPhone', label: 'Phone', hint: '+91…' },
  { key: 'customerEmail', label: 'Email' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'landmark', label: 'Landmark' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pinCode', label: 'PIN' },
  { key: 'codAmount', label: 'COD amount' },
];

function RowCard({ row }: { readonly row: StagedRow }): ReactElement {
  const toast = useToast();
  const patch = usePatchPendingRow();
  const importRow = useImportPendingRow();
  const discard = useDiscardPendingRow();

  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(row.data[f.key] ?? '')])),
  );
  const [error, setError] = useState<string | null>(null);

  const problemFor = (key: string): string | undefined =>
    row.problems.find((p) => p.field === key)?.reason;
  const isDuplicate = row.status === 'DUPLICATE_SUSPECTED';
  const dirty = FIELDS.some((f) => draft[f.key] !== String(row.data[f.key] ?? ''));

  async function save(): Promise<void> {
    setError(null);
    try {
      await patch.mutateAsync({ rowId: row.id, data: draft });
      toast.success(`Row ${row.rowNumber} updated`);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function doImport(): Promise<void> {
    setError(null);
    try {
      // Save first if they edited without pressing save — losing typed
      // corrections to a second button press is its own small betrayal.
      if (dirty) await patch.mutateAsync({ rowId: row.id, data: draft });
      const res = await importRow.mutateAsync(row.id);
      toast.success(`Row ${row.rowNumber} is now an order`);
      void res;
    } catch (err) {
      // Verbatim — "no variant with SKU X" is the useful part.
      setError(serverVerdict(err));
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-text-bright text-sm font-medium">
            Row {row.rowNumber}
            {draft['externalRef'] ? ` — ${draft['externalRef']}` : ''}
          </span>
          {isDuplicate ? (
            <span className="text-[var(--status-pending-fg)] text-xs">Possible duplicate</span>
          ) : (
            <span className="text-critical text-xs">
              {row.problems.length} value{row.problems.length === 1 ? '' : 's'} to fix
            </span>
          )}
        </div>

        {isDuplicate && row.duplicateOf !== null && row.duplicateOf.length > 0 && (
          <div className="border-border rounded-[5px] border px-3 py-2">
            <div className="text-text-muted mb-1 text-xs">
              This customer already has {row.duplicateOf.length} order
              {row.duplicateOf.length === 1 ? '' : 's'} not yet packed. Import only if this is a
              separate parcel.
            </div>
            <ul className="space-y-0.5">
              {row.duplicateOf.map((o) => (
                <li key={o.orderId} className="text-xs">
                  <Link
                    href={`/orders/${o.orderId}`}
                    target="_blank"
                    className="font-mono hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                  <span className="text-text-faint">
                    {' '}
                    · {o.status.replaceAll('_', ' ').toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error !== null && <ErrorNote message={error} />}

        <div className="grid gap-3 sm:grid-cols-3">
          {FIELDS.map((f) => {
            const problem = problemFor(f.key);
            return (
              <FormField
                key={f.key}
                label={f.label}
                {...(problem !== undefined ? { error: problem } : {})}
                {...(f.hint !== undefined ? { hint: f.hint } : {})}
              >
                <Input
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </FormField>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="md"
            disabled={importRow.isPending || patch.isPending}
            onClick={() => void doImport()}
          >
            {importRow.isPending ? 'Importing…' : isDuplicate ? 'Import anyway' : 'Import as order'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={!dirty || patch.isPending}
            onClick={() => void save()}
          >
            Save without importing
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={discard.isPending}
            onClick={() => void discard.mutateAsync(row.id)}
          >
            Discard
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function PendingOrdersIndex(): ReactElement {
  const rows = usePendingRows();

  if (rows.isLoading) return <LoadingState label="Loading pending rows" />;

  const list = rows.data ?? [];

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Pending orders"
        subtitle="Rows from a CSV upload that need a decision before they can become orders. Everything else in your upload has already imported."
      />
      {list.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Every row from your uploads became an order. New uploads only land here if something is missing or looks like a duplicate."
          action={
            <Link href="/orders/import">
              <Button variant="primary" size="md">
                Upload a CSV
              </Button>
            </Link>
          }
        />
      ) : (
        list.map((r) => <RowCard key={r.id} row={r} />)
      )}
    </div>
  );
}
