'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody, EmptyState, useToast } from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { PulledPack } from '@skydrop/api-client';
import { usePullNextPack, useCompletePack } from '@/lib/api-hooks';

/**
 * Packer workspace — pull-then-complete. Phase 1A has no persistent
 * claim on a pack task (the schema is intentionally claim-free); the
 * race is resolved at complete via the atomic guard on
 * (status=CREATED, pack_completed_at IS NULL). If two packers pull
 * the same shipment and one completes first, the second sees a 409
 * PACK_NOT_AVAILABLE and re-pulls.
 */
export function PackStation(): ReactElement {
  const toast = useToast();
  const [pack, setPack] = useState<PulledPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pull = usePullNextPack();
  const complete = useCompletePack();

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
      if (!result.pack) {
        toast.info('Pack queue is empty.');
        setPack(null);
        return;
      }
      setPack(result.pack);
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onComplete(): Promise<void> {
    if (!pack) return;
    setError(null);
    setBusy(true);
    try {
      await complete.mutateAsync({ shipmentId: pack.shipmentId });
      toast.success(`Packed — shipment ${pack.shipmentNumber} attached to manifest.`);
      setPack(null);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="md" onClick={() => void onPull()} disabled={pull.isPending}>
          {pull.isPending ? 'Pulling…' : pack ? 'Pull next (after complete)' : 'Pull next'}
        </Button>
      </div>

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      {!pack ? (
        <EmptyState
          title="No pack in progress"
          description="Click Pull next to claim the next picked shipment."
        />
      ) : (
        <Card>
          <CardBody>
            <div className="mb-3">
              <div className="text-text-bright font-medium text-sm">
                Shipment {pack.shipmentNumber}
              </div>
              <div className="text-text-faint text-xs mt-0.5">
                Picked{' '}
                {pack.pickCompletedAt ? new Date(pack.pickCompletedAt).toLocaleString() : '—'}
              </div>
            </div>

            <div className="space-y-2 mb-3">
              {pack.items.map((it) => (
                <div
                  key={it.shipmentItemId}
                  className="p-2 rounded-[5px] border border-border flex items-baseline justify-between"
                >
                  <div>
                    <div className="text-text-bright text-sm">
                      {it.productName}
                      {it.variantLabel ? (
                        <span className="text-text-muted"> · {it.variantLabel}</span>
                      ) : null}
                    </div>
                    <div className="text-text-faint text-xs font-mono">
                      {it.skuCode} · qty {it.quantity}
                    </div>
                  </div>
                  <div className="text-text-faint text-xs font-mono">
                    {it.pickedBinId ? `bin ${it.pickedBinId}` : '—'}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button variant="primary" size="md" onClick={() => void onComplete()} disabled={busy}>
                {busy ? 'Completing…' : 'Mark packed'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
