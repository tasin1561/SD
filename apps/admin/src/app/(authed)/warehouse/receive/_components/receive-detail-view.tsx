'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Select,
  useToast,
} from '@skydrop/ui/components';
import type { RecordReceiptLineInput } from '@skydrop/api-client';
import {
  useCompleteGoodsReceipt,
  useResolveDiscrepancy,
  useGoodsReceiptDetail,
  useRecordReceiptLines,
  useStartReceiving,
  useWarehouseBins,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SerialScanner, scanCountMet } from '@/components/ui/serial-scanner';

/**
 * Admin receive-station — full goods-receipt lifecycle in one page:
 *
 *   1. PENDING   → "Start receiving" button (admin claims it; status →
 *                  ARRIVING and warehouse staff is stamped)
 *   2. ARRIVING  → per-line received/damaged/bin form → "Record line"
 *                  per line, or "Save all" batch → "Complete"
 *   3. COMPLETED → read-only with stock-written badge
 *   4. DISCREPANCY → accept the shortage with a mandatory note, which
 *                    writes stock for what actually arrived. Without it a
 *                    short consignment was a dead end: goods on the floor
 *                    the system would never admit had arrived.
 *
 * Sub-rule (M5/WMS): completing writes stock via StockMutationService
 * (INV-1) under a transaction; partial-failure rolls back so the
 * receipt stays ARRIVING and the operator can retry.
 */
export function ReceiveDetailView({ id }: { readonly id: string }): ReactElement {
  const toast = useToast();
  const detail = useGoodsReceiptDetail(id);
  const start = useStartReceiving();
  const record = useRecordReceiptLines();
  const complete = useCompleteGoodsReceipt();
  const resolve = useResolveDiscrepancy();
  const [busy, setBusy] = useState<'start' | 'record' | 'complete' | 'resolve' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-line input state — keyed by lineId
  const [received, setReceived] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [binByLine, setBinByLine] = useState<Record<string, string>>({});
  const [forceNote, setForceNote] = useState('');
  // R4 — supplier serials, keyed by GOODS-RECEIPT-LINE id, which is what
  // `serialsByLineId` on the complete call wants.
  const [serialsByLine, setSerialsByLine] = useState<Record<string, readonly string[]>>({});

  const bins = useWarehouseBins(detail.data?.warehouseId ?? '');

  if (detail.isLoading) return <LoadingState label="Loading…" />;
  if (detail.isError) return <ErrorState message={detail.error?.message ?? 'Failed to load.'} />;
  if (!detail.data) return <ErrorState message="Goods receipt not found." />;

  const r = detail.data;
  const isPending = r.status === 'PENDING';
  const isArriving = r.status === 'ARRIVING';
  const isCompleted = r.status === 'COMPLETED';
  const isDiscrepancy = r.status === 'DISCREPANCY';

  async function onForceComplete(): Promise<void> {
    setError(null);
    setBusy('resolve');
    try {
      // FORCE_COMPLETE writes stock for the actuals recorded and keeps
      // the note on the receipt. CORRECT is the other mode the endpoint
      // takes; an operator who miscounted re-records the lines above and
      // completes normally rather than resolving.
      await resolve.mutateAsync({ id, mode: 'FORCE_COMPLETE', note: forceNote.trim() });
      toast.success('Completed — stock written for what actually arrived.');
      setForceNote('');
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  async function onStart(): Promise<void> {
    setError(null);
    setBusy('start');
    try {
      await start.mutateAsync({ id });
      toast.success('Started receiving — record each line below.');
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

  async function onComplete(): Promise<void> {
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
        toast.success('Receipt completed — stock written.');
      } else if (result.status === 'DISCREPANCY') {
        toast.error('Marked as DISCREPANCY — expected/received qty mismatch.');
      } else {
        toast.info(`Status now ${result.status}.`);
      }
    } catch (e) {
      setError(serverVerdict(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Link
        href="/warehouse/receive"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Receive queue
      </Link>

      <PageHeader
        title={<span className="font-mono">{r.receiptNumber}</span>}
        subtitle={
          <span>
            {r.seller.companyName} · {r.lines.length} line(s) ·{' '}
            <span className="uppercase tracking-wide">{r.status}</span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
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
            {isArriving && (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busy !== null}
                  onClick={() => void onRecordAll()}
                >
                  {busy === 'record' ? 'Recording…' : 'Record all lines'}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={busy !== null || serialsOverCount}
                  onClick={() => void onComplete()}
                >
                  {busy === 'complete' ? 'Completing…' : 'Complete'}
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px] mb-3">
          {error}
        </div>
      )}

      <Card>
        <CardBody>
          {/* Everything the receipt carries. Somebody at a bench deciding
              whether a carton matches its paperwork should not have to
              open another screen for a field the API already sent. */}
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <Field label="Seller" value={r.seller.companyName} />
            <Field label="Seller email" value={r.seller.email} />
            <Field label="Seller ref" value={r.sellerReference ?? '—'} />
            <Field label="Status" value={r.status} />
            <Field
              label="Expected arrival"
              value={r.expectedArrivalAt ? new Date(r.expectedArrivalAt).toLocaleDateString() : '—'}
            />
            <Field label="Warehouse" value={r.warehouseId} />
            <Field label="Declared" value={new Date(r.createdAt).toLocaleString()} />
            {/* `receivedAt` is stamped at completion; the receipt moving
                to ARRIVING is what "started" means, and the staff id
                recorded then is who took it on. */}
            <Field label="Received by" value={r.receivedById ?? '—'} />
            <Field
              label="Received at"
              value={r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '—'}
            />
            <Field label="Discrepancy" value={r.hasDiscrepancies ? 'YES' : 'no'} />
            {r.discrepancyNotes && <Field label="Discrepancy notes" value={r.discrepancyNotes} />}
          </div>
        </CardBody>
      </Card>

      <h2 className="text-text-bright text-sm font-medium mt-5 mb-2">Lines</h2>

      <div className="space-y-2">
        {r.lines.map((line) => (
          <div
            key={line.id}
            className={
              'p-3 rounded-[6px] border ' +
              (line.receivedQty !== null
                ? 'border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)]'
                : 'border-border')
            }
          >
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-start gap-3">
                {/* The carton is open on the bench; a photograph settles
                    "is this the right thing" faster than a SKU string. */}
                {line.primaryImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line.primaryImageUrl}
                    alt=""
                    className="border-border h-12 w-12 shrink-0 rounded-[4px] border object-cover"
                  />
                ) : (
                  <div
                    className="border-border bg-surface-raised h-12 w-12 shrink-0 rounded-[4px] border"
                    aria-hidden
                  />
                )}
                <div>
                  <div className="text-text-bright text-sm">
                    {line.variant.product.name}
                    {line.variant.variantLabel ? (
                      <span className="text-text-muted"> · {line.variant.variantLabel}</span>
                    ) : null}
                  </div>
                  <div className="text-text-faint text-xs mt-0.5 font-mono">
                    {line.variant.skuCode} · expected {line.expectedQty}
                    {line.inventoryMode === 'STRICT' ? ' · per-unit tracked' : ''}
                  </div>
                  <div className="text-text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <span>Unit cost {line.unitCostInr ?? '—'}</span>
                    <span>Damaged {line.damagedQty ?? 0}</span>
                    <span>
                      Mfg{' '}
                      {line.manufacturedAt
                        ? new Date(line.manufacturedAt).toLocaleDateString()
                        : '—'}
                    </span>
                    <span>
                      Exp {line.expiresAt ? new Date(line.expiresAt).toLocaleDateString() : '—'}
                    </span>
                    {line.batchId !== null && (
                      <span className="font-mono">batch {line.batchId}</span>
                    )}
                    {line.putawayBinId !== null && (
                      <span className="font-mono">bin {line.putawayBinId}</span>
                    )}
                  </div>
                </div>
              </div>
              {line.receivedQty !== null && (
                <div className="text-accent text-xs">
                  ✓ recorded: {line.receivedQty}
                  {line.damagedQty ? ` (${line.damagedQty} dmg)` : ''}
                </div>
              )}
            </div>

            {isArriving && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr] gap-2 mt-2">
                <FormField label="Received qty">
                  <Input
                    type="number"
                    min={0}
                    max={1_000_000}
                    inputMode="numeric"
                    value={received[line.id] ?? String(line.receivedQty ?? '')}
                    onChange={(e) => setReceived({ ...received, [line.id]: e.target.value })}
                  />
                </FormField>
                <FormField label="Damaged">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={damaged[line.id] ?? String(line.damagedQty ?? '0')}
                    onChange={(e) => setDamaged({ ...damaged, [line.id]: e.target.value })}
                  />
                </FormField>
                <FormField label="Putaway bin">
                  <Select
                    value={binByLine[line.id] ?? line.putawayBinId ?? ''}
                    onChange={(e) => setBinByLine({ ...binByLine, [line.id]: e.target.value })}
                  >
                    <option value="">— select bin —</option>
                    {(bins.data ?? [])
                      .filter((b) => b.type === 'STORAGE' || b.type === 'RECEIVING')
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} ({b.type})
                        </option>
                      ))}
                  </Select>
                </FormField>
              </div>
            )}

            {/* R4 — only a STRICT SKU asks. On a NORMAL line there is
                nothing to scan and nothing is shown; an extra field on
                every line is how a receiving bench learns to skip
                fields. */}
            {isArriving && line.inventoryMode === 'STRICT' && (
              <div className="mt-2">
                <SerialScanner
                  id={`receipt-serials-${line.id}`}
                  label={`Supplier serials for ${line.variant.skuCode}`}
                  required={lineQty(line.id, line.receivedQty)}
                  serials={serialsByLine[line.id] ?? []}
                  onChange={(next) => setSerialsByLine({ ...serialsByLine, [line.id]: next })}
                  hint="Scan what the supplier printed. Skip any they did not serialize — Skydrop prints a serial for each of those at completion."
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* A DISCREPANCY receipt wrote NO stock. Until this panel existed
          it was a dead end: the goods were on the floor and the system
          would never admit they had arrived. */}
      {isDiscrepancy && (
        <div className="border-border mt-5 rounded-md border p-4">
          <h3 className="text-text-bright text-sm font-medium">Counts did not match</h3>
          <p className="text-text-muted mt-1 mb-3 text-xs">
            Nothing has been added to stock yet. Either we miscounted — put the true numbers in
            above and correct it — or the shortage is real and you accept it, which records the gap
            permanently against this consignment.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <label className="text-text-muted mb-1 block text-xs" htmlFor="force-note">
                Why you are accepting it
              </label>
              <Input
                id="force-note"
                value={forceNote}
                onChange={(e) => setForceNote(e.target.value)}
                maxLength={2000}
                placeholder="e.g. Supplier confirmed 4 units short; credit agreed."
              />
            </div>
            <Button
              variant="primary"
              size="md"
              disabled={busy !== null || forceNote.trim() === ''}
              onClick={() => void onForceComplete()}
            >
              {busy === 'resolve' ? 'Completing…' : 'Accept the shortage and complete'}
            </Button>
          </div>
          {forceNote.trim() === '' && (
            <p className="text-text-faint mt-2 text-xs">
              A note is required — it is the only record of why the numbers differ.
            </p>
          )}
        </div>
      )}

      {isCompleted && (
        <div className="text-accent text-xs uppercase tracking-wide mt-5 text-center">
          ✓ Stock written. This receipt is now history.
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div>
      <div className="text-text-faint text-xs uppercase tracking-wide">{label}</div>
      <div className="text-text-body mt-0.5">{value}</div>
    </div>
  );
}
