'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  Input,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { PulledPick } from '@skydrop/api-client';
import { usePullNextPick, useStartPick, useRecordPickItem, useCompletePick } from '@/lib/api-hooks';
import { ForceExpirePick } from './force-expire';

/**
 * Picker workspace — one parcel at a time. Flow:
 *   1. "Pull next" → API claims a CONFIRMED shipment + returns its lines.
 *   2. "Start pick" → CONFIRMED → PENDING_PICK + phase-2 allocation.
 *      If WMS-4 shortfall → status comes back as PENDING_MANUAL_PLACEMENT;
 *      the operator hands off to a supervisor (no further action here).
 *   3. For each line: enter bin id + batch id, hit "Record".
 *   4. "Complete" once all lines recorded → PENDING_PICK → PICKED.
 *      The pack queue picks it up automatically (WMS-7).
 *
 * FE-2: every server rejection surfaces verbatim — PICK_NOT_OWNED,
 * PICK_INCOMPLETE, etc.
 */
export function PickStation(): ReactElement {
  const toast = useToast();
  const [pick, setPick] = useState<PulledPick | null>(null);
  const [started, setStarted] = useState(false);
  const [recordedItems, setRecordedItems] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binByItem, setBinByItem] = useState<Record<string, string>>({});
  const [batchByItem, setBatchByItem] = useState<Record<string, string>>({});

  const pull = usePullNextPick();
  const start = useStartPick();
  const recordItem = useRecordPickItem();
  const complete = useCompletePick();

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Operation failed';
  }

  async function onPull(): Promise<void> {
    setError(null);
    try {
      const result = await pull.mutateAsync();
      if (!result.pick) {
        toast.info('Queue is empty.');
        setPick(null);
        return;
      }
      setPick(result.pick);
      setStarted(false);
      setRecordedItems(new Set());
      setBinByItem({});
      setBatchByItem({});
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onStart(): Promise<void> {
    if (!pick) return;
    setError(null);
    setBusyId('start');
    try {
      const r = await start.mutateAsync({ shipmentId: pick.shipmentId });
      if (r.status === 'PENDING_MANUAL_PLACEMENT') {
        toast.error('Pick shortfall — order routed to manual placement.');
        setPick(null);
      } else {
        setStarted(true);
        toast.success(`Pick started: ${r.allocations.length} allocations.`);
      }
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onRecord(shipmentItemId: string): Promise<void> {
    if (!pick) return;
    setError(null);
    const bin = (binByItem[shipmentItemId] ?? '').trim();
    const batch = (batchByItem[shipmentItemId] ?? '').trim();
    if (!bin || !batch) {
      setError('Bin and batch are both required for each line.');
      return;
    }
    setBusyId(shipmentItemId);
    try {
      await recordItem.mutateAsync({
        shipmentId: pick.shipmentId,
        shipmentItemId,
        pickedBinId: bin,
        pickedBatchId: batch,
      });
      setRecordedItems((prev) => new Set(prev).add(shipmentItemId));
      toast.success(`Line recorded.`);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onComplete(): Promise<void> {
    if (!pick) return;
    setError(null);
    setBusyId('complete');
    try {
      await complete.mutateAsync({ shipmentId: pick.shipmentId });
      toast.success(`Picked — shipment ${pick.shipmentNumber} is in the pack queue.`);
      // After complete, refresh by clearing — the next "Pull" claims another.
      setPick(null);
      setStarted(false);
      setRecordedItems(new Set());
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={() => void onPull()}
          disabled={pull.isPending || (pick !== null && started)}
        >
          {pull.isPending ? 'Pulling…' : pick ? 'Pull next (after complete)' : 'Pull next'}
        </Button>
        {pick && !started && (
          <Button
            variant="secondary"
            size="md"
            onClick={() => void onStart()}
            disabled={busyId === 'start'}
          >
            {busyId === 'start' ? 'Starting…' : 'Start pick'}
          </Button>
        )}
      </div>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      {!pick ? (
        <EmptyState
          title="No pick in progress"
          description="Click Pull next to claim the next confirmed parcel from the queue."
        />
      ) : (
        <Card>
          <CardBody>
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-text-bright font-medium text-sm">
                  Shipment {pick.shipmentNumber}
                </div>
                <div className="text-text-faint text-xs mt-0.5">
                  Started {new Date(pick.pickStartedAt).toLocaleTimeString()} · expires{' '}
                  {new Date(pick.pickExpiresAt).toLocaleTimeString()}
                </div>
              </div>
              {started && (
                <div className="text-accent text-xs uppercase tracking-wide">In progress</div>
              )}
            </div>

            <div className="space-y-2">
              {pick.items.map((it) => {
                const done = recordedItems.has(it.shipmentItemId);
                return (
                  <div
                    key={it.shipmentItemId}
                    className={
                      'p-3 rounded-[6px] border ' +
                      (done
                        ? 'border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)]'
                        : 'border-border')
                    }
                  >
                    <div className="flex items-baseline justify-between mb-2">
                      <div>
                        <div className="text-text-bright text-sm">
                          {it.productName}
                          {it.variantLabel ? (
                            <span className="text-text-muted"> · {it.variantLabel}</span>
                          ) : null}
                        </div>
                        <div className="text-text-faint text-xs mt-0.5 font-mono">
                          {it.skuCode} · qty {it.quantity}
                          {it.unitWeightGrams !== null
                            ? ` · ${it.unitWeightGrams * it.quantity}g`
                            : ''}
                        </div>
                      </div>
                    </div>
                    {!done && (
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <FormField label="Bin">
                          <Input
                            value={binByItem[it.shipmentItemId] ?? ''}
                            onChange={(e) =>
                              setBinByItem({
                                ...binByItem,
                                [it.shipmentItemId]: e.target.value,
                              })
                            }
                            disabled={!started || busyId === it.shipmentItemId}
                            placeholder="bin-A1"
                          />
                        </FormField>
                        <FormField label="Batch">
                          <Input
                            value={batchByItem[it.shipmentItemId] ?? ''}
                            onChange={(e) =>
                              setBatchByItem({
                                ...batchByItem,
                                [it.shipmentItemId]: e.target.value,
                              })
                            }
                            disabled={!started || busyId === it.shipmentItemId}
                            placeholder="batch-2026-06-01"
                          />
                        </FormField>
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={!started || busyId === it.shipmentItemId}
                          onClick={() => void onRecord(it.shipmentItemId)}
                        >
                          {busyId === it.shipmentItemId ? 'Saving…' : 'Record'}
                        </Button>
                      </div>
                    )}
                    {done && <div className="text-accent text-xs">✓ Recorded</div>}
                  </div>
                );
              })}
            </div>

            {started && recordedItems.size === pick.items.length && (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => void onComplete()}
                  disabled={busyId === 'complete'}
                >
                  {busyId === 'complete' ? 'Completing…' : 'Complete pick'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Supervisor escape hatch when a claim outlives the picker. */}
      <ForceExpirePick />
    </div>
  );
}
