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
  const [tab, setTab] = useState<Tab>('labels');

  return (
    <div className="wh-page">
      <PageHeader
        breadcrumbs={[{ label: 'Warehouse', href: '/warehouse' }, { label: 'Printing' }]}
        Link={Link}
        title="Printing"
        subtitle="Labels first, then the picking sheet. Nothing moves until somebody confirms the paper came out."
      />

      {/* Real buttons (the specs drive them by role), drawn as one
          segmented bar; `aria-pressed` says which view is showing. */}
      <div className="wh-seg" role="group" aria-label="Printing views">
        {(
          [
            ['labels', 'Shipping labels'],
            ['reprint', 'Reprint a label'],
            ['picking', 'Picking list'],
            ['batches', 'Past batches'],
            ['locate', 'Find a product'],
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
        `${r.confirmed} label${r.confirmed === 1 ? '' : 's'} confirmed — those parcels are ready to pick`,
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
            ? `${rows.length} parcel${rows.length === 1 ? '' : 's'} waiting on a label`
            : `${selected.size} selected`}
        </div>
        <Button
          onClick={() => void onBuild()}
          disabled={selected.size === 0 || build.isPending}
          aria-busy={build.isPending}
          icon={<Printer size={16} />}
        >
          {build.isPending ? 'Building…' : 'Print labels'}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows rows={5} cols={7} label="Loading the label queue…" />
      ) : queue.isError ? (
        <ErrorState
          message={queue.error?.message ?? 'Could not load the queue.'}
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          emptyTitle="No labels waiting"
          emptyBody="A parcel appears here once a courier has issued its waybill."
        />
      )}

      <Dialog
        open={sheet !== null}
        onOpenChange={(o) => {
          if (!o) setSheet(null);
        }}
        title="Did the labels print?"
        icon={<Printer size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSheet(null)}>
              Not yet
            </Button>
            <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
              Yes, they printed
            </Button>
          </DialogFooter>
        }
      >
        {sheet !== null && (
          <div className="wh-stack">
            <p className="wh-title sk-figure">
              {sheet.shipmentCount} label{sheet.shipmentCount === 1 ? '' : 's'} across{' '}
              {sheet.pageCount} page{sheet.pageCount === 1 ? '' : 's'}.
            </p>
            {/* Named, never dropped: a short stack looks identical to a
                complete one once it is on the bench. */}
            {sheet.failed.length > 0 && (
              <div className="wh-callout" data-tone="bad">
                <div className="wh-callout__title">
                  {sheet.failed.length} could not be printed and are NOT in this file
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
              Confirming marks these parcels as labelled and moves them to the picking tab. Only
              confirm what is actually on paper in front of you.
            </p>
            <div>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                onClick={() => downloadPdf(sheet.pdfBase64, sheet.fileName)}
              >
                Download instead
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
        `${r.batchNumber} is on the floor — ${r.transitioned} orders sent to be picked`,
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
      toast.success('Batch abandoned — those parcels are back in the queue');
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
            ? `${rows.length} labelled parcel${rows.length === 1 ? '' : 's'} ready to pick`
            : `${selected.size} selected`}
        </div>
        <Button
          onClick={() => void onBuild()}
          disabled={selected.size === 0 || busy}
          aria-busy={busy}
          icon={<Printer size={16} />}
        >
          {busy ? 'Building…' : 'Print picking list'}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows rows={5} cols={7} label="Loading the picking queue…" />
      ) : queue.isError ? (
        <ErrorState
          message={queue.error?.message ?? 'Could not load the queue.'}
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          emptyTitle="Nothing ready to pick"
          emptyBody="Print a shipping label first — a parcel with no label has nothing saying where it goes."
        />
      )}

      <Dialog
        open={list !== null}
        onOpenChange={(o) => {
          if (!o) setList(null);
        }}
        title="Did the picking list print?"
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
              Abandon this batch
            </Button>
            <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
              Yes, it printed
            </Button>
          </DialogFooter>
        }
      >
        {list !== null && (
          <div className="wh-stack">
            <p className="wh-title">
              <span className="sk-ident">{list.batchNumber}</span> —{' '}
              <span className="sk-figure">{list.lineCount}</span> line
              {list.lineCount === 1 ? '' : 's'} to walk.
            </p>
            {list.strictMode && (
              <p className="wh-note">
                Strict products on this sheet show no SKU barcode — each of their units is scanned
                by its own serial at the packing table. Normal products keep their barcode.
              </p>
            )}
            {list.shortfalls.length > 0 && (
              <div className="wh-callout" data-tone="bad">
                <div className="wh-callout__title">
                  {list.shortfalls.length} line{list.shortfalls.length === 1 ? '' : 's'} could not
                  be allocated
                </div>
                <p>
                  They are on the sheet marked NOT ALLOCATED. The rest of the batch is still
                  walkable; bring those back to a supervisor.
                </p>
              </div>
            )}
            <p className="wh-note">Confirming sends these orders to be picked and then packed.</p>
            <div>
              <Button
                variant="ghost"
                icon={<Download size={16} />}
                onClick={() => downloadPdf(list.pdfBase64, list.fileName)}
              >
                Download instead
              </Button>
            </div>

            {/* Rendered inside the sheet dialog so it stacks above it. */}
            <ConfirmDialog
              open={abandonOpen}
              onOpenChange={setAbandonOpen}
              title="Abandon this batch?"
              entity={list.batchNumber}
              entityIsIdentifier
              consequence="The picking list is withdrawn and every parcel on it goes back to the picking queue, unpicked."
              confirmLabel="Abandon the batch"
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
        `${sheet.shipmentCount} label${sheet.shipmentCount === 1 ? '' : 's'} reprinted`,
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

      <p className="wh-note">
        Parcels whose label is printed but which have not been packed. A packed parcel is not here
        on purpose — a second label on a sealed box is how two parcels come to carry one waybill.
      </p>

      <div className="wh-fields wh-reprint">
        <TextField
          id="reprint-reason"
          label="Why is it being reprinted?"
          value={reason}
          placeholder="e.g. label torn off the carton in the aisle"
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size="lg"
          onClick={() => void onReprint()}
          disabled={selected.size === 0 || reason.trim().length < 10 || reprint.isPending}
          icon={<Printer size={16} />}
        >
          {reprint.isPending ? 'Building…' : `Reprint ${selected.size === 0 ? '' : selected.size}`}
        </Button>
      </div>

      {queue.isLoading ? (
        <SkeletonRows rows={5} cols={8} label="Loading printed parcels…" />
      ) : queue.isError ? (
        <ErrorState
          message={queue.error?.message ?? 'Could not load the list.'}
          retry={() => void queue.refetch()}
        />
      ) : (
        <SelectionTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          showPrintCount
          emptyTitle="Nothing to reprint"
          emptyBody="A parcel appears here once its label is printed, and leaves once it is packed."
        />
      )}
    </section>
  );
}

// ── tab 3 ─────────────────────────────────────────────────────────────

function BatchesTab(): ReactElement {
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
        `${r.batchNumber} is on the floor — ${r.transitioned} orders sent to be picked`,
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onAbandon(batchId: string): Promise<boolean> {
    setError(null);
    try {
      await cancel.mutateAsync(batchId);
      toast.success('Batch abandoned — those parcels are back in the picking queue');
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
          `${r.picked} sent to packing; ${r.skipped.length} still need scanning at the pick station`,
        );
      } else {
        toast.success(`${r.batchNumber} picked — ${r.picked} parcels are at the packing bench`);
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
          label="Search batches"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Batch number, order number or AWB"
          aria-label="Search batches"
          icon={<Search size={16} />}
        />
      </div>

      {batches.isLoading ? (
        <SkeletonRows rows={5} cols={7} label="Loading batches…" />
      ) : batches.isError ? (
        <ErrorState
          message={batches.error?.message ?? 'Could not load batches.'}
          retry={() => void batches.refetch()}
        />
      ) : (
        <Table caption="Pick batches">
          <THead>
            <Tr>
              <Th>Batch</Th>
              <Th>Status</Th>
              <Th>Warehouse</Th>
              <Th align="right">Parcels</Th>
              <Th>Created</Th>
              <Th>Printed</Th>
              <Th>Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {(batches.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>
                <div className="wh-empty-cell wh-note">
                  {search.trim() === '' ? 'No batches yet.' : 'Nothing matches that.'}
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
                      <div className="wh-warn sk-figure">{b.printCount} sheets printed</div>
                    )}
                  </Td>
                  <Td>
                    <div className="wh-row">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void reprint(b.id)}
                        disabled={buildList.isPending}
                        aria-label={`Reprint ${b.batchNumber}`}
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
                            aria-label={`Confirm ${b.batchNumber} printed`}
                            icon={<Check size={16} />}
                          >
                            It printed
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
                            aria-label={`Abandon ${b.batchNumber}`}
                            icon={<X size={16} />}
                          >
                            Abandon
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
                          aria-label={`Mark ${b.batchNumber} picked`}
                          icon={<Check size={16} />}
                        >
                          Picked
                        </Button>
                      )}
                      {(skippedByBatch[b.id]?.length ?? 0) > 0 && (
                        <Link href="/warehouse/pick" className="wh-link">
                          Scan {skippedByBatch[b.id]?.length} at the pick station →
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
        title={pendingAct?.kind === 'picked' ? 'Mark this batch picked?' : 'Abandon this batch?'}
        entity={pendingAct?.batchNumber ?? ''}
        entityIsIdentifier
        consequence={
          pendingAct?.kind === 'picked'
            ? `Its ${pendingAct.shipmentCount} parcel(s) are recorded as picked and go to the packing bench; any with serialised units stay behind for the pick station.`
            : `The batch is withdrawn and its ${pendingAct?.shipmentCount ?? 0} parcel(s) go back to the picking queue, unpicked.`
        }
        confirmLabel={pendingAct?.kind === 'picked' ? 'Mark picked' : 'Abandon the batch'}
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
  const entries = Object.entries(skippedByBatch).filter(([, list]) => list.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="wh-callout">
      <p className="wh-callout__lead">
        These parcels carry serialised units, so their units must be scanned one by one before they
        can be packed.{' '}
        <Link href="/warehouse/pick" className="wh-link">
          Open the pick station →
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
            label="Find a product"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Product name, SKU or barcode"
            aria-label="Find a product"
            icon={<Search size={16} />}
          />
        </div>

        {q.trim().length < 2 ? (
          <EmptyState
            bare
            icon={<Search size={22} />}
            title="Where is it?"
            description="Type at least two characters. Every bin holding the product is shown, including returns and quarantine — stock on the returns bench is still where it is."
          />
        ) : results.isLoading ? (
          <SkeletonRows rows={3} cols={3} label="Looking…" />
        ) : results.isError ? (
          <ErrorState
            message={results.error?.message ?? 'Could not search.'}
            retry={() => void results.refetch()}
          />
        ) : (results.data ?? []).length === 0 ? (
          <EmptyState bare title="Nothing matches that." />
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
                        const raw = window.prompt(`How many labels for ${r.skuCode}?`, '1');
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
                      Labels
                    </Button>
                  </div>
                </div>
                {r.locations.length === 0 ? (
                  <div className="wh-note">No stock on hand anywhere.</div>
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
                            <StatusChip kind="pending" label="not sellable" size="sm" />
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
  const history = useSkuLabelHistory();
  return (
    <section className="wh-card wh-stack">
      <SectionHeading
        title="Recently printed stickers"
        note="Every product-label sheet built here or from a goods receipt, newest first."
      />
      {history.isLoading ? (
        <SkeletonRows rows={4} cols={5} label="Loading…" />
      ) : history.isError ? (
        <ErrorState
          message={history.error?.message ?? 'Could not load the sticker history.'}
          retry={() => void history.refetch()}
        />
      ) : (
        <Table caption="Recently printed stickers">
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Stickers</Th>
              <Th>From</Th>
              <Th align="right">Total</Th>
            </Tr>
          </THead>
          <TBody>
            {(history.data ?? []).length === 0 ? (
              <TableEmpty colSpan={5}>
                No stickers printed yet. Print them from a goods receipt, or find a product above
                and choose Labels.
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
  const when = new Date(p.at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const from =
    p.source === 'GOODS_RECEIPT'
      ? `Receipt ${p.receiptNumber ?? ''}`.trim()
      : p.source === 'FIND_A_PRODUCT'
        ? 'Find a product'
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
