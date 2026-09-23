'use client';

import Link from 'next/link';
import { useSellerIdentity } from '@skydrop/auth/client';
import { canSeePath } from '@/lib/page-access';
import { useState, type ReactElement } from 'react';
import { CopyCheck, FileWarning, Inbox, ListChecks, Upload } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { TextField } from '@skydrop/ui/app/text-field';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useDiscardPendingRow,
  useImportPendingRow,
  usePatchPendingRow,
  usePendingRows,
  type StagedRow,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { LinkButton, MetaFact, Notice, OrdSection } from '../../_components/orders-parts';

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

/**
 * One unimportable row, under its own band.
 *
 * The band's index is the ROW NUMBER from the spreadsheet, zero-padded
 * — the person fixing this has the file open beside them and that is
 * the only number they can match against it. A card carried the same
 * text in a heading; the band puts it where every other numbered
 * section on the console puts it.
 */
function RowCard({ row }: { readonly row: StagedRow }): ReactElement {
  const toast = useToast();
  const patch = usePatchPendingRow();
  const importRow = useImportPendingRow();
  const discard = useDiscardPendingRow();

  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(row.data[f.key] ?? '')])),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'import' | 'discard' | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);

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
      // Re-thrown so the button's rolling label ends on the failure it
      // really was; the verdict above is what the seller reads.
      throw err;
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

  // The row as the seller knows it — the number in their spreadsheet and
  // their own reference — restated in both confirmations below.
  const rowName = draft['externalRef']
    ? `Row ${row.rowNumber} · ${draft['externalRef']}`
    : `Row ${row.rowNumber}`;

  return (
    <OrdSection
      title={rowName}
      note={
        isDuplicate ? (
          <span className="ord-tone-warn">Possible duplicate</span>
        ) : (
          <span className="ord-tone-bad">
            {row.problems.length} value{row.problems.length === 1 ? '' : 's'} to fix
          </span>
        )
      }
    >
      <div className="ord-stack ord-stack--tight">
        {isDuplicate && row.duplicateOf !== null && row.duplicateOf.length > 0 && (
          <Notice tone="warn" icon={<CopyCheck size={16} />}>
            <span>
              This customer already has {row.duplicateOf.length} order
              {row.duplicateOf.length === 1 ? '' : 's'} not yet packed. Import only if this is a
              separate parcel.
            </span>
            <ul className="ord-mini-list">
              {row.duplicateOf.map((o) => (
                <li key={o.orderId}>
                  <Link href={`/orders/${o.orderId}`} target="_blank" className="ord-link sk-ident">
                    {o.orderNumber}
                  </Link>
                  <span className="ord-faint">{o.status.replaceAll('_', ' ').toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {error !== null && (
          <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
            <span>{error}</span>
          </Notice>
        )}

        <div className="ord-grid-3">
          {FIELDS.map((f) => {
            const problem = problemFor(f.key);
            return (
              <TextField
                key={f.key}
                label={f.label}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                {...(problem !== undefined ? { error: problem } : {})}
                {...(f.hint !== undefined ? { hint: f.hint } : {})}
              />
            );
          })}
        </div>

        <div className="ord-row">
          <AsyncButton
            variant="primary"
            state={importRow.isPending ? 'busy' : undefined}
            disabled={importRow.isPending || patch.isPending}
            labels={{
              idle: isDuplicate ? 'Import anyway' : 'Import as order',
              busy: 'Importing…',
            }}
            onClick={() => setConfirm('import')}
          />
          <AsyncButton
            variant="ghost"
            disabled={!dirty || patch.isPending}
            labels={{ idle: 'Save without importing', busy: 'Saving…', done: 'Saved' }}
            onAction={() => save()}
          />
          <Button
            variant="ghost"
            disabled={discard.isPending}
            onClick={() => {
              setDiscardError(null);
              setConfirm('discard');
            }}
          >
            Discard
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'import'}
        onOpenChange={(next) => setConfirm(next ? 'import' : null)}
        title={isDuplicate ? 'Import this row anyway?' : 'Import this row as an order?'}
        entity={rowName}
        consequence={
          isDuplicate
            ? 'It becomes a new order even though this customer already has one waiting. Any changes you typed are saved first.'
            : 'It becomes an order and leaves this list. Any changes you typed are saved first.'
        }
        confirmLabel={isDuplicate ? 'Import anyway' : 'Import as order'}
        onConfirm={() => doImport()}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        onOpenChange={(next) => setConfirm(next ? 'discard' : null)}
        title="Discard this row?"
        entity={rowName}
        consequence="It is removed from this list and no order is made from it."
        confirmLabel="Discard"
        destructive
        error={discardError}
        onConfirm={async () => {
          setDiscardError(null);
          try {
            await discard.mutateAsync(row.id);
          } catch (err) {
            setDiscardError(serverVerdict(err));
            throw err;
          }
        }}
      />
    </OrdSection>
  );
}

export function PendingOrdersIndex(): ReactElement {
  const identity = useSellerIdentity();
  const rows = usePendingRows();

  const list = rows.data ?? [];
  const duplicates = list.filter((r) => r.status === 'DUPLICATE_SUSPECTED').length;
  const broken = list.length - duplicates;

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Fulfilment' },
          { label: 'Orders', href: '/orders' },
          { label: 'Pending' },
        ]}
        Link={Link}
        title="Pending orders"
        subtitle="Rows from a CSV upload that need a decision before they can become orders. Everything else in your upload has already imported."
        meta={
          rows.isLoading ? undefined : list.length === 0 ? (
            <span className="ord-meta">
              <MetaFact>Nothing waiting</MetaFact>
            </span>
          ) : (
            <span className="ord-meta">
              <MetaFact tone="warn">{list.length} waiting</MetaFact>
              {duplicates > 0 && <MetaFact dot>{duplicates} look like duplicates</MetaFact>}
            </span>
          )
        }
        action={
          canSeePath(identity, '/orders/import') ? (
            <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
              Upload a CSV
            </LinkButton>
          ) : undefined
        }
      />

      {/* Three tiles, all counted from the list already on the page —
          nothing derived from anywhere else, and nothing predicted.
          The comps put an "auto-fix" rate here; nothing auto-fixes a
          row, so there is no rate to report. */}
      {!rows.isLoading && list.length > 0 && (
        <div className="ord-kpis">
          <KpiCard
            label="Waiting on you"
            icon={<ListChecks size={14} />}
            value={list.length}
            unit={list.length === 1 ? 'row' : 'rows'}
            tone="pending"
            hint="None of these is an order yet."
          />
          <KpiCard
            label="Values to fix"
            icon={<FileWarning size={14} />}
            value={broken}
            unit={broken === 1 ? 'row' : 'rows'}
            tone={broken > 0 ? 'debit' : 'neutral'}
            hint="Something is missing or unreadable."
          />
          <KpiCard
            label="Look like duplicates"
            icon={<CopyCheck size={14} />}
            value={duplicates}
            unit={duplicates === 1 ? 'row' : 'rows'}
            tone={duplicates > 0 ? 'pending' : 'neutral'}
            hint="This customer already has a parcel on the way."
          />
        </div>
      )}

      {rows.isLoading ? (
        <SkeletonRows rows={4} cols={3} label="Loading pending rows" />
      ) : list.length === 0 ? (
        <EmptyState
          tone="positive"
          icon={<Inbox size={20} />}
          title="Nothing waiting"
          description="Every row from your uploads became an order. New uploads only land here if something is missing or looks like a duplicate."
          action={
            canSeePath(identity, '/orders/import') ? (
              <LinkButton href="/orders/import" variant="primary" icon={<Upload size={15} />}>
                Upload a CSV
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <div className="ord-stack">
          {list.map((r) => (
            <RowCard key={r.id} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}
