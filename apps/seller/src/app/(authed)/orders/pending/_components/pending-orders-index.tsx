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
import { verdict } from '@/i18n/verdict';
import { LinkButton, MetaFact, Notice, OrdSection } from '../../_components/orders-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { MessageKey } from '@/i18n/catalog';

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
const FIELDS: ReadonlyArray<{ key: string; labelKey: MessageKey; hint?: string }> = [
  { key: 'externalRef', labelKey: 'orderPending.fieldOrderRef' },
  { key: 'productSku', labelKey: 'orderPending.fieldSku' },
  { key: 'quantity', labelKey: 'orderPending.fieldQty' },
  { key: 'customerName', labelKey: 'orderPending.fieldCustomerName' },
  { key: 'customerPhone', labelKey: 'orderPending.fieldPhone', hint: '+91…' },
  { key: 'customerEmail', labelKey: 'orderPending.fieldEmail' },
  { key: 'addressLine1', labelKey: 'orderPending.fieldAddressLine1' },
  { key: 'addressLine2', labelKey: 'orderPending.fieldAddressLine2' },
  { key: 'landmark', labelKey: 'orderPending.fieldLandmark' },
  { key: 'city', labelKey: 'orderPending.fieldCity' },
  { key: 'state', labelKey: 'orderPending.fieldState' },
  { key: 'pinCode', labelKey: 'orderPending.fieldPin' },
  { key: 'codAmount', labelKey: 'orderPending.fieldCodAmount' },
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
  const t = useT();
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
      toast.success(t('orderPending.rowUpdated', { rowNumber: row.rowNumber }));
    } catch (err) {
      setError(verdict(err, t));
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
      toast.success(t('orderPending.rowIsNowAn', { rowNumber: row.rowNumber }));
      void res;
    } catch (err) {
      // Verbatim — "no variant with SKU X" is the useful part.
      setError(verdict(err, t));
    }
  }

  // The row as the seller knows it — the number in their spreadsheet and
  // their own reference — restated in both confirmations below.
  const rowName = draft['externalRef']
    ? t('orderPending.rowWithRef', { rowNumber: row.rowNumber, ref: draft['externalRef'] })
    : t('orderPending.rowNumber', { rowNumber: row.rowNumber });

  return (
    <OrdSection
      title={rowName}
      note={
        isDuplicate ? (
          <span className="ord-tone-warn">{t('orderPending.possibleDuplicate')}</span>
        ) : (
          <span className="ord-tone-bad">
            {richMessage(t('orderPending.valueToFix'), {
              problems: row.problems.length,
              plural: row.problems.length === 1 ? '' : 's',
            })}
          </span>
        )
      }
    >
      <div className="ord-stack ord-stack--tight">
        {isDuplicate && row.duplicateOf !== null && row.duplicateOf.length > 0 && (
          <Notice tone="warn" icon={<CopyCheck size={16} />}>
            <span>
              {richMessage(t('orderPending.thisCustomerAlreadyHas'), {
                duplicateOf: row.duplicateOf.length,
                plural: row.duplicateOf.length === 1 ? '' : 's',
              })}
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
                label={t(f.labelKey)}
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
              idle: isDuplicate ? t('orderPending.importAnyway') : t('orderPending.importAsOrder'),
              busy: t('orderPending.importing'),
            }}
            onClick={() => setConfirm('import')}
          />
          <AsyncButton
            variant="ghost"
            disabled={!dirty || patch.isPending}
            labels={{
              idle: t('orderPending.saveWithoutImporting'),
              busy: t('orderPending.saving'),
              done: t('orderPending.saved'),
            }}
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
            {t('orderPending.discard')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'import'}
        onOpenChange={(next) => setConfirm(next ? 'import' : null)}
        title={
          isDuplicate ? t('orderPending.importThisRowAnyway') : t('orderPending.importThisRowAs')
        }
        entity={rowName}
        consequence={
          isDuplicate
            ? t('orderPending.importDuplicateConsequence')
            : t('orderPending.importConsequence')
        }
        confirmLabel={
          isDuplicate ? t('orderPending.importAnyway') : t('orderPending.importAsOrder')
        }
        onConfirm={() => doImport()}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        onOpenChange={(next) => setConfirm(next ? 'discard' : null)}
        title={t('orderPending.discardThisRow')}
        entity={rowName}
        consequence={t('orderPending.itIsRemovedFrom')}
        confirmLabel={t('orderPending.discard')}
        destructive
        error={discardError}
        onConfirm={async () => {
          setDiscardError(null);
          try {
            await discard.mutateAsync(row.id);
          } catch (err) {
            setDiscardError(verdict(err, t));
            throw err;
          }
        }}
      />
    </OrdSection>
  );
}

export function PendingOrdersIndex(): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const rows = usePendingRows();

  const list = rows.data ?? [];
  const duplicates = list.filter((r) => r.status === 'DUPLICATE_SUSPECTED').length;
  const broken = list.length - duplicates;

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: t('orderPending.clientConsole') },
          { label: t('orderPending.fulfilment') },
          { label: t('orderPending.orders'), href: '/orders' },
          { label: t('orderPending.pending') },
        ]}
        Link={Link}
        title={t('orderPending.pendingOrders')}
        subtitle={t('orderPending.rowsFromACsv')}
        meta={
          rows.isLoading ? undefined : list.length === 0 ? (
            <span className="ord-meta">
              <MetaFact>{t('orderPending.nothingWaiting')}</MetaFact>
            </span>
          ) : (
            <span className="ord-meta">
              <MetaFact tone="warn">{list.length} waiting</MetaFact>
              {duplicates > 0 && (
                <MetaFact dot>
                  {richMessage(t('orderPending.lookLikeDuplicates'), { duplicates })}
                </MetaFact>
              )}
            </span>
          )
        }
        action={
          canSeePath(identity, '/orders/import') ? (
            <LinkButton href="/orders/import" variant="ghost" icon={<Upload size={15} />}>
              {t('orderPending.uploadACsv')}
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
            label={t('orderPending.waitingOnYou')}
            icon={<ListChecks size={14} />}
            value={list.length}
            unit={list.length === 1 ? 'row' : 'rows'}
            tone="pending"
            hint={t('orderPending.noneOfTheseIs')}
          />
          <KpiCard
            label={t('orderPending.valuesToFix')}
            icon={<FileWarning size={14} />}
            value={broken}
            unit={broken === 1 ? 'row' : 'rows'}
            tone={broken > 0 ? 'debit' : 'neutral'}
            hint={t('orderPending.somethingIsMissingOr')}
          />
          <KpiCard
            label={t('orderPending.lookLikeDuplicates2')}
            icon={<CopyCheck size={14} />}
            value={duplicates}
            unit={duplicates === 1 ? 'row' : 'rows'}
            tone={duplicates > 0 ? 'pending' : 'neutral'}
            hint={t('orderPending.thisCustomerAlreadyHas2')}
          />
        </div>
      )}

      {rows.isLoading ? (
        <SkeletonRows rows={4} cols={3} label={t('orderPending.loadingPendingRows')} />
      ) : list.length === 0 ? (
        <EmptyState
          tone="positive"
          icon={<Inbox size={20} />}
          title={t('orderPending.nothingWaiting')}
          description={t('orderPending.everyRowFromYour')}
          action={
            canSeePath(identity, '/orders/import') ? (
              <LinkButton href="/orders/import" variant="primary" icon={<Upload size={15} />}>
                {t('orderPending.uploadACsv')}
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
