'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CheckCircle2, CircleAlert, MinusCircle, X } from 'lucide-react';
import { Button } from '../button';
import { Checkbox } from '../checkbox';
import type { RowSelection } from '../data-table';
import { ConfirmDialog, Dialog } from '../dialog';
import { useUiT } from '../i18n-client';
import { Select } from '../select';
import { TextArea } from '../text-field';
import './bulk-actions.css';

/**
 * Bulk actions on a list: tick rows, pick an action, read one result per row.
 *
 * The list owns its rows and its `RowSelection` (the data-table's own hook and
 * select cells); this owns everything after the tick — the sticky bar, the
 * confirm step, the request, the results sheet and the re-read.
 *
 * Three rules it keeps:
 *  - The server is the authority. Nothing here decides which order an action
 *    suits; every order is sent and comes back DONE / SKIPPED / FAILED with the
 *    server's own words, shown as sent.
 *  - One click, one key. An action that takes an idempotency key gets a fresh
 *    one per confirmed click, so a double tap or a retry never runs twice.
 *  - "All N matching" is for downloads only. It sends the list's own filter
 *    instead of ids; every other action hides while it is on.
 */

export type BulkOutcome = 'DONE' | 'SKIPPED' | 'FAILED';

export interface BulkResultRow {
  readonly orderId?: string;
  readonly rowId?: string;
  readonly orderNumber?: string | null;
  readonly outcome: BulkOutcome;
  readonly code?: string;
  readonly message?: string;
}

export interface BulkResponse {
  readonly results: readonly BulkResultRow[];
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly replayed?: boolean;
}

/** How the bar talks to the API: the app's own client, so auth and the proxy stay the app's. */
export interface BulkTransport {
  readonly post: (path: string, body: unknown) => Promise<BulkResponse>;
  /** A file answer (CSV / PDF): the raw response, headers intact. */
  readonly download: (path: string, body: unknown) => Promise<Response>;
}

export type BulkField =
  | {
      readonly kind: 'select';
      readonly name: string;
      readonly label: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly label: string;
      readonly hint?: string;
      /** The confirm button waits for this many characters (0 = optional). */
      readonly minLength?: number;
      readonly maxLength?: number;
    };

export interface BulkActionDef {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  /** `post` answers one result per row; `download` answers a file. */
  readonly kind: 'post' | 'download';
  readonly path: string;
  /** The body key the ids go under. Default `orderIds`. */
  readonly idsKey?: string;
  /** Send a fresh `idempotencyKey` with the click. Only where the endpoint takes one. */
  readonly withKey?: boolean;
  /** A download that also works on "all N matching" (the list's filter, not ids). */
  readonly allMatching?: boolean;
  /** Used when the server names no file. */
  readonly fileName?: string;
  /** Ask first. `{n}` in the title is the number of rows. */
  readonly confirm?: {
    readonly title: string;
    readonly consequence: string;
    readonly confirmLabel: string;
    /** The way out, when "Cancel" would be ambiguous (cancelling a cancel). */
    readonly dismissLabel?: string;
    readonly fields?: readonly BulkField[];
  };
}

export interface BulkActionsProps {
  readonly selection: RowSelection;
  readonly actions: readonly BulkActionDef[];
  readonly transport: BulkTransport;
  /** What to call a row in the results: its order number. Falls back to the id. */
  readonly labelFor: (id: string) => string | undefined;
  /** The server's own words for a refused request, e.g. the app's `verdict(e, t)`. */
  readonly explain: (error: unknown) => string;
  /** Re-read the list. Called as soon as an action has answered. */
  readonly onDone: () => void;
  /** Offer "Select all N matching" once the whole page is ticked. */
  readonly matching?: { readonly total: number; readonly filter: unknown } | undefined;
  /** At most this many rows per action; stated beside the count, the server enforces it. */
  readonly max?: number;
  /** An (i) beside the count — the app's own info button. */
  readonly info?: ReactNode;
}

function freshKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function fileNameFrom(disposition: string | null): string | undefined {
  if (disposition === null) return undefined;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (m?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BulkActions({
  selection,
  actions,
  transport,
  labelFor,
  explain,
  onDone,
  matching,
  max = 200,
  info,
}: BulkActionsProps): ReactElement | null {
  const t = useUiT();
  const [allMatching, setAllMatching] = useState(false);
  const [asking, setAsking] = useState<BulkActionDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    title: string;
    data: BulkResponse;
    names: ReadonlyMap<string, string>;
  } | null>(null);
  // One key per confirm step: a retry after a network failure repeats the SAME
  // click, so the server answers with the first result rather than running again.
  const keyRef = useRef<string>('');

  const ids = useMemo(() => Array.from(selection.selected), [selection.selected]);
  const count = selection.count;

  // "All matching" only means something while the whole page is ticked.
  useEffect(() => {
    if (selection.allState !== true && allMatching) setAllMatching(false);
  }, [selection.allState, allMatching]);
  useEffect(() => {
    if (count === 0) setStatus(null);
  }, [count]);

  const run = useCallback(
    async (def: BulkActionDef, fields: Record<string, string>): Promise<void> => {
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) if (v.trim() !== '') extra[k] = v.trim();
      setBusy(def.id);
      setStatus(null);
      try {
        if (def.kind === 'download') {
          const body =
            allMatching && def.allMatching === true && matching !== undefined
              ? { filter: matching.filter }
              : { [def.idsKey ?? 'orderIds']: ids };
          const res = await transport.download(def.path, body);
          const blob = await res.blob();
          saveBlob(
            blob,
            fileNameFrom(res.headers.get('content-disposition')) ?? def.fileName ?? 'download',
          );
          const included = res.headers.get('x-bulk-exported') ?? res.headers.get('x-bulk-included');
          const skipped = Number(res.headers.get('x-bulk-skipped') ?? '0');
          setStatus({
            tone: 'ok',
            text:
              included === null
                ? t('ui.bulk.downloadReady')
                : skipped > 0
                  ? t('ui.bulk.downloadedSkipped', { n: included, skipped })
                  : t('ui.bulk.downloaded', { n: included }),
          });
          return;
        }
        const names = new Map<string, string>();
        for (const id of ids) {
          const name = labelFor(id);
          if (name !== undefined) names.set(id, name);
        }
        const data = await transport.post(def.path, {
          [def.idsKey ?? 'orderIds']: ids,
          ...(def.withKey === true ? { idempotencyKey: keyRef.current || freshKey() } : {}),
          ...extra,
        });
        setResults({ title: def.label, data, names });
        selection.clear();
        onDone();
      } finally {
        setBusy(null);
      }
    },
    [allMatching, ids, labelFor, matching, onDone, selection, t, transport],
  );

  function start(def: BulkActionDef): void {
    keyRef.current = freshKey();
    if (def.confirm === undefined) {
      void run(def, {}).catch((e: unknown) => setStatus({ tone: 'bad', text: explain(e) }));
      return;
    }
    const initial: Record<string, string> = {};
    for (const f of def.confirm.fields ?? []) {
      initial[f.name] = f.kind === 'select' ? (f.options[0]?.value ?? '') : '';
    }
    setValues(initial);
    setDialogError(null);
    setAsking(def);
  }

  const shown = actions.filter((a) => !allMatching || a.allMatching === true);
  const fields = asking?.confirm?.fields ?? [];
  const waiting = fields.some(
    (f) => f.kind === 'text' && (values[f.name] ?? '').trim().length < (f.minLength ?? 0),
  );
  const canOfferAll =
    matching !== undefined &&
    selection.allState === true &&
    matching.total > count &&
    actions.some((a) => a.allMatching === true);

  return (
    <>
      {count > 0 && (
        <div className="sk-bulk" data-bottom-bar="" role="region" aria-label={t('ui.bulk.region')}>
          <div className="sk-bulk__card">
            <div className="sk-bulk__lead">
              <strong className="sk-bulk__count sk-figure">
                {allMatching && matching !== undefined
                  ? t('ui.bulk.allMatching', { n: matching.total })
                  : t('ui.table.selected', { n: count })}
              </strong>
              {info}
              {allMatching && <span className="sk-bulk__tag">{t('ui.bulk.exportOnly')}</span>}
              {canOfferAll && !allMatching && matching !== undefined && (
                <button
                  type="button"
                  className="sk-bulk__link"
                  onClick={() => setAllMatching(true)}
                >
                  {t('ui.bulk.selectAllMatching', { n: matching.total })}
                  <span className="sk-bulk__faint"> · {t('ui.bulk.exportOnly')}</span>
                </button>
              )}
              <button
                type="button"
                className="sk-bulk__link sk-bulk__clear"
                onClick={() => {
                  setAllMatching(false);
                  selection.clear();
                }}
              >
                <X size={14} aria-hidden />
                {t('ui.bulk.clear')}
              </button>
            </div>
            <div className="sk-bulk__actions">
              {shown.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  variant="secondary"
                  className={a.danger === true ? 'sk-bulk__danger' : undefined}
                  icon={a.icon}
                  disabled={busy !== null}
                  aria-busy={busy === a.id}
                  onClick={() => start(a)}
                >
                  {busy === a.id ? t('ui.working') : a.label}
                </Button>
              ))}
            </div>
            {(status !== null || (count > max && !allMatching)) && (
              <p className="sk-bulk__status" data-tone={status?.tone} aria-live="polite">
                {status !== null ? status.text : t('ui.bulk.limit', { max })}
              </p>
            )}
          </div>
        </div>
      )}

      {asking?.confirm !== undefined && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={asking.confirm.title.replace('{n}', String(count))}
          entity={t('ui.table.selected', { n: count })}
          consequence={asking.confirm.consequence}
          confirmLabel={asking.confirm.confirmLabel}
          cancelLabel={asking.confirm.dismissLabel}
          destructive={asking.danger === true}
          focusSafe={asking.danger === true}
          confirmDisabled={waiting}
          error={dialogError}
          onConfirm={async () => {
            setDialogError(null);
            try {
              await run(asking, values);
              setAsking(null);
            } catch (e) {
              setDialogError(explain(e));
              throw e;
            }
          }}
        >
          {fields.length > 0 && (
            <div className="sk-bulk__fields">
              {fields.map((f) =>
                f.kind === 'select' ? (
                  <Select
                    key={f.name}
                    label={f.label}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextArea
                    key={f.name}
                    label={f.label}
                    hint={f.hint}
                    rows={3}
                    maxLength={f.maxLength}
                    requiredMark={(f.minLength ?? 0) > 0}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                ),
              )}
            </div>
          )}
        </ConfirmDialog>
      )}

      {results !== null && (
        <BulkResults
          title={results.title}
          data={results.data}
          nameOf={(id) => results.names.get(id)}
          onClose={() => setResults(null)}
        />
      )}
    </>
  );
}

const ORDER: Record<BulkOutcome, number> = { FAILED: 0, SKIPPED: 1, DONE: 2 };

/**
 * The results sheet: totals, then one line per row — what went wrong first.
 * The server's message is shown exactly as sent, with its code beside it.
 */
export function BulkResults({
  title,
  data,
  nameOf,
  onClose,
}: {
  readonly title: string;
  readonly data: BulkResponse;
  readonly nameOf: (id: string) => string | undefined;
  readonly onClose: () => void;
}): ReactElement {
  const t = useUiT();
  const rows = useMemo(
    () => [...data.results].sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome]),
    [data.results],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={title}
      description={t('ui.bulk.results.summary', {
        done: data.done,
        skipped: data.skipped,
        failed: data.failed,
      })}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      <div className="sk-bulk-res">
        <div className="sk-bulk-res__totals" aria-hidden>
          <span data-outcome="DONE">
            <CheckCircle2 size={14} /> {t('ui.bulk.outcome.done')} <b>{data.done}</b>
          </span>
          <span data-outcome="SKIPPED">
            <MinusCircle size={14} /> {t('ui.bulk.outcome.skipped')} <b>{data.skipped}</b>
          </span>
          <span data-outcome="FAILED">
            <CircleAlert size={14} /> {t('ui.bulk.outcome.failed')} <b>{data.failed}</b>
          </span>
        </div>
        {data.replayed === true && (
          <p className="sk-bulk-res__note">{t('ui.bulk.results.replayed')}</p>
        )}
        <ul className="sk-bulk-res__list" aria-label={t('ui.bulk.results.list')}>
          {rows.map((r, i) => {
            const id = r.orderId ?? r.rowId ?? String(i);
            const name = r.orderNumber ?? nameOf(id) ?? id.slice(0, 8);
            return (
              <li key={id} className="sk-bulk-res__row" data-outcome={r.outcome}>
                <span className="sk-bulk-res__name sk-ident">{name}</span>
                <span className="sk-bulk-res__chip" data-outcome={r.outcome}>
                  {r.outcome === 'DONE'
                    ? t('ui.bulk.outcome.done')
                    : r.outcome === 'SKIPPED'
                      ? t('ui.bulk.outcome.skipped')
                      : t('ui.bulk.outcome.failed')}
                </span>
                {(r.message !== undefined || r.code !== undefined) && (
                  <span className="sk-bulk-res__why">
                    {r.message}
                    {r.code !== undefined && <span className="sk-bulk-res__code"> {r.code}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

/**
 * "Select all on this page" above the list. The table's header checkbox does
 * this on a wide screen; on a phone the header row is gone (rows are cards),
 * so this strip is the only place it can live — it shows below 768px only.
 */
export function BulkSelectStrip({
  selection,
  className,
}: {
  readonly selection: RowSelection;
  readonly className?: string;
}): ReactElement {
  const t = useUiT();
  return (
    <div className={className === undefined ? 'sk-bulk-strip' : `sk-bulk-strip ${className}`}>
      <Checkbox
        checked={selection.allState === true}
        indeterminate={selection.allState === 'indeterminate'}
        onChange={(e) => selection.toggleAll(e.currentTarget.checked)}
        label={t('ui.bulk.selectPage')}
      />
    </div>
  );
}

export { orderBulkActions, deliveryDecisionBulkActions, type BulkConsole } from './order-actions';
