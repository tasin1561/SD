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
import { ApiError } from '@skydrop/api-client';
import type { RecordReceiptLineInput } from '@skydrop/api-client';
import {
  useCompleteGoodsReceipt,
  useGoodsReceiptDetail,
  useRecordReceiptLines,
  useStartReceiving,
  useWarehouseBins,
} from '@/lib/api-hooks';

/**
 * Admin receive-station — full goods-receipt lifecycle in one page:
 *
 *   1. PENDING   → "Start receiving" button (admin claims it; status →
 *                  ARRIVING and warehouse staff is stamped)
 *   2. ARRIVING  → per-line received/damaged/bin form → "Record line"
 *                  per line, or "Save all" batch → "Complete"
 *   3. COMPLETED → read-only with stock-written badge
 *   4. DISCREPANCY → read-only with "Force-complete" / corrections (deferred)
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
  const [busy, setBusy] = useState<'start' | 'record' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-line input state — keyed by lineId
  const [received, setReceived] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [binByLine, setBinByLine] = useState<Record<string, string>>({});

  const bins = useWarehouseBins(detail.data?.warehouseId ?? '');

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Action failed';
  }

  if (detail.isLoading) return <LoadingState label="Loading…" />;
  if (detail.isError) return <ErrorState message={detail.error?.message ?? 'Failed to load.'} />;
  if (!detail.data) return <ErrorState message="Goods receipt not found." />;

  const r = detail.data;
  const isPending = r.status === 'PENDING';
  const isArriving = r.status === 'ARRIVING';
  const isCompleted = r.status === 'COMPLETED';

  async function onStart(): Promise<void> {
    setError(null);
    setBusy('start');
    try {
      await start.mutateAsync({ id });
      toast.success('Started receiving — record each line below.');
    } catch (e) {
      setError(fmtError(e));
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
      setError(fmtError(e));
    } finally {
      setBusy(null);
    }
  }

  async function onComplete(): Promise<void> {
    setError(null);
    setBusy('complete');
    try {
      const result = await complete.mutateAsync({ id });
      if (result.status === 'COMPLETED') {
        toast.success('Receipt completed — stock written.');
      } else if (result.status === 'DISCREPANCY') {
        toast.error('Marked as DISCREPANCY — expected/received qty mismatch.');
      } else {
        toast.info(`Status now ${result.status}.`);
      }
    } catch (e) {
      setError(fmtError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-5xl">
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
                  disabled={busy !== null}
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
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Declared" value={new Date(r.createdAt).toLocaleString()} />
            <Field
              label="Started"
              value={r.startedReceivingAt ? new Date(r.startedReceivingAt).toLocaleString() : '—'}
            />
            <Field
              label="Completed"
              value={r.completedAt ? new Date(r.completedAt).toLocaleString() : '—'}
            />
            <Field label="Seller ref" value={r.sellerReference ?? '—'} />
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
              <div>
                <div className="text-text-bright text-sm">
                  {line.variant.product.name}
                  {line.variant.variantLabel ? (
                    <span className="text-text-muted"> · {line.variant.variantLabel}</span>
                  ) : null}
                </div>
                <div className="text-text-faint text-xs mt-0.5 font-mono">
                  {line.variant.skuCode} · expected {line.expectedQty}
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
          </div>
        ))}
      </div>

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
