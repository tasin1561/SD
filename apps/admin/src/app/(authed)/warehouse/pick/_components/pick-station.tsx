'use client';

import { useState, type ReactElement } from 'react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { TextField } from '@skydrop/ui/app/text-field';
import { Check } from 'lucide-react';
import {
  usePullNextPick,
  useStartPick,
  useRecordPickItem,
  useCompletePick,
  type StrictPulledPick,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SerialScanner, scanCountMet } from '@/components/ui/serial-scanner';
import { ForceExpirePick } from './force-expire';
import '../../_components/benches.css';

/**
 * Picker workspace — one parcel at a time. Flow:
 *   1. "Pull next" → API claims a CONFIRMED shipment + returns its lines.
 *   2. "Start pick" → CONFIRMED → PENDING_PICK + phase-2 allocation.
 *      If WMS-4 shortfall → status comes back as PENDING_MANUAL_PLACEMENT;
 *      the operator hands off to a supervisor (no further action here).
 *   3. For each line: enter bin id + batch id, hit "Record". A STRICT
 *      line (R4) also wants every unit off the shelf scanned.
 *   4. "Complete" once all lines recorded → PENDING_PICK → PICKED.
 *      The pack queue picks it up automatically (WMS-7).
 *
 * R4: the serial field appears ONLY on a line the pull marked STRICT.
 * Putting it on every line would have a picker skipping a field on nine
 * parcels out of ten, which is how the tenth gets skipped too.
 *
 * FE-2: every server rejection surfaces verbatim — PICK_NOT_OWNED,
 * PICK_INCOMPLETE, UNIT_SCAN_COUNT_MISMATCH, UNIT_NOT_FOUND.
 */
export function PickStation(): ReactElement {
  const toast = useToast();
  const [pick, setPick] = useState<StrictPulledPick | null>(null);
  const [started, setStarted] = useState(false);
  const [recordedItems, setRecordedItems] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binByItem, setBinByItem] = useState<Record<string, string>>({});
  const [batchByItem, setBatchByItem] = useState<Record<string, string>>({});
  const [serialsByItem, setSerialsByItem] = useState<Record<string, readonly string[]>>({});

  const pull = usePullNextPick();
  const start = useStartPick();
  const recordItem = useRecordPickItem();
  const complete = useCompletePick();

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
      setSerialsByItem({});
    } catch (err) {
      setError(serverVerdict(err));
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
      setError(serverVerdict(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onRecord(shipmentItemId: string): Promise<void> {
    if (!pick) return;
    setError(null);
    const line = pick.items.find((i) => i.shipmentItemId === shipmentItemId);
    if (line === undefined) return;
    const bin = (binByItem[shipmentItemId] ?? '').trim();
    const batch = (batchByItem[shipmentItemId] ?? '').trim();
    if (!bin || !batch) {
      setError('Bin and batch are both required for each line.');
      return;
    }
    const strict = line.inventoryMode === 'STRICT';
    const serials = serialsByItem[shipmentItemId] ?? [];
    setBusyId(shipmentItemId);
    try {
      await recordItem.mutateAsync({
        shipmentId: pick.shipmentId,
        shipmentItemId,
        pickedBinId: bin,
        pickedBatchId: batch,
        // A NORMAL line sends no serial key at all — the gate ignores it
        // for that SKU, and an always-present empty array is a field
        // that stops meaning anything.
        ...(strict ? { scannedSerials: serials } : {}),
      });
      setRecordedItems((prev) => new Set(prev).add(shipmentItemId));
      toast.success(
        strict ? `Line recorded — ${serials.length} unit(s) scanned.` : 'Line recorded.',
      );
    } catch (err) {
      setError(serverVerdict(err));
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
      setSerialsByItem({});
    } catch (err) {
      setError(serverVerdict(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="wh-stack">
      <div className="wh-row">
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
        <div role="alert" className="wh-alert">
          {error}
        </div>
      )}

      {!pick ? (
        <EmptyState
          title="No pick in progress"
          description="Click Pull next to claim the next confirmed parcel from the queue."
        />
      ) : (
        <section className="wh-card wh-stack">
          <div className="wh-row wh-row--between">
            <div>
              <div className="wh-title">
                Shipment <span className="sk-ident">{pick.shipmentNumber}</span>
              </div>
              <div className="wh-faint sk-figure">
                Started {new Date(pick.pickStartedAt).toLocaleTimeString()} · expires{' '}
                {new Date(pick.pickExpiresAt).toLocaleTimeString()}
              </div>
            </div>
            {started && <span className="wh-tag">In progress</span>}
          </div>

          <div className="wh-stack wh-stack--tight">
            {pick.items.map((it) => {
              const done = recordedItems.has(it.shipmentItemId);
              const strict = it.inventoryMode === 'STRICT';
              const serials = serialsByItem[it.shipmentItemId] ?? [];
              // The count target is the server's — exactly `quantity`
              // serials or the record 409s. This only decides whether
              // the button is live; the refusal that counts is the API's.
              const serialsReady = !strict || scanCountMet(serials.length, it.quantity);
              return (
                <div key={it.shipmentItemId} className="wh-item" data-done={done ? '1' : undefined}>
                  <div className="wh-item__head">
                    <div className="wh-min0">
                      <div className="wh-item__name">
                        {it.productName}
                        {it.variantLabel ? (
                          <span className="wh-note"> · {it.variantLabel}</span>
                        ) : null}
                      </div>
                      <div className="wh-item__sub">
                        <span className="sk-ident">{it.skuCode}</span> ·{' '}
                        <span className="sk-figure">qty {it.quantity}</span>
                        {it.unitWeightGrams !== null ? (
                          <span className="sk-figure">
                            {` · ${it.unitWeightGrams * it.quantity}g`}
                          </span>
                        ) : (
                          ''
                        )}
                      </div>
                    </div>
                    {strict && <span className="wh-tag">Per-unit tracked</span>}
                  </div>
                  {!done && (
                    <>
                      {strict && (
                        <SerialScanner
                          id={`pick-serials-${it.shipmentItemId}`}
                          label={`Scan ${it.quantity} unit serial(s) for ${it.skuCode}`}
                          required={it.quantity}
                          serials={serials}
                          disabled={!started || busyId === it.shipmentItemId}
                          onChange={(next) =>
                            setSerialsByItem({ ...serialsByItem, [it.shipmentItemId]: next })
                          }
                          hint="This SKU is tracked per unit — the serial on each item, not the SKU barcode."
                        />
                      )}
                      <div className="wh-fields" data-cols="pick">
                        <TextField
                          label="Bin"
                          inputClassName="sk-ident"
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
                        <TextField
                          label="Batch"
                          inputClassName="sk-ident"
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
                        <Button
                          variant="secondary"
                          size="lg"
                          disabled={!started || busyId === it.shipmentItemId || !serialsReady}
                          onClick={() => void onRecord(it.shipmentItemId)}
                        >
                          {busyId === it.shipmentItemId ? 'Saving…' : 'Record'}
                        </Button>
                      </div>
                    </>
                  )}
                  {done && (
                    <div className="wh-good">
                      <Check size={14} aria-hidden /> Recorded
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {started && recordedItems.size === pick.items.length && (
            <div className="wh-row wh-row--end">
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
        </section>
      )}

      {/* Supervisor escape hatch when a claim outlives the picker. */}
      <ForceExpirePick />
    </div>
  );
}
