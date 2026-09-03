'use client';

import { useState, type ReactElement } from 'react';
import { Check, Download, Printer, Search } from 'lucide-react';
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
  useMarkBatchPicked,
  usePickBatches,
  usePickPrintQueue,
  useProductLocations,
  type LabelSheetResult,
  type PickListResult,
} from '@/lib/ops-hooks';
import { useSkuLabelsForVariants, type SkuLabelSheet } from '@/lib/api-hooks';
import { SkuLabelSheetView } from '@/components/sku-label-sheet';
import { serverVerdict } from '@/lib/server-verdict';
import { downloadPdf, printPdf } from '@/lib/print-pdf';
import { SelectionTable } from './selection-table';

type Tab = 'labels' | 'picking' | 'batches' | 'locate';

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

// ── tab 3 ─────────────────────────────────────────────────────────────

function BatchesTab(): ReactElement {
  const [search, setSearch] = useState('');
  const batches = usePickBatches(search);
  const buildList = useBuildPickList();
  const markPicked = useMarkBatchPicked();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function onPicked(batchId: string): Promise<void> {
    setError(null);
    try {
      const r = await markPicked.mutateAsync(batchId);
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
  );
}
