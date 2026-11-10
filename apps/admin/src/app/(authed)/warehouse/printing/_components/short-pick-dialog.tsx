'use client';

import { useState, type ReactElement } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog } from '@skydrop/ui/app/dialog';
import { useRecordShortPick, type PickBatchView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import '../../_components/benches.css';

/**
 * SHORT PICK — "I could only find N of M", per line, beside the one-tap
 * "everything was found" action (which this never replaces).
 *
 * Built for people who may not read: the expected count is a big number,
 * the found count is stepped with two large round buttons, and the result
 * is a tick with the numbers. Words are secondary and in three languages.
 *
 * FE-2: nothing here decides whether the call is allowed. The stepper
 * only keeps the number from going below 0 or above what the sheet asked
 * for (a number that cannot be typed wrongly by a thumb); the batch
 * status and `0 <= found < expected` are the server's, and its
 * `[CODE] message` is shown as it came.
 */
export function ShortPickDialog({
  batch,
  open,
  onOpenChange,
}: {
  readonly batch: PickBatchView | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const record = useRecordShortPick();
  const [found, setFound] = useState<Readonly<Record<string, number>>>({});
  const [done, setDone] = useState<Readonly<Record<string, { found: number; expected: number }>>>(
    {},
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save(itemId: string, qtyFound: number): Promise<void> {
    if (batch === null) return;
    setBusyId(itemId);
    setErrors((p) => {
      const { [itemId]: _gone, ...rest } = p;
      return rest;
    });
    try {
      const r = await record.mutateAsync({ batchId: batch.id, shipmentItemId: itemId, qtyFound });
      setDone((p) => ({ ...p, [itemId]: { found: r.found, expected: r.expected } }));
    } catch (e) {
      setErrors((p) => ({ ...p, [itemId]: serverVerdict(e) }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('warehousePrintingPrintingStation.shortPickTitle', {
        batchNumber: batch?.batchNumber ?? '',
      })}
    >
      <div className="wh-stack">
        {(batch?.shipments ?? []).map((s) => (
          <section key={s.shipmentId} className="wh-stack wh-stack--tight">
            <div className="sk-ident">{s.shipmentNumber}</div>
            {s.items.map((it) => {
              const value = found[it.shipmentItemId] ?? Math.max(it.quantity - 1, 0);
              const recorded = done[it.shipmentItemId];
              const err = errors[it.shipmentItemId];
              const busy = busyId === it.shipmentItemId;
              const step = (delta: number): void =>
                setFound((p) => ({
                  ...p,
                  [it.shipmentItemId]: Math.min(Math.max(value + delta, 0), it.quantity),
                }));
              return (
                <div key={it.shipmentItemId} className="wh-sp">
                  <div className="wh-sp__what">
                    <span className="sk-ident">{it.skuCode}</span>
                    <span className="wh-faint">
                      {it.productName}
                      {it.variantLabel !== null ? ` · ${it.variantLabel}` : ''}
                    </span>
                  </div>
                  <div
                    className="wh-sp__ask"
                    aria-label={t('warehousePrintingPrintingStation.sheetAsked', {
                      expected: it.quantity,
                    })}
                  >
                    <span className="wh-sp__big">{it.quantity}</span>
                  </div>
                  <div className="wh-sp__step">
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => step(-1)}
                      disabled={busy || value <= 0}
                      aria-label={t('warehousePrintingPrintingStation.oneLess')}
                      icon={<Minus size={22} />}
                    />
                    <span className="wh-sp__big wh-sp__found" aria-live="polite">
                      {value}
                    </span>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => step(1)}
                      disabled={busy || value >= it.quantity}
                      aria-label={t('warehousePrintingPrintingStation.oneMore')}
                      icon={<Plus size={22} />}
                    />
                    <Button
                      size="lg"
                      onClick={() => void save(it.shipmentItemId, value)}
                      loading={busy}
                      disabled={busy}
                      aria-label={t('warehousePrintingPrintingStation.recordFound', {
                        found: value,
                        expected: it.quantity,
                      })}
                      icon={<Check size={22} />}
                    >
                      {t('warehousePrintingPrintingStation.record')}
                    </Button>
                  </div>
                  {recorded !== undefined && (
                    <div role="status" className="wh-sp__ok">
                      <Check size={20} aria-hidden="true" />
                      <span className="wh-sp__big">
                        {recorded.found} / {recorded.expected}
                      </span>
                      <span>
                        {t('warehousePrintingPrintingStation.recordedShort', {
                          found: recorded.found,
                          expected: recorded.expected,
                        })}
                      </span>
                    </div>
                  )}
                  {err !== undefined && (
                    <div role="alert" className="wh-alert">
                      {err}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
