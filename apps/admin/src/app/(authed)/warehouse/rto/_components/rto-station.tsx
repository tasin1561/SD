'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  Input,
  Select,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import { PutawayPanel } from './putaway-panel';
import type { RtoItemCondition, RtoDisposition } from '@skydrop/db';
import {
  useReceiveRto,
  useInspectRtoItem,
  useFinalizeRto,
  useRtoShipmentDetail,
} from '@/lib/api-hooks';

/**
 * RTO workspace — three phases:
 *  1. Receive: enter AWB, click Receive → API stamps rtoReceivedAt and
 *     drives the order to RTO_RECEIVED.
 *  2. Inspect: for each shipment_item, pick a condition (GOOD / DAMAGED /
 *     MISSING / UNOPENED) + a disposition (RESTOCK / WRITE_OFF) + optional
 *     notes, then Save. The disposition decides what happens at finalize.
 *  3. Finalize: WMS-8 saga — RESTOCK lines get a RETURN_RESTOCK +qty
 *     movement; WRITE_OFF lines stand (no movement). Order transitions
 *     RTO_RECEIVED → RTO_RESTOCKED.
 *
 * FE-2 verdict surfacing on every server error.
 */
export function RtoStation(): ReactElement {
  const toast = useToast();
  const [awb, setAwb] = useState('');
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receive = useReceiveRto();
  const detail = useRtoShipmentDetail(shipmentId);
  const inspect = useInspectRtoItem();
  const finalize = useFinalizeRto();

  function fmtError(err: unknown): string {
    if (err instanceof ApiError) {
      const b = err.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : err.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return err instanceof Error ? err.message : 'Operation failed';
  }

  async function onReceive(): Promise<void> {
    setError(null);
    const a = awb.trim();
    if (!a) {
      setError('AWB is required.');
      return;
    }
    try {
      const r = await receive.mutateAsync({ awbNumber: a });
      setShipmentId(r.shipmentId);
      toast.success(
        r.alreadyReceived
          ? `Already received earlier — opening shipment ${r.shipmentId.slice(0, 8)}.`
          : `Received — order ${r.orderId.slice(0, 8)} → ${r.orderStatus}.`,
      );
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onFinalize(): Promise<void> {
    if (!shipmentId) return;
    setError(null);
    try {
      const r = await finalize.mutateAsync({ shipmentId });
      toast.success(
        `Finalized — ${r.restockedLines} restocked, ${r.writtenOffLines} written off. Order ${r.orderStatus}.`,
      );
      setShipmentId(null);
      setAwb('');
    } catch (err) {
      setError(fmtError(err));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <h2 className="text-text-bright text-sm font-medium mb-3">Receive</h2>
          <div className="flex items-end gap-2">
            <FormField label="AWB number">
              <Input
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                placeholder="DL12345678"
                disabled={receive.isPending}
              />
            </FormField>
            <Button
              variant="primary"
              size="md"
              disabled={receive.isPending || !awb.trim()}
              onClick={() => void onReceive()}
            >
              {receive.isPending ? 'Receiving…' : 'Receive'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      {!shipmentId ? (
        <EmptyState
          title="No shipment selected"
          description="Receive an inbound RTO by AWB to begin inspection."
        />
      ) : detail.isLoading ? (
        <Card>
          <CardBody>Loading shipment…</CardBody>
        </Card>
      ) : detail.isError || !detail.data ? (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          Failed to load shipment.
        </div>
      ) : (
        <Card>
          <CardBody>
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <div className="text-text-bright font-medium text-sm">
                  Shipment {detail.data.shipmentNumber}
                </div>
                <div className="text-text-faint text-xs mt-0.5">
                  Order status: {detail.data.orderStatus ?? '—'} · {detail.data.items.length}{' '}
                  line(s)
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {detail.data.items.map((it) => (
                <RtoItemRow
                  key={it.shipmentItemId}
                  item={it}
                  onSave={async (condition, disposition, notes) => {
                    setError(null);
                    try {
                      await inspect.mutateAsync({
                        shipmentItemId: it.shipmentItemId,
                        condition: condition as RtoItemCondition,
                        disposition: disposition as RtoDisposition,
                        ...(notes ? { notes } : {}),
                      });
                      toast.success(`Line inspected.`);
                      await detail.refetch();
                    } catch (err) {
                      setError(fmtError(err));
                    }
                  }}
                  saving={inspect.isPending}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                size="md"
                disabled={finalize.isPending}
                onClick={() => void onFinalize()}
              >
                {finalize.isPending ? 'Finalizing…' : 'Finalize disposition'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* After finalise, whatever came back GOOD is sitting in a hold bin
          and is not sellable. The panel renders nothing when there is
          nothing in hold, so it appears exactly when there is work. */}
      {shipmentId !== null && <PutawayPanel shipmentId={shipmentId} />}
    </div>
  );
}

function RtoItemRow({
  item,
  onSave,
  saving,
}: {
  readonly item: {
    readonly shipmentItemId: string;
    readonly skuCode: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
    readonly rtoCondition: string | null;
    readonly rtoDisposition: string | null;
    readonly rtoInspectionNotes: string | null;
  };
  readonly onSave: (condition: string, disposition: string, notes?: string) => Promise<void>;
  readonly saving: boolean;
}): ReactElement {
  const [condition, setCondition] = useState(item.rtoCondition ?? '');
  const [disposition, setDisposition] = useState(item.rtoDisposition ?? '');
  const [notes, setNotes] = useState(item.rtoInspectionNotes ?? '');

  const inspected = item.rtoCondition !== null && item.rtoDisposition !== null;

  return (
    <div
      className={
        'p-3 rounded-[6px] border ' +
        (inspected
          ? 'border-[var(--color-accent-ring)] bg-[var(--color-accent-tint)]'
          : 'border-border')
      }
    >
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-text-bright text-sm">
            {item.productName}
            {item.variantLabel ? (
              <span className="text-text-muted"> · {item.variantLabel}</span>
            ) : null}
          </div>
          <div className="text-text-faint text-xs font-mono">
            {item.skuCode} · qty {item.quantity}
          </div>
        </div>
        {inspected && <div className="text-accent text-xs">✓ Inspected</div>}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <FormField label="Condition">
          <Select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            disabled={saving}
          >
            <option value="">—</option>
            <option value="GOOD">GOOD</option>
            <option value="DAMAGED">DAMAGED</option>
            <option value="MISSING">MISSING</option>
          </Select>
        </FormField>
        <FormField label="Disposition">
          <Select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            disabled={saving}
          >
            <option value="">—</option>
            <option value="RESTOCK">RESTOCK</option>
            <option value="WRITE_OFF">WRITE_OFF</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Notes">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Optional inspection notes"
          disabled={saving}
        />
      </FormField>
      <div className="flex justify-end mt-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={saving || !condition || !disposition}
          onClick={() => void onSave(condition, disposition, notes.trim() || undefined)}
        >
          {saving ? 'Saving…' : 'Save inspection'}
        </Button>
      </div>
    </div>
  );
}
