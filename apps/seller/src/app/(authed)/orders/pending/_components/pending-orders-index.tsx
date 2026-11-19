'use client';

import Link from 'next/link';
import { useApiClient, useSellerIdentity } from '@skydrop/auth/client';
import { canSeePath } from '@/lib/page-access';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  FileWarning,
  Inbox,
  ListChecks,
  PencilLine,
  Trash2,
  Upload,
} from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { TextField } from '@skydrop/ui/app/text-field';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { useRowSelection } from '@skydrop/ui/app/data-table';
import {
  BulkActions,
  type BulkActionDef,
  type BulkResponse,
  type BulkTransport,
} from '@skydrop/ui/app/bulk-actions';
import { useUiT } from '@skydrop/ui/app/i18n-client';
import type { PendingBulkResponse, PendingSetField } from '@skydrop/api-client';
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
import { AboutThis, InfoLabel } from '@/components/easy/about';
import { Unit } from '@/components/easy/units';
import { InfoButton } from '@/components/easy/info-button';
import { useBulkFixSummary, usePendingCompact } from '@/lib/pending-bulk-hooks';
import { BulkFixPanel } from './bulk-fix-panel';
import './pending.css';
import { PendingTable } from './pending-table';
import {
  fromBulkFix,
  fromSelection,
  LastActionStrip,
  type LastAction,
  type RowOutcome,
} from './pending-results';

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
 *
 * ── LIST-FIRST (2026-11-19) ───────────────────────────────────────────
 * The page used to be every row's full editor, one under another: fine
 * for three rows, a wall for sixty. It now opens on a compact LIST (one
 * line per row), and a row's editor — the same one, nothing taken out —
 * opens under its line. Above the list, "Fix in bulk" groups the same
 * problem with the same bad value so one answer fixes them all; ticked
 * rows can have a field set, be imported or be discarded together.
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
function RowCard({
  row,
  nav,
}: {
  readonly row: StagedRow;
  /** Previous / Next between the rows that still need fixing. */
  readonly nav?: ReactNode;
}): ReactElement {
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
  // Problems no box on this card can carry: a failure from placing the
  // order (unknown SKU, an undeliverable PIN — stored with no field) or
  // one about a column the form does not show (payment mode). Without
  // this the card said "1 value to fix" and marked nothing.
  const unplaced = row.problems.filter((p) => !FIELDS.some((f) => f.key === p.field));
  const [allFields, setAllFields] = useState(false);
  const settled = (key: string): boolean =>
    String(row.data[key] ?? '') !== '' && problemFor(key) === undefined;
  const settledCount = FIELDS.filter((f) => settled(f.key)).length;
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
      action={nav}
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

        {unplaced.length > 0 && (
          <Notice tone="bad" icon={<FileWarning size={16} />}>
            {unplaced.length === 1 ? (
              <span>{unplaced[0]?.reason}</span>
            ) : (
              <ul className="ord-mini-list">
                {unplaced.map((p, i) => (
                  <li key={`${p.field}-${i}`}>{p.reason}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}

        {error !== null && (
          <Notice tone="bad" role="alert" icon={<FileWarning size={16} />}>
            <span>{error}</span>
          </Notice>
        )}

        {/* On a phone the row opens on the values that need a person: the
            ones flagged, and the ones the file left empty. The values that
            arrived fine are one press away. "Fine" is judged from the row
            as it was uploaded, never from what is being typed, so a field
            does not vanish under the finger. */}
        <div className="ord-grid-3 pend-fields" data-all={allFields ? 'true' : 'false'}>
          {FIELDS.map((f) => {
            const problem = problemFor(f.key);
            return (
              <div
                key={f.key}
                className="pend-field"
                {...(settled(f.key) ? { 'data-ok': '' } : {})}
                {...(problem !== undefined ? { 'data-bad': '' } : {})}
              >
                <TextField
                  label={t(f.labelKey)}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  {...(problem !== undefined ? { error: problem } : {})}
                  {...(f.hint !== undefined ? { hint: f.hint } : {})}
                />
              </div>
            );
          })}
        </div>
        {settledCount > 0 && (
          <button
            type="button"
            className="ez-fold__more pend-more"
            aria-expanded={allFields}
            onClick={() => setAllFields((v) => !v)}
          >
            {allFields ? t('easy.showFewer') : t('easy.showAll', { n: FIELDS.length })}
          </button>
        )}

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

/** The fields "Set field…" can write, with the label each already has on a row. */
const SET_FIELDS: ReadonlyArray<{ value: PendingSetField; labelKey: MessageKey }> = [
  { value: 'productSku', labelKey: 'orderPending.fieldSku' },
  { value: 'quantity', labelKey: 'orderPending.fieldQty' },
  { value: 'customerPhone', labelKey: 'orderPending.fieldPhone' },
  { value: 'pinCode', labelKey: 'orderPending.fieldPin' },
  { value: 'city', labelKey: 'orderPending.fieldCity' },
  { value: 'state', labelKey: 'orderPending.fieldState' },
  { value: 'landmark', labelKey: 'orderPending.fieldLandmark' },
  { value: 'addressLine2', labelKey: 'orderPending.fieldAddressLine2' },
  { value: 'codAmount', labelKey: 'orderPending.fieldCodAmount' },
];

const BULK_ROOT = '/api/seller/orders-pending/bulk';

export function PendingOrdersIndex(): ReactElement {
  const t = useT();
  const uiT = useUiT();
  const identity = useSellerIdentity();
  const client = useApiClient();
  const qc = useQueryClient();
  // The full rows feed the tiles and the editor; the compact lines feed the list.
  const rows = usePendingRows();
  const compact = usePendingCompact();
  const fixes = useBulkFixSummary();

  const list = rows.data ?? [];
  const duplicates = list.filter((r) => r.status === 'DUPLICATE_SUSPECTED').length;
  const broken = list.length - duplicates;

  const lines = useMemo(() => compact.data ?? [], [compact.data]);
  const lineIds = useMemo(() => lines.map((r) => r.id), [lines]);
  const selection = useRowSelection(lineIds);
  const groups = fixes.data?.groups ?? [];

  // ── One row open at a time ──────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = useRef(0);
  // The rows Previous / Next walk: the ones that still need a person. When
  // every row is ready, they walk the whole list.
  const toFix = useMemo(() => {
    const flagged = lines.filter((r) => r.problemCount > 0 || r.status === 'DUPLICATE_SUSPECTED');
    return (flagged.length > 0 ? flagged : lines).map((r) => r.id);
  }, [lines]);
  useEffect(() => {
    if (openId === null) return;
    const at = lineIds.indexOf(openId);
    if (at >= 0) {
      openIndex.current = at;
      return;
    }
    // The open row was imported or discarded: open the one that took its
    // place, so working down the list is one press per row.
    setOpenId(lineIds[Math.min(openIndex.current, lineIds.length - 1)] ?? null);
  }, [openId, lineIds]);
  function open(rowId: string | null): void {
    setOpenId(rowId);
    if (rowId === null) return;
    if (typeof window.requestAnimationFrame !== 'function') return;
    window.requestAnimationFrame(() => {
      const calm =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const line = document.getElementById(`pend-row-${rowId}`);
      if (line !== null && typeof line.scrollIntoView === 'function') {
        line.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
      }
    });
  }
  const at = openId === null ? -1 : toFix.indexOf(openId);
  const step = (by: 1 | -1): string | undefined => {
    if (at >= 0) return toFix[at + by];
    // The open row is not one of the flagged ones: go to the nearest flagged row.
    const here = openId === null ? -1 : lineIds.indexOf(openId);
    const ahead = toFix.filter((id) => lineIds.indexOf(id) > here);
    const behind = toFix.filter((id) => lineIds.indexOf(id) < here);
    return by === 1 ? ahead[0] : behind[behind.length - 1];
  };
  const prevId = step(-1);
  const nextId = step(1);
  const nav = (
    <span className="pend-nav" role="group" aria-label={t('orderPending.rowsNav')}>
      {at >= 0 && (
        <span className="pend-nav__at sk-figure">
          {t('orderPending.positionOf', { i: at + 1, n: toFix.length })}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronLeft size={14} />}
        disabled={prevId === undefined}
        onClick={() => open(prevId ?? null)}
      >
        {t('orderPending.previous')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronRight size={14} />}
        disabled={nextId === undefined}
        onClick={() => open(nextId ?? null)}
      >
        {t('orderPending.next')}
      </Button>
    </span>
  );

  // ── The last bulk step, shown on the rows and above them ────────────
  const [last, setLast] = useState<LastAction | null>(null);
  const outcomes = useMemo(() => {
    const map = new Map<string, RowOutcome>();
    for (const r of last?.rows ?? []) map.set(r.rowId, r);
    return map;
  }, [last]);
  const numberOf = (rowId: string): number | null =>
    lines.find((r) => r.id === rowId)?.rowNumber ?? null;

  function selectOnly(rowIds: readonly string[]): void {
    selection.clear();
    for (const id of rowIds) if (lineIds.includes(id)) selection.toggle(id, true);
  }

  const bulkActions = useMemo<BulkActionDef[]>(
    () => [
      {
        id: 'set-field',
        label: t('orderPending.actSetField'),
        icon: <PencilLine size={14} />,
        kind: 'post',
        path: `${BULK_ROOT}/set-field`,
        idsKey: 'rowIds',
        withKey: true,
        confirm: {
          title: t('orderPending.setFieldTitle'),
          consequence: t('orderPending.setFieldConsequence'),
          confirmLabel: t('orderPending.setFieldConfirm'),
          fields: [
            {
              kind: 'select',
              name: 'field',
              label: t('orderPending.setFieldField'),
              options: SET_FIELDS.map((f) => ({ value: f.value, label: t(f.labelKey) })),
            },
            {
              kind: 'text',
              name: 'value',
              label: t('orderPending.setFieldValue'),
              minLength: 1,
              maxLength: 500,
            },
          ],
        },
      },
      {
        id: 'import',
        label: t('orderPending.actImport'),
        icon: <Upload size={14} />,
        kind: 'post',
        path: `${BULK_ROOT}/import`,
        idsKey: 'rowIds',
        withKey: true,
        confirm: {
          title: t('orderPending.importManyTitle'),
          consequence: t('orderPending.importManyConsequence'),
          confirmLabel: t('orderPending.importManyConfirm'),
        },
      },
      {
        id: 'discard',
        label: t('orderPending.actDiscard'),
        icon: <Trash2 size={14} />,
        danger: true,
        kind: 'post',
        path: `${BULK_ROOT}/discard`,
        idsKey: 'rowIds',
        withKey: true,
        confirm: {
          title: t('orderPending.discardManyTitle'),
          consequence: t('orderPending.discardManyConsequence'),
          confirmLabel: t('orderPending.discardManyConfirm'),
          dismissLabel: t('orderPending.discardManyKeep'),
        },
      },
    ],
    [t],
  );
  const bulkTransport = useMemo<BulkTransport>(
    () => ({
      post: (path, body) => client.request<BulkResponse>(path, { method: 'POST', body }),
      download: (path, body) => client.requestStream(path, { method: 'POST', body }),
    }),
    [client],
  );
  const reread = (): void => {
    void qc.invalidateQueries({ queryKey: ['seller-orders-pending'] });
    // Imported rows are orders now: the order list and its counts moved too.
    void qc.invalidateQueries({ queryKey: ['seller-orders'] });
  };

  const waiting = compact.data?.length ?? list.length;
  const loading = rows.isLoading || compact.isLoading;

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
        subtitle={<AboutThis text={t('orderPending.rowsFromACsv')} />}
        meta={
          loading ? undefined : waiting === 0 ? (
            <span className="ord-meta">
              <MetaFact>{t('orderPending.nothingWaiting')}</MetaFact>
            </span>
          ) : (
            <span className="ord-meta">
              <MetaFact tone="warn">{t('orderPending.waitingN', { n: waiting })}</MetaFact>
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
            label={
              <InfoLabel
                label={t('orderPending.waitingOnYou')}
                info={t('orderPending.noneOfTheseIs')}
              />
            }
            icon={<ListChecks size={14} />}
            value={list.length}
            unit={<Unit w={list.length === 1 ? 'row' : 'rows'} />}
            tone="pending"
          />
          <KpiCard
            label={
              <InfoLabel
                label={t('orderPending.valuesToFix')}
                info={t('orderPending.somethingIsMissingOr')}
              />
            }
            icon={<FileWarning size={14} />}
            value={broken}
            unit={<Unit w={broken === 1 ? 'row' : 'rows'} />}
            tone={broken > 0 ? 'debit' : 'neutral'}
          />
          <KpiCard
            label={
              <InfoLabel
                label={t('orderPending.lookLikeDuplicates2')}
                info={t('orderPending.thisCustomerAlreadyHas2')}
              />
            }
            icon={<CopyCheck size={14} />}
            value={duplicates}
            unit={<Unit w={duplicates === 1 ? 'row' : 'rows'} />}
            tone={duplicates > 0 ? 'pending' : 'neutral'}
          />
        </div>
      )}

      {last !== null && <LastActionStrip action={last} onDismiss={() => setLast(null)} />}

      {loading ? (
        <SkeletonRows rows={4} cols={3} label={t('orderPending.loadingPendingRows')} />
      ) : compact.isError ? (
        <ErrorState message={verdict(compact.error, t)} retry={() => void compact.refetch()} />
      ) : lines.length === 0 ? (
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
        <>
          {fixes.isError ? (
            <Notice tone="warn" icon={<FileWarning size={16} />}>
              <span>
                {t('orderPending.fixLoadFailed')} {verdict(fixes.error, t)}
              </span>
            </Notice>
          ) : (
            <BulkFixPanel
              groups={groups}
              onApplied={(res) => setLast(fromBulkFix(t('orderPending.fixResultName'), res, t))}
              onSelect={selectOnly}
            />
          )}

          <OrdSection
            flush
            title={
              <InfoLabel label={t('orderPending.listTitle')} info={t('orderPending.listInfo')} />
            }
            action={
              groups.length > 0 ? (
                <Select
                  className="pend-pick"
                  label={t('orderPending.selectProblem')}
                  value=""
                  onChange={(e) => {
                    const g = groups[Number(e.target.value)];
                    if (g !== undefined) selectOnly(g.rowIds);
                  }}
                >
                  <option value="">{t('orderPending.selectProblemNone')}</option>
                  {groups.map((g, i) => (
                    <option key={`${g.field}-${g.kind}-${g.badValue}`} value={i}>
                      {t('orderPending.selectProblemOption', { reason: g.reason, n: g.rowCount })}
                    </option>
                  ))}
                </Select>
              ) : undefined
            }
          >
            <PendingTable
              rows={lines}
              selection={selection}
              openId={openId}
              onToggle={(id) => open(openId === id ? null : id)}
              outcomes={outcomes}
              renderOpen={(id) => {
                const full = list.find((r) => r.id === id);
                return full === undefined ? (
                  <SkeletonRows rows={3} cols={3} label={t('orderPending.loadingPendingRows')} />
                ) : (
                  <RowCard key={`${full.id}:${JSON.stringify(full.data)}`} row={full} nav={nav} />
                );
              }}
            />
            <BulkActions
              selection={selection}
              actions={bulkActions}
              transport={bulkTransport}
              max={500}
              labelFor={(id) => {
                const n = numberOf(id);
                return n === null ? undefined : t('orderPending.resRow', { n });
              }}
              explain={(e) => verdict(e, t)}
              onDone={reread}
              onResults={(def, data) =>
                setLast(
                  fromSelection(def.label, data as unknown as PendingBulkResponse, numberOf, t),
                )
              }
              info={<InfoButton title={uiT('ui.bulk.region')} text={uiT('ui.bulk.info')} />}
            />
          </OrdSection>
        </>
      )}
    </div>
  );
}
