'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Check, Download, Printer, Search, X } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Section,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Toolbar,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
    <Section>
      <PageHeader
        title="Printing"
        subtitle="Labels first, then the picking sheet. Nothing moves until somebody confirms the paper came out."
      />

      <Toolbar>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['labels', 'Shipping labels'],
              ['reprint', 'Reprint a label'],
              ['picking', 'Picking list'],
              ['batches', 'Past batches'],
              ['locate', 'Find a product'],
            ] as ReadonlyArray<[Tab, string]>
          ).map(([key, label]) => (
            <Button
              key={key}
              variant={tab === key ? 'primary' : 'ghost'}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Toolbar>

      {tab === 'labels' && <LabelTab />}
      {tab === 'reprint' && <ReprintTab />}
      {tab === 'picking' && <PickingTab />}
      {tab === 'batches' && <BatchesTab />}
      {tab === 'locate' && <LocateTab />}
    </Section>
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
    <Card>
      <CardBody>
        {error !== null && <ErrorNote message={error} />}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-text-muted">
            {selected.size === 0
              ? `${rows.length} parcel${rows.length === 1 ? '' : 's'} waiting on a label`
              : `${selected.size} selected`}
          </div>
          <Button
            onClick={() => void onBuild()}
            disabled={selected.size === 0 || build.isPending}
            aria-busy={build.isPending}
          >
            <Printer size={14} /> {build.isPending ? 'Building…' : 'Print labels'}
          </Button>
        </div>

        {queue.isLoading ? (
          <LoadingState label="Loading the label queue…" />
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
      </CardBody>

      <Modal
        open={sheet !== null}
        onOpenChange={(o) => {
          if (!o) setSheet(null);
        }}
        title="Did the labels print?"
      >
        {sheet !== null && (
          <div className="space-y-3 text-sm">
            <p>
              {sheet.shipmentCount} label{sheet.shipmentCount === 1 ? '' : 's'} across{' '}
              {sheet.pageCount} page{sheet.pageCount === 1 ? '' : 's'}.
            </p>
            {/* Named, never dropped: a short stack looks identical to a
                complete one once it is on the bench. */}
            {sheet.failed.length > 0 && (
              <div className="rounded border border-status-failed-border bg-status-failed-bg p-2">
                <div className="font-medium">
                  {sheet.failed.length} could not be printed and are NOT in this file
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {sheet.failed.map((f) => (
                    <li key={f.shipmentId}>
                      {f.shipmentNumber} — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-text-muted">
              Confirming marks these parcels as labelled and moves them to the picking tab. Only
              confirm what is actually on paper in front of you.
            </p>
            <Button variant="ghost" onClick={() => downloadPdf(sheet.pdfBase64, sheet.fileName)}>
              <Download size={14} /> Download instead
            </Button>
          </div>
        )}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setSheet(null)}>
            Not yet
          </Button>
          <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
            Yes, they printed
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
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

  async function onAbandon(): Promise<void> {
    if (list === null) return;
    try {
      await cancel.mutateAsync(list.batchId);
      toast.success('Batch abandoned — those parcels are back in the queue');
      setList(null);
      setSelected(new Set());
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  const busy = createBatch.isPending || buildList.isPending;

  return (
    <Card>
      <CardBody>
        {error !== null && <ErrorNote message={error} />}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-text-muted">
            {selected.size === 0
              ? `${rows.length} labelled parcel${rows.length === 1 ? '' : 's'} ready to pick`
              : `${selected.size} selected`}
          </div>
          <Button
            onClick={() => void onBuild()}
            disabled={selected.size === 0 || busy}
            aria-busy={busy}
          >
            <Printer size={14} /> {busy ? 'Building…' : 'Print picking list'}
          </Button>
        </div>

        {queue.isLoading ? (
          <LoadingState label="Loading the picking queue…" />
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
      </CardBody>

      <Modal
        open={list !== null}
        onOpenChange={(o) => {
          if (!o) setList(null);
        }}
        title="Did the picking list print?"
      >
        {list !== null && (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-mono">{list.batchNumber}</span> — {list.lineCount} line
              {list.lineCount === 1 ? '' : 's'} to walk.
            </p>
            {list.strictMode && (
              <p className="text-text-muted">
                Strict mode: the sheet shows no SKU barcodes. Each unit is scanned by its own serial
                at the packing table.
              </p>
            )}
            {list.shortfalls.length > 0 && (
              <div className="rounded border border-status-failed-border bg-status-failed-bg p-2">
                <div className="font-medium">
                  {list.shortfalls.length} line{list.shortfalls.length === 1 ? '' : 's'} could not
                  be allocated
                </div>
                <div className="mt-1 text-xs">
                  They are on the sheet marked NOT ALLOCATED. The rest of the batch is still
                  walkable; bring those back to a supervisor.
                </div>
              </div>
            )}
            <p className="text-text-muted">
              Confirming sends these orders to be picked and then packed.
            </p>
            <Button variant="ghost" onClick={() => downloadPdf(list.pdfBase64, list.fileName)}>
              <Download size={14} /> Download instead
            </Button>
          </div>
        )}
        <ModalFooter>
          {/* An abandoned batch has to release its parcels, or they sit
              claimed by a walk nobody is doing. */}
          <Button variant="ghost" onClick={() => void onAbandon()} disabled={cancel.isPending}>
            Abandon this batch
          </Button>
          <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
            Yes, it printed
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
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
    <Card>
      <CardBody>
        {error !== null && <ErrorNote message={error} />}

        <p className="mb-3 text-xs text-text-muted">
          Parcels whose label is printed but which have not been packed. A packed parcel is not here
          on purpose — a second label on a sealed box is how two parcels come to carry one waybill.
        </p>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="reprint-reason" className="mb-1 block text-xs text-text-muted">
              Why is it being reprinted?
            </label>
            <Input
              id="reprint-reason"
              value={reason}
              placeholder="e.g. label torn off the carton in the aisle"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            onClick={() => void onReprint()}
            disabled={selected.size === 0 || reason.trim().length < 10 || reprint.isPending}
          >
            <Printer size={14} />{' '}
            {reprint.isPending
              ? 'Building…'
              : `Reprint ${selected.size === 0 ? '' : selected.size}`}
          </Button>
        </div>

        {queue.isLoading ? (
          <LoadingState label="Loading printed parcels…" />
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
      </CardBody>
    </Card>
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

  async function onAbandon(batchId: string): Promise<void> {
    setError(null);
    try {
      await cancel.mutateAsync(batchId);
      toast.success('Batch abandoned — those parcels are back in the picking queue');
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onPicked(batchId: string): Promise<void> {
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
    } catch (e) {
      setError(serverVerdict(e));
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
    <Card>
      <CardBody>
        {error !== null && <ErrorNote message={error} />}
        <SkippedNotice skippedByBatch={skippedByBatch} batches={batches.data ?? []} />
        <div className="mb-3 max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Batch number, order number or AWB"
            aria-label="Search batches"
          />
        </div>

        {batches.isLoading ? (
          <LoadingState label="Loading batches…" />
        ) : batches.isError ? (
          <ErrorState
            message={batches.error?.message ?? 'Could not load batches.'}
            retry={() => void batches.refetch()}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Batch</Th>
                <Th>Status</Th>
                <Th>Warehouse</Th>
                <Th>Parcels</Th>
                <Th>Created</Th>
                <Th>Printed</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {(batches.data ?? []).length === 0 ? (
                <TableEmpty colSpan={7}>
                  <div className="py-2 text-center text-xs text-text-muted">
                    {search.trim() === '' ? 'No batches yet.' : 'Nothing matches that.'}
                  </div>
                </TableEmpty>
              ) : (
                (batches.data ?? []).map((b) => (
                  <Tr key={b.id}>
                    <Td>
                      <span className="font-mono">{b.batchNumber}</span>
                    </Td>
                    <Td>
                      <StatusBadge
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
                      />
                    </Td>
                    <Td>{b.warehouseName}</Td>
                    <Td className="tabular-nums">{b.shipmentCount}</Td>
                    <Td>
                      <div className="text-xs">
                        {new Date(b.createdAtIso).toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-text-muted">{b.createdByName ?? '—'}</div>
                    </Td>
                    <Td>
                      {b.printedAtIso === null ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <>
                          <div className="text-xs">
                            {new Date(b.printedAtIso).toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-text-muted">{b.printedByName ?? '—'}</div>
                        </>
                      )}
                      {/* How many sheets exist, which is a different
                          question from when the first one was confirmed:
                          two copies of a walk in the building is the
                          thing worth noticing. */}
                      {b.printCount > 1 && (
                        <div className="text-status-pending-fg text-xs tabular-nums">
                          {b.printCount} sheets printed
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          onClick={() => void reprint(b.id)}
                          disabled={buildList.isPending}
                          aria-label={`Reprint ${b.batchNumber}`}
                        >
                          <Printer size={14} />
                        </Button>
                        {/* A draft has exactly two ways out, and the
                            sheet is already reprintable beside them. */}
                        {b.status === 'DRAFT' && (
                          <>
                            <Button
                              variant="ghost"
                              onClick={() => void onConfirmPrinted(b.id)}
                              disabled={confirm.isPending}
                              aria-label={`Confirm ${b.batchNumber} printed`}
                            >
                              <Check size={14} /> It printed
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => void onAbandon(b.id)}
                              disabled={cancel.isPending}
                              aria-label={`Abandon ${b.batchNumber}`}
                            >
                              <X size={14} /> Abandon
                            </Button>
                          </>
                        )}
                        {/* Only a printed batch can be walked, so only a
                            printed batch can come back from one. */}
                        {b.status === 'PRINTED' && (
                          <Button
                            variant="ghost"
                            onClick={() => void onPicked(b.id)}
                            disabled={markPicked.isPending}
                            aria-label={`Mark ${b.batchNumber} picked`}
                          >
                            <Check size={14} /> Picked
                          </Button>
                        )}
                        {(skippedByBatch[b.id]?.length ?? 0) > 0 && (
                          <Link
                            href="/warehouse/pick"
                            className="text-accent hover:text-accent-hover text-xs whitespace-nowrap"
                          >
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
      </CardBody>
    </Card>
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
    <div className="border-[var(--status-pending-ring)] bg-[var(--status-pending-bg)] mb-3 rounded-[5px] border px-3 py-2 text-sm">
      <p className="text-text-body">
        These parcels carry serialised units, so their units must be scanned one by one before they
        can be packed.{' '}
        <Link href="/warehouse/pick" className="text-accent hover:text-accent-hover font-medium">
          Open the pick station →
        </Link>
      </p>
      <ul className="text-text-muted mt-1 space-y-0.5 text-xs">
        {entries.map(([batchId, list]) =>
          list.map((s) => (
            <li key={`${batchId}:${s.shipmentNumber}`}>
              <span className="font-mono">{s.shipmentNumber}</span>
              {' · '}
              {batches.find((b) => b.id === batchId)?.batchNumber ?? 'batch'} · {s.reason}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

// ── tab 4 ─────────────────────────────────────────────────────────────

function LocateTab(): ReactElement {
  const [q, setQ] = useState('');
  const results = useProductLocations(q);
  const reprint = useSkuLabelsForVariants();
  const [reprintSheet, setReprintSheet] = useState<SkuLabelSheet | null>(null);

  if (reprintSheet !== null) {
    return <SkuLabelSheetView sheet={reprintSheet} onClose={() => setReprintSheet(null)} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="mb-3 max-w-sm">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Product name, SKU or barcode"
              aria-label="Find a product"
            />
          </div>

          {q.trim().length < 2 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <Search size={20} className="text-text-muted" />
              <div className="text-sm font-medium">Where is it?</div>
              <div className="max-w-sm text-xs text-text-muted">
                Type at least two characters. Every bin holding the product is shown, including
                returns and quarantine — stock on the returns bench is still where it is.
              </div>
            </div>
          ) : results.isLoading ? (
            <LoadingState label="Looking…" />
          ) : results.isError ? (
            <ErrorState
              message={results.error?.message ?? 'Could not search.'}
              retry={() => void results.refetch()}
            />
          ) : (results.data ?? []).length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">Nothing matches that.</div>
          ) : (
            <div className="space-y-3">
              {(results.data ?? []).map((r) => (
                <div key={r.variantId} className="rounded border border-border-subtle p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium">{r.productName}</span>
                      {r.variantLabel !== null && (
                        <span className="text-text-muted"> — {r.variantLabel}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-xs text-text-muted">
                        {r.skuCode}
                        {r.barcode !== null && ` · ${r.barcode}`}
                      </div>
                      {/* The sticker that fell off. Quantity is asked for
                        rather than assumed: you are replacing what came
                        off, not relabelling the shelf. */}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={reprint.isPending}
                        onClick={() => {
                          const raw = window.prompt(`How many labels for ${r.skuCode}?`, '1');
                          if (raw === null) return;
                          const quantity = Number.parseInt(raw, 10);
                          if (!Number.isFinite(quantity) || quantity < 1) return;
                          reprint.mutate([{ variantId: r.variantId, quantity }], {
                            onSuccess: (sheet) => setReprintSheet(sheet),
                          });
                        }}
                      >
                        Labels
                      </Button>
                    </div>
                  </div>
                  {r.locations.length === 0 ? (
                    <div className="mt-2 text-xs text-text-muted">No stock on hand anywhere.</div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.locations.map((loc, i) => (
                        <div
                          key={`${loc.warehouseName}-${loc.binCode}-${i}`}
                          className="rounded border border-border-subtle px-2 py-1"
                        >
                          <div className="font-mono text-sm font-medium">{loc.binCode}</div>
                          <div className="text-xs text-text-muted">
                            {loc.warehouseName}
                            {loc.zoneName !== null && ` · ${loc.zoneName}`}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="text-sm tabular-nums">{loc.qtyOnHand}</span>
                            {!loc.pickable && <StatusBadge kind="pending" label="not sellable" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
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
    <Card>
      <CardBody>
        <div className="mb-3">
          <div className="text-sm font-medium">Recently printed stickers</div>
          <div className="text-xs text-text-muted">
            Every product-label sheet built here or from a goods receipt, newest first.
          </div>
        </div>
        {history.isLoading ? (
          <LoadingState label="Loading…" />
        ) : history.isError ? (
          <ErrorState
            message={history.error?.message ?? 'Could not load the sticker history.'}
            retry={() => void history.refetch()}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Stickers</Th>
                <Th>From</Th>
                <Th className="text-right">Total</Th>
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
      </CardBody>
    </Card>
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
      <Td className="whitespace-nowrap tabular-nums">{when}</Td>
      <Td>{p.by ?? '—'}</Td>
      <Td>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
          {p.lines.map((l) => (
            <span key={l.skuCode}>
              {l.skuCode} × {l.quantity}
            </span>
          ))}
        </div>
      </Td>
      <Td>{from}</Td>
      <Td className="text-right tabular-nums">{p.totalStickers}</Td>
    </Tr>
  );
}
