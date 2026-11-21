'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Download, ListChecks, Printer, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import {
  ApiError,
  type LabelGroup,
  type LabelGroupList,
  type PrintLabelGroupsRequest,
  type PrintLabelGroupsResult,
} from '@skydrop/api-client';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { InfoButton } from '@/components/easy/info-button';
import { pageDateTag } from '@/components/easy/when';
import { useConfirmLabelsPrinted } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { downloadPdf, printPdf } from '@/lib/print-pdf';
import { useT } from '@/i18n/client';
import './label-groups.css';

/**
 * LABEL GROUPS — the Shipping labels tab, groups first.
 *
 * The server sorts the parcels waiting for a label into groups (one
 * courier, oldest order first, a fixed size). The person at the printer
 * ticks whole groups and prints them as ONE stack; the server makes the
 * picking batch for that stack in the same step and stamps its number on
 * every label ("PB-2026-11-000042 · 7/67"), so paper and batch can never
 * drift apart.
 *
 * What this screen decides: nothing. It sends the union of the ticked
 * groups' parcels and shows what came back — the file, the batch, the
 * parcels that could not be printed (by name), or the server's refusal in
 * its own words.
 *
 * One click, one key: a fresh idempotency key per press, and the button is
 * off while the press is running, so a double tap cannot make two batches.
 * A replay (same key answered twice) carries no file and says so.
 */
const ROOT = '/api/admin/warehouse/printing';
const GROUPS_KEY = ['admin', 'label-groups'] as const;
/** The server's cap on one print. Stated here, enforced there. */
const MAX_PARCELS = 1000;

export function useLabelGroups(): UseQueryResult<LabelGroupList, Error> {
  const client = useApiClient();
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => client.request<LabelGroupList>(`${ROOT}/label-groups`),
  });
}

export function usePrintLabelGroups(): UseMutationResult<
  PrintLabelGroupsResult,
  Error,
  PrintLabelGroupsRequest
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PrintLabelGroupsResult>(`${ROOT}/label-groups/print`, {
        method: 'POST',
        body,
      }),
    // Settled, not only succeeded: a refusal usually means the pool moved,
    // and the groups on screen are then the stale thing.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: GROUPS_KEY });
      void qc.invalidateQueries({ queryKey: ['admin', 'label-queue'] });
      // The new batch shows up on Past batches as a draft.
      void qc.invalidateQueries({ queryKey: ['admin', 'pick-batches'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'pick-print-queue'] });
    },
  });
}

function freshKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function errorCode(e: unknown): string | undefined {
  if (!(e instanceof ApiError)) return undefined;
  const body = e.body as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : e.code;
}

/** "2 days ago" in the page's language, 0-9 digits. Never in the future. */
export function oldestAgo(iso: string, now: number, tag: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const minutes = Math.min(0, Math.round((then - now) / 60_000));
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

interface Printed {
  readonly result: PrintLabelGroupsResult;
  /** Exactly what was sent — what "they printed" will confirm. */
  readonly shipmentIds: readonly string[];
}

export function LabelGroupsPanel({
  onOpenBatch,
  onOpenReprint,
  now = Date.now(),
}: {
  /** Go to where this batch's picking list is printed. */
  readonly onOpenBatch: (batchNumber: string) => void;
  readonly onOpenReprint: () => void;
  /** Injected by tests so "2 days ago" is a fixed string. */
  readonly now?: number;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const groups = useLabelGroups();
  const print = usePrintLabelGroups();
  const confirm = useConfirmLabelsPrinted();

  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ text: string; hint?: string } | null>(null);
  const [printed, setPrinted] = useState<Printed | null>(null);
  const [asking, setAsking] = useState(false);

  const list = useMemo(() => groups.data?.groups ?? [], [groups.data]);
  // A group that left the pool (printed elsewhere) drops out of the ticks.
  useEffect(() => {
    setTicked((prev) => {
      const keys = new Set(list.map((g) => g.key));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [list]);

  const chosen = useMemo(() => list.filter((g) => ticked.has(g.key)), [list, ticked]);
  const shipmentIds = useMemo(() => [...new Set(chosen.flatMap((g) => g.shipmentIds))], [chosen]);
  const count = shipmentIds.length;
  const all = list.length > 0 && chosen.length === list.length;

  function toggle(key: string): void {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onPrint(): Promise<void> {
    if (count === 0 || print.isPending) return;
    setError(null);
    const sent = shipmentIds;
    try {
      const result = await print.mutateAsync({ shipmentIds: sent, idempotencyKey: freshKey() });
      setPrinted({ result, shipmentIds: sent });
      setTicked(new Set());
      if (result.pdfBase64 !== null) {
        downloadPdf(result.pdfBase64, result.fileName ?? `${result.batchNumber}.pdf`);
        setAsking(true);
      }
    } catch (e) {
      const code = errorCode(e);
      if (code === 'NOT_IN_LABEL_POOL') {
        // The groups on screen are out of date: they are being re-read, and
        // the old ticks would point at parcels that have moved on.
        setTicked(new Set());
        setError({
          text: serverVerdict(e),
          hint: t('warehousePrintingPrintingStation.groupsRefreshed'),
        });
      } else if (code === 'LABEL_GROUPS_IN_PROGRESS') {
        setError({
          text: serverVerdict(e),
          hint: t('warehousePrintingPrintingStation.groupsWait'),
        });
      } else {
        setError({ text: serverVerdict(e) });
      }
    }
  }

  async function onConfirm(): Promise<void> {
    if (printed === null) return;
    try {
      const r = await confirm.mutateAsync([...printed.shipmentIds]);
      toast.success(
        t('warehousePrintingPrintingStation.labelConfirmedThoseParcelsAre', {
          confirmed: r.confirmed,
          value: r.confirmed === 1 ? '' : t('common.pluralS'),
        }),
      );
      setAsking(false);
    } catch (e) {
      setError({ text: serverVerdict(e) });
      setAsking(false);
    }
  }

  const result = printed?.result ?? null;

  return (
    <section className="wh-card wh-stack lg-panel" aria-labelledby="lg-title">
      <div className="lg-head">
        <h2 id="lg-title" className="lg-title">
          {t('warehousePrintingPrintingStation.groupsTitle')}
          <InfoButton
            title={t('warehousePrintingPrintingStation.groupsTitle')}
            text={t('warehousePrintingPrintingStation.groupsInfo', {
              size: groups.data?.groupSize ?? 0,
            })}
          />
        </h2>
        <span className="wh-note sk-figure">
          {count > 0
            ? t('warehousePrintingPrintingStation.groupsChosen', {
                groups: chosen.length,
                parcels: count,
              })
            : t('warehousePrintingPrintingStation.groupsSummary', {
                groups: list.length,
                parcels: groups.data?.totalParcels ?? 0,
              })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={() => void groups.refetch()}
          disabled={groups.isFetching}
        >
          {t('warehousePrintingPrintingStation.groupsRefresh')}
        </Button>
      </div>

      {error !== null && (
        <div role="alert" className="wh-alert">
          {error.text}
          {error.hint !== undefined && <span className="lg-hint"> {error.hint}</span>}
        </div>
      )}

      {result !== null && (
        <div
          className="wh-callout lg-result"
          data-tone={result.replayed ? 'info' : 'good'}
          role="status"
        >
          <div className="lg-result__head">
            <div className="wh-callout__title sk-figure">
              {result.replayed
                ? t('warehousePrintingPrintingStation.groupsAlreadyPrinted', {
                    batchNumber: result.batchNumber,
                  })
                : t('warehousePrintingPrintingStation.groupsBatchCreated', {
                    batchNumber: result.batchNumber,
                  })}
            </div>
            <button
              type="button"
              className="lg-result__x"
              aria-label={t('warehousePrintingPrintingStation.groupsHideResult')}
              onClick={() => setPrinted(null)}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <p className="lg-result__body sk-figure">
            {result.replayed
              ? t('warehousePrintingPrintingStation.groupsAlreadyPrintedBody')
              : t('warehousePrintingPrintingStation.groupsBatchCreatedBody', {
                  n: result.shipmentCount,
                  pages: result.pageCount,
                })}
          </p>
          {/* Named, never dropped: a short stack looks identical to a
              complete one once it is on the bench. */}
          {result.failed.length > 0 && (
            <div className="lg-failed">
              <div className="lg-failed__title">
                {t('warehousePrintingPrintingStation.couldNotBePrintedAnd', {
                  failedLength: result.failed.length,
                })}
              </div>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.shipmentId}>
                    <span className="sk-ident">{f.shipmentNumber}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="lg-result__links">
            <Button
              variant="secondary"
              size="sm"
              icon={<ListChecks size={14} />}
              onClick={() => onOpenBatch(result.batchNumber)}
            >
              {t('warehousePrintingPrintingStation.groupsGoPickingList')}
            </Button>
            {result.replayed && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={onOpenReprint}
              >
                {t('warehousePrintingPrintingStation.reprintALabel')}
              </Button>
            )}
            {result.pdfBase64 !== null && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Download size={14} />}
                  onClick={() =>
                    downloadPdf(
                      result.pdfBase64 ?? '',
                      result.fileName ?? `${result.batchNumber}.pdf`,
                    )
                  }
                >
                  {t('warehousePrintingPrintingStation.groupsDownloadAgain')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
                  {t('warehousePrintingPrintingStation.didTheLabelsPrint')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {groups.isLoading ? (
        <SkeletonRows
          rows={3}
          cols={3}
          label={t('warehousePrintingPrintingStation.loadingTheLabelQueue')}
        />
      ) : groups.isError ? (
        <ErrorState message={serverVerdict(groups.error)} retry={() => void groups.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          tone="positive"
          title={t('warehousePrintingPrintingStation.noLabelsWaiting')}
          description={t('warehousePrintingPrintingStation.aParcelAppearsHereOnce')}
        />
      ) : (
        <>
          <div className="lg-bar">
            <Checkbox
              checked={all}
              indeterminate={chosen.length > 0 && !all}
              onChange={(e) =>
                setTicked(e.currentTarget.checked ? new Set(list.map((g) => g.key)) : new Set())
              }
              label={t('warehousePrintingPrintingStation.groupsSelectAll')}
            />
            <Button
              className="lg-print"
              onClick={() => void onPrint()}
              disabled={count === 0 || print.isPending}
              aria-busy={print.isPending}
              icon={<Printer size={16} />}
            >
              {print.isPending
                ? t('warehousePrintingPrintingStation.building')
                : count === 0
                  ? t('warehousePrintingPrintingStation.printLabels')
                  : count === 1
                    ? t('warehousePrintingPrintingStation.groupsPrintOne')
                    : t('warehousePrintingPrintingStation.groupsPrintN', { n: count })}
            </Button>
          </div>
          {count > MAX_PARCELS && (
            <p className="wh-note lg-limit">
              {t('warehousePrintingPrintingStation.groupsTooMany', { max: MAX_PARCELS })}
            </p>
          )}
          <ul className="lg-grid" aria-label={t('warehousePrintingPrintingStation.groupsTitle')}>
            {list.map((g) => (
              <GroupCard
                key={g.key}
                group={g}
                checked={ticked.has(g.key)}
                onToggle={() => toggle(g.key)}
                now={now}
              />
            ))}
          </ul>
        </>
      )}

      <Dialog
        open={asking && result !== null && result.pdfBase64 !== null}
        onOpenChange={(o) => {
          if (!o) setAsking(false);
        }}
        title={t('warehousePrintingPrintingStation.didTheLabelsPrint')}
        icon={<Printer size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t('warehousePrintingPrintingStation.notYet')}
            </Button>
            <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
              {t('warehousePrintingPrintingStation.yesTheyPrinted')}
            </Button>
          </DialogFooter>
        }
      >
        {result !== null && result.pdfBase64 !== null && (
          <div className="wh-stack">
            <p className="wh-title sk-figure">
              {t('warehousePrintingPrintingStation.groupsBatchCreated', {
                batchNumber: result.batchNumber,
              })}
            </p>
            <p className="wh-note sk-figure">
              {t('warehousePrintingPrintingStation.labelAcrossPage', {
                shipmentCount: result.shipmentCount,
                value: result.shipmentCount === 1 ? '' : t('common.pluralS'),
                pageCount: result.pageCount,
                value2: result.pageCount === 1 ? '' : t('common.pluralS'),
              })}
            </p>
            {result.failed.length > 0 && (
              <div className="wh-callout" data-tone="bad">
                <div className="wh-callout__title">
                  {t('warehousePrintingPrintingStation.couldNotBePrintedAnd', {
                    failedLength: result.failed.length,
                  })}
                </div>
                <ul>
                  {result.failed.map((f) => (
                    <li key={f.shipmentId}>
                      <span className="sk-ident">{f.shipmentNumber}</span> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="wh-note">
              {t('warehousePrintingPrintingStation.confirmingMarksTheseParcelsAs')}
            </p>
            <div className="wh-row">
              <Button
                variant="ghost"
                icon={<Printer size={16} />}
                onClick={() =>
                  printPdf(result.pdfBase64 ?? '', result.fileName ?? `${result.batchNumber}.pdf`)
                }
              >
                {t('warehousePrintingPrintingStation.groupsOpenPrint')}
              </Button>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                onClick={() =>
                  downloadPdf(
                    result.pdfBase64 ?? '',
                    result.fileName ?? `${result.batchNumber}.pdf`,
                  )
                }
              >
                {t('warehousePrintingPrintingStation.groupsDownloadAgain')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

/** One group. The whole card is the tick's label, so the whole card is the target. */
function GroupCard({
  group,
  checked,
  onToggle,
  now,
}: {
  readonly group: LabelGroup;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly now: number;
}): ReactElement {
  const t = useT();
  const id = `lg-${group.key}`;
  return (
    <li className="lg-card" data-checked={checked ? '1' : undefined}>
      <input
        id={id}
        type="checkbox"
        className="lg-card__input"
        checked={checked}
        onChange={onToggle}
      />
      <label htmlFor={id} className="lg-card__label">
        <span className="lg-card__tick" aria-hidden>
          <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
        <span className="lg-card__text">
          <span className="lg-card__name">{group.label}</span>
          <span className="lg-card__meta sk-figure">
            <span>
              {group.size === 1
                ? t('warehousePrintingPrintingStation.groupsParcelOne')
                : t('warehousePrintingPrintingStation.groupsParcelN', { n: group.size })}
            </span>
            {group.oldestPlacedAt !== null && (
              <time dateTime={group.oldestPlacedAt} className="lg-card__old">
                {t('warehousePrintingPrintingStation.groupsOldest', {
                  when: oldestAgo(group.oldestPlacedAt, now, pageDateTag()),
                })}
              </time>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}
