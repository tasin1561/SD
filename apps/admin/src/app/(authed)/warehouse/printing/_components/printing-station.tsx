'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Check, Download, FileCheck2, Printer, Search, Tags, X } from 'lucide-react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import { Table, TBody, TableEmpty, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import {
  useBuildLabels,
  useBuildPickList,
  useCancelPickBatch,
  useConfirmLabelsPrinted,
  useConfirmPickListPrinted,
  useCreatePickBatch,
  useLabelQueue,
  useLabelReprintQueue,
  useMarkBatchPicked,
  usePickBatches,
  usePickPrintQueue,
  useProductLocations,
  useReprintLabels,
  type LabelSheetResult,
  type PickListResult,
} from '@/lib/ops-hooks';
import {
  useSkuLabelHistory,
  useSkuLabelsForVariants,
  type SkuLabelPrint,
  type SkuLabelSheet,
} from '@/lib/api-hooks';
import { SkuLabelSheetView } from '@/components/sku-label-sheet';
import { serverVerdict } from '@/lib/server-verdict';
import { downloadPdf, printPdf } from '@/lib/print-pdf';
import { SelectionTable } from './selection-table';
import '../../_components/benches.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

type Tab = 'labels' | 'reprint' | 'picking' | 'batches' | 'locate';

/**
 * The print-first floor.
 *
 * ── WHY PRINT COMES FIRST ────────────────────────────────────────────
 * A parcel becomes real when its label is on it. Before that it is a row
 * in a database that nobody on the floor can act on, which is why the
 * label tab gates the picking tab rather than sitting beside it.
 *
 * ── WHY CONFIRMATION IS ITS OWN STEP ─────────────────────────────────
 * Generating a PDF is not the same event as paper existing. Printers
 * jam; downloads get eaten; somebody prints to the wrong tray. So the
 * flow is print → LOOK AT THE PAPER → confirm, and only the confirm
 * moves anything. The modal says what it will do before it does it.
 */
export function PrintingStation(): ReactElement {
  const t = useT();
  const [tab, setTab] = useState<Tab>('labels');

  return (
    <div className="wh-page">
      <PageHeader
        breadcrumbs={[
          { label: t('warehousePrintingPrintingStation.warehouse'), href: '/warehouse' },
          { label: t('warehousePrintingPrintingStation.printing') },
        ]}
        Link={Link}
        title={t('warehousePrintingPrintingStation.printing')}
        subtitle={t('warehousePrintingPrintingStation.labelsFirstThenThePicking')}
      />

      {/* Real buttons (the specs drive them by role), drawn as one
          segmented bar; `aria-pressed` says which view is showing. */}
      <div
        className="wh-seg"
        role="group"
        aria-label={t('warehousePrintingPrintingStation.printingViews')}
      >
        {(
          [
            ['labels', t('warehousePrintingPrintingStation.shippingLabels')],
            ['reprint', t('warehousePrintingPrintingStation.reprintALabel')],
            ['picking', t('warehousePrintingPrintingStation.pickingList')],
            ['batches', t('warehousePrintingPrintingStation.pastBatches')],
            ['locate', t('warehousePrintingPrintingStation.findAProduct')],
          ] as ReadonlyArray<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="wh-seg__btn"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'labels' && <LabelTab />}
      {tab === 'reprint' && <ReprintTab />}
      {tab === 'picking' && <PickingTab />}
      {tab === 'batches' && <BatchesTab />}
      {tab === 'locate' && <LocateTab />}
    </div>
  );
}

// ── tab 1 ─────────────────────────────────────────────────────────────

function LabelTab(): ReactElement {
  const t = useT();
  const queue = useLabelQueue();
  const build = useBuildLabels();
  const confirm = useConfirmLabelsPrinted();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<LabelSheetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = queue.data ?? [];
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.shipmentId)),
    );

  async function onBuild(): Promise<void> {
    setError(null);
    try {
      const result = await build.mutateAsync([...selected]);
      setSheet(result);
      printPdf(result.pdfBase64, result.fileName);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onConfirm(): Promise<void> {
    if (sheet === null) return;
    try {
      const r = await confirm.mutateAsync([...selected]);
      toast.success(
        t('warehousePrintingPrintingStation.labelConfirmedThoseParcelsAre', {
          confirmed: r.confirmed,
          value: r.confirmed === 1 ? '' : t('common.pluralS'),
        }),
      );
      setSheet(null);
      setSelected(new Set());
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <section className="wh-card wh-stack">
      {error !== null && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      <div className="wh-row wh-row--between">
        <div className="wh-note sk-figure">
          {selected.size === 0
            ? t('warehousePrintingPrintingStation.parcelWaitingOnALabel', {
                length: rows.length,
                value: rows.length === 1 ? '' : t('common.pluralS'),
              })
            : `${selected.size} selected`}
        </div>
        <Button
          onClick={() => void onBuild()}
          disabled={selected.size === 0 || build.isPending}
          aria-busy={build.isPending}
          icon={<Printer size={16} />}
        >
          {build.isPending
            ? t('warehousePrintingPrintingStation.building')
            : t('warehousePrintingPrintingStation.printLabels')}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows
          rows={5}
          cols={7}
          label={t('warehousePrintingPrintingStation.loadingTheLabelQueue')}
        />
      ) : queue.isError ? (
        <ErrorState
          message={
            queue.error?.message ?? t('warehousePrintingPrintingStation.couldNotLoadTheQueue')
          }
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          emptyTitle={t('warehousePrintingPrintingStation.noLabelsWaiting')}
          emptyBody={t('warehousePrintingPrintingStation.aParcelAppearsHereOnce')}
        />
      )}

      <Dialog
        open={sheet !== null}
        onOpenChange={(o) => {
          if (!o) setSheet(null);
        }}
        title={t('warehousePrintingPrintingStation.didTheLabelsPrint')}
        icon={<Printer size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSheet(null)}>
              {t('warehousePrintingPrintingStation.notYet')}
            </Button>
            <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
              {t('warehousePrintingPrintingStation.yesTheyPrinted')}
            </Button>
          </DialogFooter>
        }
      >
        {sheet !== null && (
          <div className="wh-stack">
            <p className="wh-title sk-figure">
              {t('warehousePrintingPrintingStation.labelAcrossPage', {
                shipmentCount: sheet.shipmentCount,
                value: sheet.shipmentCount === 1 ? '' : t('common.pluralS'),
                pageCount: sheet.pageCount,
                value2: sheet.pageCount === 1 ? '' : t('common.pluralS'),
              })}
            </p>
            {/* Named, never dropped: a short stack looks identical to a
                complete one once it is on the bench. */}
            {sheet.failed.length > 0 && (
              <div className="wh-callout" data-tone="bad">
                <div className="wh-callout__title">
                  {t('warehousePrintingPrintingStation.couldNotBePrintedAnd', {
                    failedLength: sheet.failed.length,
                  })}
                </div>
                <ul>
                  {sheet.failed.map((f) => (
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
            <div>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                onClick={() => downloadPdf(sheet.pdfBase64, sheet.fileName)}
              >
                {t('warehousePrintingPrintingStation.downloadInstead')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

// ── tab 2 ─────────────────────────────────────────────────────────────

function PickingTab(): ReactElement {
  const t = useT();

  const queue = usePickPrintQueue();
  const createBatch = useCreatePickBatch();
  const buildList = useBuildPickList();
  const confirm = useConfirmPickListPrinted();
  const cancel = useCancelPickBatch();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [list, setList] = useState<PickListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);

  const rows = queue.data ?? [];
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.shipmentId)),
    );

  async function onBuild(): Promise<void> {
    setError(null);
    try {
      const batch = await createBatch.mutateAsync([...selected]);
      const result = await buildList.mutateAsync(batch.id);
      setList(result);
      printPdf(result.pdfBase64, result.fileName);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onConfirm(): Promise<void> {
    if (list === null) return;
    try {
      const r = await confirm.mutateAsync(list.batchId);
      toast.success(
        t('warehousePrintingPrintingStation.isOnTheFloorOrders', {
          batchNumber: r.batchNumber,
          transitioned: r.transitioned,
        }),
      );
      setList(null);
      setSelected(new Set());
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onAbandon(): Promise<boolean> {
    if (list === null) return false;
    try {
      await cancel.mutateAsync(list.batchId);
      toast.success(t('warehousePrintingPrintingStation.batchAbandonedThoseParcelsAre'));
      setList(null);
      setSelected(new Set());
      return true;
    } catch (e) {
      setError(serverVerdict(e));
      return false;
    }
  }

  const busy = createBatch.isPending || buildList.isPending;

  return (
    <section className="wh-card wh-stack">
      {error !== null && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      <div className="wh-row wh-row--between">
        <div className="wh-note sk-figure">
          {selected.size === 0
            ? t('warehousePrintingPrintingStation.labelledParcelReadyToPick', {
                length: rows.length,
                value: rows.length === 1 ? '' : t('common.pluralS'),
              })
            : `${selected.size} selected`}
        </div>
        <Button
          onClick={() => void onBuild()}
          disabled={selected.size === 0 || busy}
          aria-busy={busy}
          icon={<Printer size={16} />}
        >
          {busy
            ? t('warehousePrintingPrintingStation.building')
            : t('warehousePrintingPrintingStation.printPickingList')}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows
          rows={5}
          cols={7}
          label={t('warehousePrintingPrintingStation.loadingThePickingQueue')}
        />
      ) : queue.isError ? (
        <ErrorState
          message={
            queue.error?.message ?? t('warehousePrintingPrintingStation.couldNotLoadTheQueue')
          }
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          emptyTitle={t('warehousePrintingPrintingStation.nothingReadyToPick')}
          emptyBody={t('warehousePrintingPrintingStation.printAShippingLabelFirst')}
        />
      )}

      <Dialog
        open={list !== null}
        onOpenChange={(o) => {
          if (!o) setList(null);
        }}
        title={t('warehousePrintingPrintingStation.didThePickingListPrint')}
        icon={<FileCheck2 size={18} />}
        footer={
          <DialogFooter>
            {/* An abandoned batch has to release its parcels, or they sit
                claimed by a walk nobody is doing. */}
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setAbandonOpen(true);
              }}
              disabled={cancel.isPending}
            >
              {t('warehousePrintingPrintingStation.abandonThisBatch')}
            </Button>
            <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
              {t('warehousePrintingPrintingStation.yesItPrinted')}
            </Button>
          </DialogFooter>
        }
      >
        {list !== null && (
          <div className="wh-stack">
            <p className="wh-title">
              {richMessage(t('warehousePrintingPrintingStation.lineToWalk'), {
                span: <span className="sk-ident">{list.batchNumber}</span>,
                span2: <span className="sk-figure">{list.lineCount}</span>,
                value: list.lineCount === 1 ? '' : t('common.pluralS'),
              })}
            </p>
            {list.strictMode && (
              <p className="wh-note">
                {t('warehousePrintingPrintingStation.strictProductsOnThisSheet')}
              </p>
            )}
            {list.shortfalls.length > 0 && (
              <div className="wh-callout" data-tone="bad">
                <div className="wh-callout__title">
                  {t('warehousePrintingPrintingStation.lineCouldNotBeAllocated', {
                    shortfallsLength: list.shortfalls.length,
                    value: list.shortfalls.length === 1 ? '' : t('common.pluralS'),
                  })}
                </div>
                <p>{t('warehousePrintingPrintingStation.theyAreOnTheSheet')}</p>
              </div>
            )}
            <p className="wh-note">
              {t('warehousePrintingPrintingStation.confirmingSendsTheseOrdersTo')}
            </p>
            <div>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                onClick={() => downloadPdf(list.pdfBase64, list.fileName)}
              >
                {t('warehousePrintingPrintingStation.downloadInstead')}
              </Button>
            </div>

            {/* Rendered inside the sheet dialog so it stacks above it. */}
            <ConfirmDialog
              open={abandonOpen}
              onOpenChange={setAbandonOpen}
              title={t('warehousePrintingPrintingStation.abandonThisBatch2')}
              entity={list.batchNumber}
              entityIsIdentifier
              consequence={t('warehousePrintingPrintingStation.thePickingListIsWithdrawn')}
              confirmLabel={t('warehousePrintingPrintingStation.abandonTheBatch')}
              destructive
              error={error}
              onConfirm={async () => {
                const ok = await onAbandon();
                if (!ok) throw new Error('refused');
                setAbandonOpen(false);
              }}
            />
          </div>
        )}
      </Dialog>
    </section>
  );
}

// ── reprint ───────────────────────────────────────────────────────────

/** `ReprintLabelsDto.reason` is `@MinLength(10)`. Said on the field, so a
 *  dead button is never the first thing that explains the rule. */
const MIN_REPRINT_REASON = 10;

/**
 * Print a label again for a parcel that has not been packed.
 *
 * A label gets torn off a carton, jams half out of the printer, or goes
 * out with the wrong stack. Before this there was no way back to it: a
 * printed parcel left the label queue for good.
 *
 * NOT PACKED is the boundary, and it is the safety argument. Up to the
 * pack bench the parcel is a claim, not a box — two copies of its label
 * are two pieces of paper, and only one box can ever be opened against
 * it (`pack_boxes` holds a partial unique on the shipment). Once the box
 * is sealed a second label is a second box waiting to happen, so a
 * packed parcel is not on this list and the server refuses it by name.
 *
 * The print count sits on every row, because the question worth asking
 * before adding another copy is how many are already out there.
 */
function ReprintTab(): ReactElement {
  const t = useT();
  const queue = useLabelReprintQueue();
  const reprint = useReprintLabels();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows = queue.data ?? [];
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.shipmentId)),
    );

  async function onReprint(): Promise<void> {
    setError(null);
    try {
      const sheet = await reprint.mutateAsync({ shipmentIds: [...selected], reason });
      printPdf(sheet.pdfBase64, sheet.fileName);
      toast.success(
        t('warehousePrintingPrintingStation.labelReprinted', {
          shipmentCount: sheet.shipmentCount,
          value: sheet.shipmentCount === 1 ? '' : t('common.pluralS'),
        }),
      );
      setSelected(new Set());
      setReason('');
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <section className="wh-card wh-stack">
      {error !== null && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      <p className="wh-note">{t('warehousePrintingPrintingStation.parcelsWhoseLabelIsPrinted')}</p>

      <div className="wh-fields wh-reprint">
        <TextField
          id="reprint-reason"
          label={t('warehousePrintingPrintingStation.whyIsItBeingReprinted')}
          value={reason}
          requiredMark
          placeholder={t('warehousePrintingPrintingStation.eGLabelTornOff')}
          hint={t('warehousePrintingPrintingStation.atLeastCharactersItIs', {
            minReprintReason: MIN_REPRINT_REASON,
          })}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="lg"
          onClick={() => void onReprint()}
          disabled={
            selected.size === 0 || reason.trim().length < MIN_REPRINT_REASON || reprint.isPending
          }
          title={
            selected.size === 0
              ? t('warehousePrintingPrintingStation.tickTheParcelSWhose')
              : reason.trim().length < MIN_REPRINT_REASON
                ? t('warehousePrintingPrintingStation.giveAReasonOfAt', {
                    minReprintReason: MIN_REPRINT_REASON,
                  })
                : undefined
          }
          icon={<Printer size={16} />}
        >
          {reprint.isPending
            ? t('warehousePrintingPrintingStation.building')
            : t('warehousePrintingPrintingStation.reprint', {
                value: selected.size === 0 ? '' : selected.size,
              })}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows
          rows={5}
          cols={8}
          label={t('warehousePrintingPrintingStation.loadingPrintedParcels')}
        />
      ) : queue.isError ? (
        <ErrorState
          message={
            queue.error?.message ?? t('warehousePrintingPrintingStation.couldNotLoadTheList')
          }
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          showPrintCount
          emptyTitle={t('warehousePrintingPrintingStation.nothingToReprint')}
          emptyBody={t('warehousePrintingPrintingStation.aParcelAppearsHereOnce2')}
        />
      )}
    </section>
  );
}

// ── tab 3 ─────────────────────────────────────────────────────────────

function BatchesTab(): ReactElement {
  const t = useT();
  const [search, setSearch] = useState('');
  const batches = usePickBatches(search);
  const buildList = useBuildPickList();
  const markPicked = useMarkBatchPicked();
  const confirm = useConfirmPickListPrinted();
  const cancel = useCancelPickBatch();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  // Parcels a "Picked" left behind, per batch. The batch view does not
  // carry them, so they are remembered from the mark-picked answer for as
  // long as this screen is open — long enough to walk to the station.
  const [skippedByBatch, setSkippedByBatch] = useState<
    Readonly<Record<string, ReadonlyArray<{ shipmentNumber: string; reason: string }>>>
  >({});
  // The batch an irreversible row action is waiting to be confirmed on.
  const [pendingAct, setPendingAct] = useState<{
    readonly kind: 'abandon' | 'picked';
    readonly id: string;
    readonly batchNumber: string;
    readonly shipmentCount: number;
  } | null>(null);
  function ask(act: NonNullable<typeof pendingAct>): void {
    setError(null);
    setPendingAct(act);
  }

  /*
    FINISHING A DRAFT FROM HERE.

    Confirming the print used to live ONLY in the modal that opens the
    moment a sheet is built, so closing that modal — a stray click, a
    reload, going to find the printer — stranded the batch in DRAFT with
    no way back to it. That is not cosmetic: a batch holds its parcels
    via `shipment.pickBatchId`, which is what takes them out of the
    picking queue, so those parcels became invisible on the tab that
    would otherwise offer them and could not be walked from this one.
    The two ways out of DRAFT belong wherever a draft can be SEEN.
  */
  async function onConfirmPrinted(batchId: string): Promise<void> {
    setError(null);
    try {
      const r = await confirm.mutateAsync(batchId);
      toast.success(
        t('warehousePrintingPrintingStation.isOnTheFloorOrders', {
          batchNumber: r.batchNumber,
          transitioned: r.transitioned,
        }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onAbandon(batchId: string): Promise<boolean> {
    setError(null);
    try {
      await cancel.mutateAsync(batchId);
      toast.success(t('warehousePrintingPrintingStation.batchAbandonedThoseParcelsAre2'));
      return true;
    } catch (e) {
      setError(serverVerdict(e));
      return false;
    }
  }

  async function onPicked(batchId: string): Promise<boolean> {
    setError(null);
    try {
      const r = await markPicked.mutateAsync(batchId);
      setSkippedByBatch((prev) => ({ ...prev, [batchId]: r.skipped }));
      if (r.skipped.length > 0) {
        // Named, not swallowed: a serialised parcel still needs its
        // units scanning, and a silent partial would leave it sitting.
        toast.error(
          t('warehousePrintingPrintingStation.sentToPackingStillNeed', {
            picked: r.picked,
            skippedLength: r.skipped.length,
          }),
        );
      } else {
        toast.success(
          t('warehousePrintingPrintingStation.pickedParcelsAreAtThe', {
            batchNumber: r.batchNumber,
            picked: r.picked,
          }),
        );
      }
      return true;
    } catch (e) {
      setError(serverVerdict(e));
      return false;
    }
  }

  async function reprint(batchId: string): Promise<void> {
    setError(null);
    try {
      const r = await buildList.mutateAsync(batchId);
      printPdf(r.pdfBase64, r.fileName);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <section className="wh-card wh-stack">
      {error !== null && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}
      <SkippedNotice skippedByBatch={skippedByBatch} batches={batches.data ?? []} />
      <div className="wh-search">
        <TextField
          label={t('warehousePrintingPrintingStation.searchBatches')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('warehousePrintingPrintingStation.batchNumberOrderNumberOr')}
          aria-label={t('warehousePrintingPrintingStation.searchBatches')}
          icon={<Search size={16} />}
        />
      </div>

      {batches.isLoading ? (
        <SkeletonRows
          rows={5}
          cols={7}
          label={t('warehousePrintingPrintingStation.loadingBatches')}
        />
      ) : batches.isError ? (
        <ErrorState
          message={
            batches.error?.message ?? t('warehousePrintingPrintingStation.couldNotLoadBatches')
          }
          retry={() => void batches.refetch()}
        />
      ) : (
        <Table caption={t('warehousePrintingPrintingStation.pickBatches')}>
          <THead>
            <Tr>
              <Th>{t('warehousePrintingPrintingStation.batch')}</Th>
              <Th>{t('warehousePrintingPrintingStation.status')}</Th>
              <Th>{t('warehousePrintingPrintingStation.warehouse')}</Th>
              <Th align="right">{t('warehousePrintingPrintingStation.parcels')}</Th>
              <Th>{t('warehousePrintingPrintingStation.created')}</Th>
              <Th>{t('warehousePrintingPrintingStation.printed')}</Th>
              <Th>{t('warehousePrintingPrintingStation.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {(batches.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>
                <div className="wh-empty-cell wh-note">
                  {search.trim() === ''
                    ? t('warehousePrintingPrintingStation.noBatchesYet')
                    : t('warehousePrintingPrintingStation.nothingMatchesThat')}
                </div>
              </TableEmpty>
            ) : (
              (batches.data ?? []).map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <span className="sk-ident">{b.batchNumber}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={
                        b.status === 'PRINTED'
                          ? 'confirmed'
                          : b.status === 'COMPLETED'
                            ? 'delivered'
                            : b.status === 'CANCELLED'
                              ? 'cancelled'
                              : 'draft'
                      }
                      label={b.status.toLowerCase()}
                      size="sm"
                    />
                  </Td>
                  <Td>{b.warehouseName}</Td>
                  <Td align="right" className="sk-figure">
                    {b.shipmentCount}
                  </Td>
                  <Td>
                    <div className="sk-figure">
                      {new Date(b.createdAtIso).toLocaleString('en-IN')}
                    </div>
                    <div className="wh-faint">{b.createdByName ?? '—'}</div>
                  </Td>
                  <Td>
                    {b.printedAtIso === null ? (
                      <span className="wh-faint">—</span>
                    ) : (
                      <>
                        <div className="sk-figure">
                          {new Date(b.printedAtIso).toLocaleString('en-IN')}
                        </div>
                        <div className="wh-faint">{b.printedByName ?? '—'}</div>
                      </>
                    )}
                    {/* How many sheets exist, which is a different
                        question from when the first one was confirmed:
                        two copies of a walk in the building is the
                        thing worth noticing. */}
                    {b.printCount > 1 && (
                      <div className="wh-warn sk-figure">
                        {t('warehousePrintingPrintingStation.sheetsPrinted', {
                          printCount: b.printCount,
                        })}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="wh-row">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void reprint(b.id)}
                        disabled={buildList.isPending}
                        aria-label={t('warehousePrintingPrintingStation.reprint2', {
                          batchNumber: b.batchNumber,
                        })}
                        icon={<Printer size={16} />}
                      />
                      {/* A draft has exactly two ways out, and the
                          sheet is already reprintable beside them. */}
                      {b.status === 'DRAFT' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void onConfirmPrinted(b.id)}
                            disabled={confirm.isPending}
                            aria-label={t('warehousePrintingPrintingStation.confirmPrinted', {
                              batchNumber: b.batchNumber,
                            })}
                            icon={<Check size={16} />}
                          >
                            {t('warehousePrintingPrintingStation.itPrinted')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              ask({
                                kind: 'abandon',
                                id: b.id,
                                batchNumber: b.batchNumber,
                                shipmentCount: b.shipmentCount,
                              })
                            }
                            disabled={cancel.isPending}
                            aria-label={t('warehousePrintingPrintingStation.abandon2', {
                              batchNumber: b.batchNumber,
                            })}
                            icon={<X size={16} />}
                          >
                            {t('warehousePrintingPrintingStation.abandon')}
                          </Button>
                        </>
                      )}
                      {/* Only a printed batch can be walked, so only a
                          printed batch can come back from one. */}
                      {b.status === 'PRINTED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            ask({
                              kind: 'picked',
                              id: b.id,
                              batchNumber: b.batchNumber,
                              shipmentCount: b.shipmentCount,
                            })
                          }
                          disabled={markPicked.isPending}
                          aria-label={t('warehousePrintingPrintingStation.markPicked', {
                            batchNumber: b.batchNumber,
                          })}
                          icon={<Check size={16} />}
                        >
                          {t('warehousePrintingPrintingStation.picked')}
                        </Button>
                      )}
                      {(skippedByBatch[b.id]?.length ?? 0) > 0 && (
                        <Link href="/warehouse/pick" className="wh-link">
                          {t('warehousePrintingPrintingStation.scanAtThePickStation', {
                            length: skippedByBatch[b.id]?.length ?? 0,
                          })}
                        </Link>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={pendingAct !== null}
        onOpenChange={(next) => {
          if (!next) setPendingAct(null);
        }}
        title={
          pendingAct?.kind === 'picked'
            ? t('warehousePrintingPrintingStation.markThisBatchPicked')
            : t('warehousePrintingPrintingStation.abandonThisBatch2')
        }
        entity={pendingAct?.batchNumber ?? ''}
        entityIsIdentifier
        consequence={
          pendingAct?.kind === 'picked'
            ? t('warehousePrintingPrintingStation.itsParcelSAreRecorded', {
                shipmentCount: pendingAct.shipmentCount,
              })
            : t('warehousePrintingPrintingStation.theBatchIsWithdrawnAnd', {
                value: pendingAct?.shipmentCount ?? 0,
              })
        }
        confirmLabel={
          pendingAct?.kind === 'picked'
            ? t('warehousePrintingPrintingStation.markPicked2')
            : t('warehousePrintingPrintingStation.abandonTheBatch')
        }
        destructive={pendingAct?.kind !== 'picked'}
        error={error}
        onConfirm={async () => {
          if (pendingAct === null) return;
          const ok =
            pendingAct.kind === 'picked'
              ? await onPicked(pendingAct.id)
              : await onAbandon(pendingAct.id);
          if (!ok) throw new Error('refused');
        }}
      />
    </section>
  );
}

/**
 * STRICT-mode parcels a batch could not close from paper (UNIT-2: their
 * serials must be scanned at pick), named with the one place that can
 * finish them. The per-parcel station is out of the nav on purpose — it
 * is the escape hatch, reached from exactly the moment it is needed.
 */
function SkippedNotice({
  skippedByBatch,
  batches,
}: {
  readonly skippedByBatch: Readonly<
    Record<string, ReadonlyArray<{ shipmentNumber: string; reason: string }>>
  >;
  readonly batches: ReadonlyArray<{ id: string; batchNumber: string }>;
}): ReactElement | null {
  const t = useT();
  const entries = Object.entries(skippedByBatch).filter(([, list]) => list.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="wh-callout">
      <p className="wh-callout__lead">
        {t('warehousePrintingPrintingStation.theseParcelsCarrySerialisedUnits')}{' '}
        <Link href="/warehouse/pick" className="wh-link">
          {t('warehousePrintingPrintingStation.openThePickStation')}
        </Link>
      </p>
      <ul>
        {entries.map(([batchId, list]) =>
          list.map((s) => (
            <li key={`${batchId}:${s.shipmentNumber}`}>
              <span className="sk-ident">{s.shipmentNumber}</span>
              {' · '}
              <span className="sk-ident">
                {batches.find((b) => b.id === batchId)?.batchNumber ?? 'batch'}
              </span>{' '}
              · {s.reason}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

// ── tab 4 ─────────────────────────────────────────────────────────────

function LocateTab(): ReactElement {
  const t = useT();
  const toast = useToast();
  const [q, setQ] = useState('');
  const results = useProductLocations(q);
  const reprint = useSkuLabelsForVariants();
  const [reprintSheet, setReprintSheet] = useState<SkuLabelSheet | null>(null);

  if (reprintSheet !== null) {
    return <SkuLabelSheetView sheet={reprintSheet} onClose={() => setReprintSheet(null)} />;
  }

  return (
    <div className="wh-stack">
      <section className="wh-card wh-stack">
        <div className="wh-search">
          <TextField
            label={t('warehousePrintingPrintingStation.findAProduct')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('warehousePrintingPrintingStation.productNameSkuOrBarcode')}
            aria-label={t('warehousePrintingPrintingStation.findAProduct')}
            icon={<Search size={16} />}
          />
        </div>

        {q.trim().length < 2 ? (
          <EmptyState
            bare
            icon={<Search size={22} />}
            title={t('warehousePrintingPrintingStation.whereIsIt')}
            description={t('warehousePrintingPrintingStation.typeAtLeastTwoCharacters')}
          />
        ) : results.isLoading ? (
          <SkeletonRows rows={3} cols={3} label={t('warehousePrintingPrintingStation.looking')} />
        ) : results.isError ? (
          <ErrorState
            message={results.error?.message ?? t('warehousePrintingPrintingStation.couldNotSearch')}
            retry={() => void results.refetch()}
          />
        ) : (results.data ?? []).length === 0 ? (
          <EmptyState bare title={t('warehousePrintingPrintingStation.nothingMatchesThat')} />
        ) : (
          <div className="wh-stack">
            {(results.data ?? []).map((r) => (
              <div key={r.variantId} className="wh-result">
                <div className="wh-row wh-row--between">
                  <div className="wh-min0">
                    <span className="wh-item__name">{r.productName}</span>
                    {r.variantLabel !== null && (
                      <span className="wh-note"> — {r.variantLabel}</span>
                    )}
                  </div>
                  <div className="wh-row">
                    <div className="sk-ident wh-note">
                      {r.skuCode}
                      {r.barcode !== null && ` · ${r.barcode}`}
                    </div>
                    {/* The sticker that fell off. Quantity is asked for
                      rather than assumed: you are replacing what came
                      off, not relabelling the shelf. Still a
                      `window.prompt` — scan-printing-quantity.test.tsx
                      pins that exact contract. */}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Tags size={14} />}
                      disabled={reprint.isPending}
                      onClick={() => {
                        const raw = window.prompt(
                          t('warehousePrintingPrintingStation.howManyLabelsFor', {
                            skuCode: r.skuCode,
                          }),
                          '1',
                        );
                        if (raw === null) return;
                        const quantity = Number.parseInt(raw, 10);
                        if (!Number.isFinite(quantity) || quantity < 1) return;
                        reprint.mutate([{ variantId: r.variantId, quantity }], {
                          onSuccess: (sheet) => setReprintSheet(sheet),
                          // A strict product is refused by the server with the
                          // reason — show it verbatim (FE-2), never silently.
                          onError: (e) => toast.error(serverVerdict(e)),
                        });
                      }}
                    >
                      {t('warehousePrintingPrintingStation.labels')}
                    </Button>
                  </div>
                </div>
                {r.locations.length === 0 ? (
                  <div className="wh-note">
                    {t('warehousePrintingPrintingStation.noStockOnHandAnywhere')}
                  </div>
                ) : (
                  <div className="wh-locs">
                    {r.locations.map((loc, i) => (
                      <div key={`${loc.warehouseName}-${loc.binCode}-${i}`} className="wh-loc">
                        <div className="wh-loc__code sk-ident">{loc.binCode}</div>
                        <div className="wh-faint">
                          {loc.warehouseName}
                          {loc.zoneName !== null && ` · ${loc.zoneName}`}
                        </div>
                        <div className="wh-row">
                          <span className="sk-figure">{loc.qtyOnHand}</span>
                          {!loc.pickable && (
                            <StatusChip
                              kind="pending"
                              label={t('warehousePrintingPrintingStation.notSellable')}
                              size="sm"
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <StickerHistory />
    </div>
  );
}

/**
 * Every product-sticker sheet recently built — from a goods receipt or
 * from this tab — so "were these ever labelled, and by whom?" has an
 * answer. It records the sheet being BUILT; whether the paper came out
 * of the printer is not something the server can see.
 */
function StickerHistory(): ReactElement {
  const t = useT();
  const history = useSkuLabelHistory();
  return (
    <section className="wh-card wh-stack">
      <SectionHeading
        title={t('warehousePrintingPrintingStation.recentlyPrintedStickers')}
        note={t('warehousePrintingPrintingStation.everyProductLabelSheetBuilt')}
      />
      {history.isLoading ? (
        <SkeletonRows rows={4} cols={5} label={t('warehousePrintingPrintingStation.loading')} />
      ) : history.isError ? (
        <ErrorState
          message={
            history.error?.message ?? t('warehousePrintingPrintingStation.couldNotLoadTheSticker')
          }
          retry={() => void history.refetch()}
        />
      ) : (
        <Table caption={t('warehousePrintingPrintingStation.recentlyPrintedStickers')}>
          <THead>
            <Tr>
              <Th>{t('warehousePrintingPrintingStation.when')}</Th>
              <Th>{t('warehousePrintingPrintingStation.who')}</Th>
              <Th>{t('warehousePrintingPrintingStation.stickers')}</Th>
              <Th>{t('warehousePrintingPrintingStation.from')}</Th>
              <Th align="right">{t('warehousePrintingPrintingStation.total')}</Th>
            </Tr>
          </THead>
          <TBody>
            {(history.data ?? []).length === 0 ? (
              <TableEmpty colSpan={5}>
                {t('warehousePrintingPrintingStation.noStickersPrintedYetPrint')}
              </TableEmpty>
            ) : (
              (history.data ?? []).map((p, i) => <StickerHistoryRow key={`${p.at}-${i}`} p={p} />)
            )}
          </TBody>
        </Table>
      )}
    </section>
  );
}

function StickerHistoryRow({ p }: { p: SkuLabelPrint }): ReactElement {
  const t = useT();
  const when = new Date(p.at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const from =
    p.source === 'GOODS_RECEIPT'
      ? t('warehousePrintingPrintingStation.receipt', { value: p.receiptNumber ?? '' }).trim()
      : p.source === 'FIND_A_PRODUCT'
        ? t('warehousePrintingPrintingStation.findAProduct')
        : '—';
  return (
    <Tr>
      <Td className="sk-figure wh-nowrap">{when}</Td>
      <Td>{p.by ?? '—'}</Td>
      <Td>
        <div className="wh-row">
          {p.lines.map((l) => (
            <span key={l.skuCode} className="sk-ident wh-note">
              {l.skuCode} × {l.quantity}
            </span>
          ))}
        </div>
      </Td>
      <Td>{from}</Td>
      <Td align="right" className="sk-figure">
        {p.totalStickers}
      </Td>
    </Tr>
  );
}
