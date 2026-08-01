'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Card, CardBody, EmptyState, Input, useToast } from '@skydrop/ui/components';
import { Check } from 'lucide-react';
import {
  useCancelPackBox,
  useClosePackBox,
  useOpenPackBox,
  useScanIntoPackBox,
  type OpenPackBox,
  type PackBoxLine,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The pack bench.
 *
 * One input, always focused, and the packer never touches the keyboard:
 * scan the shipping label to open the box, scan each product in, scan
 * the label again to close. A barcode scanner types the code and presses
 * Enter, so the whole station runs off that single field — anything else
 * would have someone putting a parcel down to click.
 *
 * It replaced a pull-then-"Mark packed" screen, which asked a packer to
 * ASSERT the box was right rather than prove it.
 *
 * The screen's job is to answer, from across a bench, "what still has to
 * go in this box". So the outstanding lines are the biggest thing on it,
 * and a satisfied line goes QUIET rather than disappearing — a line that
 * vanishes leaves the packer wondering whether they scanned it or
 * imagined it.
 *
 * Refusals are surfaced verbatim (FE-2). The client deliberately does
 * not pre-check quantities: the server owns that, and a second opinion
 * here could only ever disagree with it.
 */

interface ScannedLine extends PackBoxLine {
  scanned: number;
}

export function PackStation(): ReactElement {
  const toast = useToast();
  const [box, setBox] = useState<OpenPackBox | null>(null);
  const [lines, setLines] = useState<ScannedLine[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const open = useOpenPackBox();
  const scan = useScanIntoPackBox();
  const close = useClosePackBox();
  const cancel = useCancelPackBox();

  // A scanner types into whatever holds focus, so focus has to come back
  // here after every state change or the next scan goes nowhere.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [box, lines, error, cancelling]);

  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const done = lines.reduce((n, l) => n + l.scanned, 0);
  const complete = total > 0 && done === total;

  function reset(): void {
    setBox(null);
    setLines([]);
    setCode('');
    setReason('');
    setCancelling(false);
  }

  /**
   * One handler for every scan.
   *
   * What a scan MEANS is decided by state, not by the packer picking a
   * mode: no box open ⇒ it is a label, open it. Box open and the code
   * matches that label ⇒ they are closing. Anything else is a product
   * going in.
   */
  async function onScan(raw: string): Promise<void> {
    const value = raw.trim();
    if (value.length === 0) return;
    setError(null);
    setCode('');

    try {
      if (box === null) {
        const opened = await open.mutateAsync({ awbNumber: value });
        setBox(opened);
        setLines(opened.expected.map((l) => ({ ...l, scanned: 0 })));
        toast.info(opened.alreadyOpen ? 'Box already open' : `Box open — ${opened.awbNumber}`);
        return;
      }

      if (value === box.awbNumber) {
        const result = await close.mutateAsync({ packBoxId: box.packBoxId, awbNumber: value });
        toast.success(
          result.manifestNumber
            ? `Packed — manifest ${result.manifestNumber}`
            : 'Packed — ready for pickup',
        );
        reset();
        return;
      }

      const result = await scan.mutateAsync({ packBoxId: box.packBoxId, code: value });
      setLines((prev) =>
        prev.map((l) => (l.variantId === result.variantId ? { ...l, scanned: l.scanned + 1 } : l)),
      );
    } catch (err) {
      // Verbatim. "That unit was picked for a different parcel" is the
      // entire value of the gate; softening it would throw that away.
      setError(serverVerdict(err));
    }
  }

  async function onCancel(): Promise<void> {
    if (box === null || reason.trim().length < 3) return;
    setError(null);
    try {
      const result = await cancel.mutateAsync({ packBoxId: box.packBoxId, reason: reason.trim() });
      toast.info(
        result.releasedScans > 0
          ? `Box cancelled — ${result.releasedScans} scan(s) released, parcel back in the queue`
          : 'Box cancelled — parcel back in the queue',
      );
      reset();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const busy = open.isPending || scan.isPending || close.isPending || cancel.isPending;

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardBody>
          <label htmlFor="pack-scan" className="text-text-muted mb-1 block text-xs">
            {box === null
              ? 'Scan the shipping label to open a box'
              : 'Scan a product — or the label again to close'}
          </label>
          <Input
            id="pack-scan"
            ref={inputRef}
            value={code}
            disabled={busy}
            autoComplete="off"
            placeholder={box === null ? 'Shipping label…' : 'Product barcode or serial…'}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onScan(code);
              }
            }}
            className="font-mono text-base"
          />
          {box !== null && (
            <div className="text-text-faint mt-2 text-xs">
              Box open on <span className="font-mono">{box.awbNumber}</span> — {done} of {total}{' '}
              scanned
            </div>
          )}
        </CardBody>
      </Card>

      {error !== null && (
        <div
          role="alert"
          className="text-critical rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      {box === null ? (
        <EmptyState
          title="No box open"
          description="Scan the shipping label on a parcel to start. You can hold one box at a time — close or cancel it before starting the next."
        />
      ) : (
        <>
          <Card>
            <CardBody className="p-0">
              <ul className="divide-border divide-y">
                {lines.map((l) => {
                  const satisfied = l.scanned >= l.quantity;
                  return (
                    <li
                      key={l.variantId}
                      className={
                        'flex items-center justify-between gap-4 px-4 py-3 ' +
                        (satisfied ? 'text-text-faint' : 'text-text-bright')
                      }
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{l.productName}</div>
                        <div className="text-text-faint font-mono text-xs">{l.skuCode}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 tabular-nums">
                        {satisfied && (
                          <Check size={15} className="text-[var(--status-delivered-fg)]" />
                        )}
                        <span className={satisfied ? 'text-sm' : 'text-lg font-semibold'}>
                          {l.scanned} / {l.quantity}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          {complete && (
            <div className="text-sm text-[var(--status-delivered-fg)]">
              Everything is in. Scan the label again to close the box.
            </div>
          )}

          <Card>
            <CardBody className="space-y-2">
              {!cancelling ? (
                <Button variant="ghost" size="md" onClick={() => setCancelling(true)}>
                  Cancel this box
                </Button>
              ) : (
                <>
                  <div className="text-text-muted text-xs">
                    The scans are discarded and the parcel goes back in the queue. Nothing returns
                    to inventory — packing never took it out.
                  </div>
                  <Input
                    value={reason}
                    placeholder="Why? e.g. damaged outer carton"
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      size="md"
                      disabled={reason.trim().length < 3 || cancel.isPending}
                      onClick={() => void onCancel()}
                    >
                      {cancel.isPending ? 'Cancelling…' : 'Cancel the box'}
                    </Button>
                    <Button variant="ghost" size="md" onClick={() => setCancelling(false)}>
                      Keep packing
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
