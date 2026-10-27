'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Check, ClipboardCheck, PackageX } from 'lucide-react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  useCancelGoodsReceipt,
  useCompleteGoodsReceipt,
  useGoodsReceiptDetail,
  useRecordReceiptLines,
  useSkuLabelsForReceipt,
  useStartReceiving,
  useWarehouseBins,
  type SkuLabelSheet,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { SerialScanner, scanCountMet } from '@/components/ui/serial-scanner';
import { SkuLabelSheetView } from '@/components/sku-label-sheet';
import { buildReceiptLines } from './receive-lines';
import '../../_components/benches.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * Admin receive-station — full goods-receipt lifecycle in one page:
 *
 *   1. PENDING   → "Start receiving" button (admin claims it; status →
 *                  ARRIVING and warehouse staff is stamped)
 *   2. ARRIVING  → per-line received/damaged/bin form → "Record line"
 *                  per line, or "Save all" batch → "Complete"
 *   3. COMPLETED → read-only with stock-written badge
 *
 * A variance no longer blocks. `complete` writes stock for what was
 * actually counted and records the gap on the receipt
 * (`hasDiscrepancies` / `discrepancyNotes`) — see
 * docs/consignment-two-leg.md decision 5. The old DISCREPANCY panel and
 * its resolve endpoint went with the blocking status.
 *
 * Sub-rule (M5/WMS): completing writes stock via StockMutationService
 * (INV-1) under a transaction; partial-failure rolls back so the
 * receipt stays ARRIVING and the operator can retry.
 */
export function ReceiveDetailView({ id }: { readonly id: string }): ReactElement {
  const t = useT();

  const skuLabels = useSkuLabelsForReceipt();
  const [labelSheet, setLabelSheet] = useState<SkuLabelSheet | null>(null);
  const toast = useToast();
  const detail = useGoodsReceiptDetail(id);
  const start = useStartReceiving();
  const record = useRecordReceiptLines();
  const complete = useCompleteGoodsReceipt();
  const cancelReceipt = useCancelGoodsReceipt();
  // Cosmetic only (FE-2) — the server refuses regardless of what shows.
  const mayManage = usePermission('inventory.goods_receipts.manage');
  const [busy, setBusy] = useState<'start' | 'record' | 'complete' | 'cancel' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Per-line input state — keyed by lineId
  const [received, setReceived] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [binByLine, setBinByLine] = useState<Record<string, string>>({});
  // R4 — supplier serials, keyed by GOODS-RECEIPT-LINE id, which is what
  // `serialsByLineId` on the complete call wants.
  const [serialsByLine, setSerialsByLine] = useState<Record<string, readonly string[]>>({});

  const bins = useWarehouseBins(detail.data?.warehouseId ?? '');

  if (detail.isLoading)
    return (
      <div className="wh-page">
        <section className="wh-card">
          <SkeletonRows rows={6} cols={3} label={t('warehouseReceiveReceiveDetailView.loading')} />
        </section>
      </div>
    );
  if (detail.isError)
    return (
      <ErrorState
        message={serverVerdict(detail.error, t('warehouseReceiveReceiveDetailView.failedToLoad'))}
        retry={() => void detail.refetch()}
      />
    );
  if (!detail.data)
    return <ErrorState message={t('warehouseReceiveReceiveDetailView.goodsReceiptNotFound')} />;

  const r = detail.data;
  // The sheet takes over the page while it is open: printing is a
  // whole-screen job, and a label grid squeezed under a form prints the
  // form with it.
  if (labelSheet !== null) {
    return <SkuLabelSheetView sheet={labelSheet} onClose={() => setLabelSheet(null)} />;
  }

  const isPending = r.status === 'PENDING';
  const isArriving = r.status === 'ARRIVING';
  const isCompleted = r.status === 'COMPLETED';
  /** Bins stock can actually be shelved in — never a hold, damaged,
   *  quarantine or transit location. */
  const putawayBins = (bins.data ?? []).filter(
    (b) => b.type === 'STORAGE' || b.type === 'RECEIVING',
  );
  /**
   * Derived, never read from the stored note. Only meaningful once the
   * receipt is COMPLETED — `receivedQty` is 0 on a line nobody has
   * touched, so before that it would report every line as short.
   */
  const variance = isCompleted
    ? r.lines
        .filter((l) => (l.receivedQty ?? 0) !== l.expectedQty || (l.damagedQty ?? 0) > 0)
        .map((l) => ({
          sku: l.variant.skuCode,
          want: l.expectedQty,
          got: l.receivedQty ?? 0,
        }))
    : [];

  async function onStart(): Promise<void> {
    setError(null);
    setBusy('start');
    try {
      await start.mutateAsync({ id });
      toast.success(t('warehouseReceiveReceiveDetailView.startedReceivingRecordEachProduct'));
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRecordAll(): Promise<void> {
    setError(null);
    setBusy('record');
    // Whether a bin is REQUIRED is the server's answer, never ours —
    // `BinPolicyService` is the one reader of the tracking flag (BIN-1)
    // and refuses by name when it matters. See `receive-lines.ts`.
    const built = buildReceiptLines(
      r.lines.map((l) => ({ id: l.id, skuCode: l.variant.skuCode })),
      received,
      damaged,
      binByLine,
    );
    if (!built.ok) {
      setError(built.error);
      setBusy(null);
      return;
    }
    const lines = built.lines;
    try {
      await record.mutateAsync({ id, lines });
      toast.success(t('warehouseReceiveReceiveDetailView.recordedLineS', { length: lines.length }));
      setReceived({});
      setDamaged({});
      setBinByLine({});
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * How many units this line will register — the recorded figure once
   * it exists, otherwise whatever is typed in the box above. It is the
   * ceiling on serials, not a quota: a supplier who does not serialize
   * is normal, and the server prints Skydrop serials for the rest.
   */
  function lineQty(lineId: string, recordedQty: number | null): number {
    if (recordedQty !== null) return recordedQty;
    const typed = Number(received[lineId] ?? '');
    return Number.isFinite(typed) && typed > 0 ? typed : 0;
  }

  const strictLines = r.lines.filter((l) => l.inventoryMode === 'STRICT');
  const serialsOverCount = strictLines.some(
    (l) => !scanCountMet((serialsByLine[l.id] ?? []).length, lineQty(l.id, l.receivedQty), true),
  );

  async function onComplete(): Promise<boolean> {
    setError(null);
    setBusy('complete');
    // Only STRICT lines that actually captured something go in the map —
    // an empty array per line would say "none arrived serialized" as
    // loudly as a scanned one says the opposite.
    const serialsByLineId: Record<string, readonly string[]> = {};
    for (const l of r.lines) {
      if (l.inventoryMode !== 'STRICT') continue;
      const captured = serialsByLine[l.id] ?? [];
      if (captured.length > 0) serialsByLineId[l.id] = captured;
    }
    try {
      const result = await complete.mutateAsync({
        id,
        ...(Object.keys(serialsByLineId).length > 0 ? { serialsByLineId } : {}),
      });
      if (result.status === 'COMPLETED') {
        // A variance no longer withholds the stock (CNS-3), so this is
        // not an error — it is a fact about the count, and the goods are
        // already on the shelf either way.
        if (result.hasDiscrepancies) {
          toast.info(t('warehouseReceiveReceiveDetailView.completedStockWrittenForWhat'));
        } else {
          toast.success(t('warehouseReceiveReceiveDetailView.receiptCompletedStockWritten'));
        }
      } else {
        toast.info(t('warehouseReceiveReceiveDetailView.statusNow', { status: result.status }));
      }
      return true;
    } catch (e) {
      setError(serverVerdict(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onCancel(): Promise<void> {
    setBusy('cancel');
    setError(null);
    try {
      await cancelReceipt.mutateAsync({ id, reason: cancelReason.trim() });
      setCancelOpen(false);
      setCancelReason('');
      toast.info(t('warehouseReceiveReceiveDetailView.receiptCancelledNothingWasWritten'));
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  const recordedCount = r.lines.filter((l) => l.receivedQty !== null).length;

  return (
    <div className="wh-page">
      <PageHeader
        breadcrumbs={[
          { label: t('warehouseReceiveReceiveDetailView.warehouse'), href: '/warehouse' },
          {
            label: t('warehouseReceiveReceiveDetailView.receiveQueue'),
            href: '/warehouse/receive',
          },
          { label: r.receiptNumber },
        ]}
        Link={Link}
        title={<span className="sk-ident">{r.receiptNumber}</span>}
        meta={
          <span className="wh-row">
            <StatusChip kind={isCompleted ? 'delivered' : 'neutral'} label={r.status} />
          </span>
        }
        subtitle={
          <span>
            {t('warehouseReceiveReceiveDetailView.productS', {
              companyName: r.seller.companyName,
              linesLength: r.lines.length,
            })}
            {/*
              Says which consignment this is a leg of, and links back.
              This page is the BENCH — counting happens here; the
              consignment panel is where the journey is steered from.
            */}
            {r.consignment !== null && (
              <>
                {t('warehouseReceiveReceiveDetailView.legOf')}
                <Link
                  href={`/warehouse/consignments/${r.consignment.id}`}
                  className="sk-ident wh-link"
                >
                  {r.consignment.consignmentNumber}
                </Link>
              </>
            )}
          </span>
        }
        action={
          <div className="wh-row">
            {isPending && (
              <Button
                variant="primary"
                size="md"
                disabled={busy !== null}
                onClick={() => void onStart()}
              >
                {busy === 'start'
                  ? t('warehouseReceiveReceiveDetailView.starting')
                  : t('warehouseReceiveReceiveDetailView.startReceiving')}
              </Button>
            )}
            {(isPending || isArriving) && mayManage && (
              <Button
                variant="destructive"
                size="md"
                disabled={busy !== null}
                onClick={() => setCancelOpen(true)}
              >
                {t('warehouseReceiveReceiveDetailView.cancelReceipt')}
              </Button>
            )}
            {/* Labelling happens where the goods are, so the button
                lives with the receipt rather than in the catalogue. It
                appears once counts exist — before that there is no
                quantity to print. */}
            {(isArriving || isCompleted) && (
              <Button
                variant="secondary"
                size="md"
                disabled={skuLabels.isPending}
                onClick={() => {
                  skuLabels.mutate(id, { onSuccess: (sheet) => setLabelSheet(sheet) });
                }}
              >
                {skuLabels.isPending
                  ? t('warehouseReceiveReceiveDetailView.building')
                  : t('warehouseReceiveReceiveDetailView.printProductLabels')}
              </Button>
            )}
            {isArriving && (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busy !== null}
                  onClick={() => void onRecordAll()}
                >
                  {busy === 'record'
                    ? t('warehouseReceiveReceiveDetailView.recording')
                    : t('warehouseReceiveReceiveDetailView.recordAllProducts')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={busy !== null || serialsOverCount}
                  onClick={() => {
                    setError(null);
                    setCompleteOpen(true);
                  }}
                >
                  {busy === 'complete'
                    ? t('warehouseReceiveReceiveDetailView.completing')
                    : t('warehouseReceiveReceiveDetailView.complete')}
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      <section className="wh-card">
        {/* Everything the receipt carries. Somebody at a bench deciding
            whether a carton matches its paperwork should not have to
            open another screen for a field the API already sent. */}
        <dl className="wh-facts">
          <Field
            label={t('warehouseReceiveReceiveDetailView.client')}
            value={r.seller.companyName}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.clientEmail')}
            value={r.seller.email}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.clientRef')}
            value={r.sellerReference ?? '—'}
            ident
          />
          <Field label={t('warehouseReceiveReceiveDetailView.status')} value={r.status} />
          <Field
            label={t('warehouseReceiveReceiveDetailView.expectedArrival')}
            value={r.expectedArrivalAt ? new Date(r.expectedArrivalAt).toLocaleDateString() : '—'}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.warehouse')}
            value={`${r.warehouse.code} — ${r.warehouse.name}`}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.declared')}
            value={new Date(r.createdAt).toLocaleString()}
          />
          {/* `receivedAt` is stamped at completion; the receipt moving
              to ARRIVING is what "started" means, and the staff id
              recorded then is who took it on. */}
          <Field
            label={t('warehouseReceiveReceiveDetailView.receivedBy')}
            value={r.receivedBy?.emailDisplay ?? r.receivedBy?.email ?? '—'}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.receivedAt')}
            value={r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '—'}
          />
          <Field
            label={t('warehouseReceiveReceiveDetailView.discrepancy')}
            value={r.hasDiscrepancies ? 'YES' : 'no'}
          />
          {/*
            Computed from the LINES, which carry the sku. The stored
            `discrepancyNotes` is still shown beneath when it holds
            something the lines cannot say — a transit loss, an
            operator's note — but the per-line variance is derived, so
            it can never go stale the way a stored sentence does.
          */}
          {variance.length > 0 && (
            <Field
              label={t('warehouseReceiveReceiveDetailView.countedDifferently')}
              value={variance
                .map((v) =>
                  t('warehouseReceiveReceiveDetailView.countedAgainstExpected', {
                    sku: v.sku,
                    got: v.got,
                    want: v.want,
                  }),
                )
                .join('; ')}
            />
          )}
          {r.discrepancyNotes && (
            <Field
              label={t('warehouseReceiveReceiveDetailView.notes')}
              value={r.discrepancyNotes}
            />
          )}
        </dl>
      </section>

      <div className="wh-stack">
        <SectionHeading title={t('warehouseReceiveReceiveDetailView.products')} />
        {r.lines.map((line) => (
          <div
            key={line.id}
            className="wh-item"
            data-done={line.receivedQty !== null ? '1' : undefined}
          >
            <div className="wh-item__head">
              <div className="wh-item__who">
                {/* The carton is open on the bench; a photograph settles
                    "is this the right thing" faster than a SKU string. */}
                {line.primaryImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.primaryImageUrl} alt="" className="wh-thumb" />
                ) : (
                  <div className="wh-thumb" aria-hidden />
                )}
                <div className="wh-min0">
                  <div className="wh-item__name">
                    {line.variant.product.name}
                    {line.variant.variantLabel ? (
                      <span className="wh-note"> · {line.variant.variantLabel}</span>
                    ) : null}
                  </div>
                  <div className="wh-item__sub">
                    <span className="sk-ident">{line.variant.skuCode}</span> ·{' '}
                    <span className="sk-figure">
                      {t('warehouseReceiveReceiveDetailView.expected', {
                        expectedQty: line.expectedQty,
                      })}
                    </span>
                    {line.inventoryMode === 'STRICT'
                      ? t('warehouseReceiveReceiveDetailView.perUnitTracked')
                      : ''}
                  </div>
                  <div className="wh-item__facts">
                    <span className="sk-figure">
                      {t('warehouseReceiveReceiveDetailView.unitCost', {
                        value: line.unitCostInr ?? '—',
                      })}
                    </span>
                    <span className="sk-figure">
                      {t('warehouseReceiveReceiveDetailView.damaged', {
                        value: line.damagedQty ?? 0,
                      })}
                    </span>
                    <span className="sk-figure">
                      {t('warehouseReceiveReceiveDetailView.mfg', {
                        value: line.manufacturedAt
                          ? new Date(line.manufacturedAt).toLocaleDateString()
                          : '—',
                      })}
                    </span>
                    <span className="sk-figure">
                      {t('warehouseReceiveReceiveDetailView.exp', {
                        value: line.expiresAt ? new Date(line.expiresAt).toLocaleDateString() : '—',
                      })}
                    </span>
                    {line.batch !== null && (
                      <span>
                        {richMessage(t('warehouseReceiveReceiveDetailView.batch'), {
                          span: <span className="sk-ident">{line.batch.batchCode}</span>,
                        })}
                      </span>
                    )}
                    {line.putawayBin !== null && (
                      <span>
                        {richMessage(t('warehouseReceiveReceiveDetailView.bin'), {
                          span: <span className="sk-ident">{line.putawayBin.code}</span>,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {line.receivedQty !== null && (
                <span className="wh-tag" data-tone="good">
                  {richMessage(t('warehouseReceiveReceiveDetailView.recorded'), {
                    check: <Check size={12} aria-hidden />,
                    span: <span className="sk-figure">{line.receivedQty}</span>,
                  })}
                  {line.damagedQty
                    ? t('warehouseReceiveReceiveDetailView.dmg', { damagedQty: line.damagedQty })
                    : ''}
                </span>
              )}
            </div>

            {isArriving && (
              <div className="wh-fields" data-cols="receive">
                <TextField
                  label={t('warehouseReceiveReceiveDetailView.receivedQty')}
                  type="number"
                  min={0}
                  max={1_000_000}
                  inputMode="numeric"
                  inputClassName="sk-figure"
                  value={received[line.id] ?? String(line.receivedQty ?? '')}
                  onChange={(e) => setReceived({ ...received, [line.id]: e.target.value })}
                />
                <TextField
                  label={t('warehouseReceiveReceiveDetailView.damaged2')}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  inputClassName="sk-figure"
                  value={damaged[line.id] ?? String(line.damagedQty ?? '0')}
                  onChange={(e) => setDamaged({ ...damaged, [line.id]: e.target.value })}
                />
                <div className="wh-stack wh-stack--tight">
                  <Select
                    label={t('warehouseReceiveReceiveDetailView.putawayBin')}
                    value={binByLine[line.id] ?? line.putawayBinId ?? ''}
                    onChange={(e) => setBinByLine({ ...binByLine, [line.id]: e.target.value })}
                  >
                    <option value="">
                      {putawayBins.length === 0
                        ? t('warehouseReceiveReceiveDetailView.thisWarehouseHasNoBin')
                        : t('warehouseReceiveReceiveDetailView.selectBin')}
                    </option>
                    {putawayBins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} ({b.type})
                      </option>
                    ))}
                  </Select>
                  {putawayBins.length === 0 && (
                    // An empty dropdown with no explanation is a dead
                    // end wherever the bin matters: a warehouse that
                    // tracks locations refuses the receipt (BIN_REQUIRED)
                    // and nothing on the screen would say why or what to
                    // do. Shown in either mode — knowing the building has
                    // nowhere to shelve stock is worth saying regardless.
                    <p className="wh-note">
                      {richMessage(t('warehouseReceiveReceiveDetailView.itsOnlyLocationsAreOnes'), {
                        link: (
                          <Link href="/warehouse/bins" className="wh-link">
                            {t('warehouseReceiveReceiveDetailView.addAStorageBin')}
                          </Link>
                        ),
                      })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* R4 — only a STRICT SKU asks. On a NORMAL line there is
                nothing to scan and nothing is shown; an extra field on
                every line is how a receiving bench learns to skip
                fields. */}
            {isArriving && line.inventoryMode === 'STRICT' && (
              <SerialScanner
                id={`receipt-serials-${line.id}`}
                label={t('warehouseReceiveReceiveDetailView.supplierSerialsFor', {
                  skuCode: line.variant.skuCode,
                })}
                required={lineQty(line.id, line.receivedQty)}
                serials={serialsByLine[line.id] ?? []}
                onChange={(next) => setSerialsByLine({ ...serialsByLine, [line.id]: next })}
                hint={t('warehouseReceiveReceiveDetailView.scanWhatTheSupplierPrinted')}
              />
            )}
          </div>
        ))}
      </div>

      {isCompleted && (
        <div className="wh-done-line">
          <Check size={16} aria-hidden />{' '}
          {t('warehouseReceiveReceiveDetailView.stockWrittenThisReceiptIs')}
        </div>
      )}

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title={t('warehouseReceiveReceiveDetailView.completeThisReceiptAndWrite')}
        entity={r.receiptNumber}
        entityIsIdentifier
        consequence={t('warehouseReceiveReceiveDetailView.stockIsWrittenForWhat', {
          companyName: r.seller.companyName,
        })}
        confirmLabel={t('warehouseReceiveReceiveDetailView.completeAndWriteStock')}
        error={error}
        onConfirm={async () => {
          const ok = await onComplete();
          if (!ok) throw new Error('refused');
        }}
      >
        <p className="wh-note">
          {richMessage(t('warehouseReceiveReceiveDetailView.ofProductSHaveA'), {
            clipboardCheck: <ClipboardCheck size={14} aria-hidden className="wh-inline-icon" />,
            span: <span className="sk-figure">{recordedCount}</span>,
            span2: <span className="sk-figure">{r.lines.length}</span>,
            code: r.warehouse.code,
          })}
        </p>
      </ConfirmDialog>

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="critical"
        icon={<PackageX size={18} />}
        title={t('warehouseReceiveReceiveDetailView.cancel', { receiptNumber: r.receiptNumber })}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setCancelOpen(false)}>
              {t('warehouseReceiveReceiveDetailView.keepIt')}
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={busy !== null || cancelReason.trim().length < 10}
              onClick={() => void onCancel()}
            >
              {busy === 'cancel'
                ? t('warehouseReceiveReceiveDetailView.cancelling')
                : t('warehouseReceiveReceiveDetailView.cancelReceipt')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="wh-stack">
          <p className="wh-note">
            {t('warehouseReceiveReceiveDetailView.nothingHasBeenWrittenTo')}
          </p>
          <TextField
            label={t('warehouseReceiveReceiveDetailView.why')}
            requiredMark
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('warehouseReceiveReceiveDetailView.atLeast10CharactersRecorded')}
          />
        </div>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  ident = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly ident?: boolean;
}): ReactElement {
  return (
    <div className="wh-fact">
      <dt>{label}</dt>
      <dd className={ident ? 'sk-ident' : undefined}>{value}</dd>
    </div>
  );
}
