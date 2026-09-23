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
import type { RecordReceiptLineInput } from '@skydrop/api-client';
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
import '../../_components/benches.css';

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
          <SkeletonRows rows={6} cols={3} label="Loading…" />
        </section>
      </div>
    );
  if (detail.isError)
    return (
      <ErrorState
        message={serverVerdict(detail.error, 'Failed to load.')}
        retry={() => void detail.refetch()}
      />
    );
  if (!detail.data) return <ErrorState message="Goods receipt not found." />;

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
      toast.success('Started receiving — record each product below.');
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  async function onRecordAll(): Promise<void> {
    setError(null);
    setBusy('record');
    const lines: RecordReceiptLineInput[] = [];
    for (const l of r.lines) {
      const recv = received[l.id]?.trim() ?? '';
      const dmg = damaged[l.id]?.trim() ?? '0';
      const bin = binByLine[l.id]?.trim() ?? '';
      if (recv === '') continue;
      const n = Number(recv);
      if (!Number.isFinite(n) || n < 0) {
        setError(`Invalid received qty on line ${l.variant.skuCode}`);
        setBusy(null);
        return;
      }
      const d = Number(dmg);
      if (!Number.isFinite(d) || d < 0) {
        setError(`Invalid damaged qty on line ${l.variant.skuCode}`);
        setBusy(null);
        return;
      }
      if (n > 0 && !bin) {
        setError(`Bin required for ${l.variant.skuCode} (qty > 0)`);
        setBusy(null);
        return;
      }
      lines.push({
        lineId: l.id,
        receivedQty: n,
        damagedQty: d,
        ...(bin ? { putawayBinId: bin } : {}),
      });
    }
    if (lines.length === 0) {
      setError('Nothing to record — fill in at least one line.');
      setBusy(null);
      return;
    }
    try {
      await record.mutateAsync({ id, lines });
      toast.success(`Recorded ${lines.length} line(s).`);
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
          toast.info('Completed — stock written for what arrived, and the difference recorded.');
        } else {
          toast.success('Receipt completed — stock written.');
        }
      } else {
        toast.info(`Status now ${result.status}.`);
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
      toast.info('Receipt cancelled. Nothing was written to stock.');
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
          { label: 'Warehouse', href: '/warehouse' },
          { label: 'Receive queue', href: '/warehouse/receive' },
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
            {r.seller.companyName} · {r.lines.length} product(s)
            {/*
              Says which consignment this is a leg of, and links back.
              This page is the BENCH — counting happens here; the
              consignment panel is where the journey is steered from.
            */}
            {r.consignment !== null && (
              <>
                {' · leg of '}
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
                {busy === 'start' ? 'Starting…' : 'Start receiving'}
              </Button>
            )}
            {(isPending || isArriving) && mayManage && (
              <Button
                variant="destructive"
                size="md"
                disabled={busy !== null}
                onClick={() => setCancelOpen(true)}
              >
                Cancel receipt
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
                {skuLabels.isPending ? 'Building…' : 'Print product labels'}
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
                  {busy === 'record' ? 'Recording…' : 'Record all products'}
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
                  {busy === 'complete' ? 'Completing…' : 'Complete'}
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
          <Field label="Seller" value={r.seller.companyName} />
          <Field label="Seller email" value={r.seller.email} />
          <Field label="Seller ref" value={r.sellerReference ?? '—'} ident />
          <Field label="Status" value={r.status} />
          <Field
            label="Expected arrival"
            value={r.expectedArrivalAt ? new Date(r.expectedArrivalAt).toLocaleDateString() : '—'}
          />
          <Field label="Warehouse" value={`${r.warehouse.code} — ${r.warehouse.name}`} />
          <Field label="Declared" value={new Date(r.createdAt).toLocaleString()} />
          {/* `receivedAt` is stamped at completion; the receipt moving
              to ARRIVING is what "started" means, and the staff id
              recorded then is who took it on. */}
          <Field
            label="Received by"
            value={r.receivedBy?.emailDisplay ?? r.receivedBy?.email ?? '—'}
          />
          <Field
            label="Received at"
            value={r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '—'}
          />
          <Field label="Discrepancy" value={r.hasDiscrepancies ? 'YES' : 'no'} />
          {/*
            Computed from the LINES, which carry the sku. The stored
            `discrepancyNotes` is still shown beneath when it holds
            something the lines cannot say — a transit loss, an
            operator's note — but the per-line variance is derived, so
            it can never go stale the way a stored sentence does.
          */}
          {variance.length > 0 && (
            <Field
              label="Counted differently"
              value={variance
                .map((v) => `${v.sku}: counted ${v.got} against ${v.want} expected`)
                .join('; ')}
            />
          )}
          {r.discrepancyNotes && <Field label="Notes" value={r.discrepancyNotes} />}
        </dl>
      </section>

      <div className="wh-stack">
        <SectionHeading title="Products" />
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
                    <span className="sk-figure">expected {line.expectedQty}</span>
                    {line.inventoryMode === 'STRICT' ? ' · per-unit tracked' : ''}
                  </div>
                  <div className="wh-item__facts">
                    <span className="sk-figure">Unit cost {line.unitCostInr ?? '—'}</span>
                    <span className="sk-figure">Damaged {line.damagedQty ?? 0}</span>
                    <span className="sk-figure">
                      Mfg{' '}
                      {line.manufacturedAt
                        ? new Date(line.manufacturedAt).toLocaleDateString()
                        : '—'}
                    </span>
                    <span className="sk-figure">
                      Exp {line.expiresAt ? new Date(line.expiresAt).toLocaleDateString() : '—'}
                    </span>
                    {line.batch !== null && (
                      <span>
                        batch <span className="sk-ident">{line.batch.batchCode}</span>
                      </span>
                    )}
                    {line.putawayBin !== null && (
                      <span>
                        bin <span className="sk-ident">{line.putawayBin.code}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {line.receivedQty !== null && (
                <span className="wh-tag" data-tone="good">
                  <Check size={12} aria-hidden /> recorded:{' '}
                  <span className="sk-figure">{line.receivedQty}</span>
                  {line.damagedQty ? ` (${line.damagedQty} dmg)` : ''}
                </span>
              )}
            </div>

            {isArriving && (
              <div className="wh-fields" data-cols="receive">
                <TextField
                  label="Received qty"
                  type="number"
                  min={0}
                  max={1_000_000}
                  inputMode="numeric"
                  inputClassName="sk-figure"
                  value={received[line.id] ?? String(line.receivedQty ?? '')}
                  onChange={(e) => setReceived({ ...received, [line.id]: e.target.value })}
                />
                <TextField
                  label="Damaged"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  inputClassName="sk-figure"
                  value={damaged[line.id] ?? String(line.damagedQty ?? '0')}
                  onChange={(e) => setDamaged({ ...damaged, [line.id]: e.target.value })}
                />
                <div className="wh-stack wh-stack--tight">
                  <Select
                    label="Putaway bin"
                    value={binByLine[line.id] ?? line.putawayBinId ?? ''}
                    onChange={(e) => setBinByLine({ ...binByLine, [line.id]: e.target.value })}
                  >
                    <option value="">
                      {putawayBins.length === 0
                        ? '— this warehouse has no bin to put stock in —'
                        : '— select bin —'}
                    </option>
                    {putawayBins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} ({b.type})
                      </option>
                    ))}
                  </Select>
                  {putawayBins.length === 0 && (
                    // An empty REQUIRED dropdown with no explanation is a
                    // dead end: the operator cannot complete the receipt
                    // and nothing on the screen says why or what to do.
                    <p className="wh-note">
                      Its only locations are ones stock cannot be shelved in.{' '}
                      <Link href="/warehouse/bins" className="wh-link">
                        Add a storage bin
                      </Link>{' '}
                      and reload.
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
                label={`Supplier serials for ${line.variant.skuCode}`}
                required={lineQty(line.id, line.receivedQty)}
                serials={serialsByLine[line.id] ?? []}
                onChange={(next) => setSerialsByLine({ ...serialsByLine, [line.id]: next })}
                hint="Scan what the supplier printed. Skip any they did not serialize — Skydrop prints a serial for each of those at completion."
              />
            )}
          </div>
        ))}
      </div>

      {isCompleted && (
        <div className="wh-done-line">
          <Check size={16} aria-hidden /> Stock written. This receipt is now history.
        </div>
      )}

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Complete this receipt and write stock?"
        entity={r.receiptNumber}
        entityIsIdentifier
        consequence={`Stock is written for what was counted on each of ${r.seller.companyName}'s products and the receipt closes. It cannot be cancelled afterwards — a mistake is corrected with a stock adjustment.`}
        confirmLabel="Complete and write stock"
        error={error}
        onConfirm={async () => {
          const ok = await onComplete();
          if (!ok) throw new Error('refused');
        }}
      >
        <p className="wh-note">
          <ClipboardCheck size={14} aria-hidden className="wh-inline-icon" />{' '}
          <span className="sk-figure">{recordedCount}</span> of{' '}
          <span className="sk-figure">{r.lines.length}</span> product(s) have a recorded count at{' '}
          {r.warehouse.code}. A variance does not block — it is recorded on the receipt.
        </p>
      </ConfirmDialog>

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="critical"
        icon={<PackageX size={18} />}
        title={`Cancel ${r.receiptNumber}?`}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={busy !== null || cancelReason.trim().length < 10}
              onClick={() => void onCancel()}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel receipt'}
            </Button>
          </DialogFooter>
        }
      >
        <div className="wh-stack">
          <p className="wh-note">
            Nothing has been written to stock yet, so nothing is removed — the receipt simply leaves
            the queue. A receipt that has already been completed cannot be cancelled; correct that
            with a stock adjustment, where the movement is visible.
          </p>
          <TextField
            label="Why"
            requiredMark
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="At least 10 characters — recorded on the receipt"
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
