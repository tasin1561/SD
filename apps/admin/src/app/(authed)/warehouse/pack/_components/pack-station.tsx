'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  useToast,
} from '@skydrop/ui/components';
import Link from 'next/link';
import { AlertTriangle, Check } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import {
  useCancelPackBox,
  useClosePackBox,
  useCompletePack,
  useForceCompletePack,
  useOpenPackBox,
  useScanIntoPackBox,
  type OpenPackBox,
  type PackBoxLine,
} from '@/lib/api-hooks';
import { useScanBlock } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import { SerialScanner } from '@/components/ui/serial-scanner';

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

/**
 * R4 — the box closed, but the parcel would not complete without the
 * unit serials spelled out. `shipmentId` is what
 * `POST /warehouse/packs/:shipmentId/complete` needs; the serials are
 * the ones this box already accepted as units, offered back so the
 * packer confirms rather than re-scans a sealed box.
 */
interface PendingCompletion {
  readonly shipmentId: string;
  readonly awbNumber: string;
}

/** The code on an ApiError body, for choosing which remedy to OFFER. */
function verdictCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : (err.code ?? null);
}

export function PackStation(): ReactElement {
  const toast = useToast();
  const block = useScanBlock();
  const forceComplete = useForceCompletePack();
  const canForce = usePermission('warehouse.pick.supervise');
  const [forcing, setForcing] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [box, setBox] = useState<OpenPackBox | null>(null);
  const [lines, setLines] = useState<ScannedLine[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  // Every code the server came back and said was a serialized unit —
  // the packer scanned them, so the parcel's serials are already known
  // by the time completion asks for them.
  const [unitSerials, setUnitSerials] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<PendingCompletion | null>(null);

  const open = useOpenPackBox();
  const scan = useScanIntoPackBox();
  const close = useClosePackBox();
  const cancel = useCancelPackBox();
  const completePack = useCompletePack();

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
    setUnitSerials([]);
    setPending(null);
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
        try {
          const result = await close.mutateAsync({ packBoxId: box.packBoxId, awbNumber: value });
          toast.success(
            result.manifestNumber
              ? `Packed — manifest ${result.manifestNumber}`
              : 'Packed — ready for pickup',
          );
          reset();
        } catch (err) {
          setError(serverVerdict(err));
          // The box is CLOSED by the time completion runs, so a refusal
          // here is not "keep packing" — the remaining step is the one
          // the server just named. Offer exactly that rather than
          // leaving a sealed parcel with no way forward.
          if (verdictCode(err) === 'UNIT_SCAN_REQUIRED') {
            setPending({ shipmentId: box.shipmentId, awbNumber: box.awbNumber });
            setBox(null);
            setLines([]);
          }
        }
        return;
      }

      const result = await scan.mutateAsync({ packBoxId: box.packBoxId, code: value });
      setLines((prev) =>
        prev.map((l) => (l.variantId === result.variantId ? { ...l, scanned: l.scanned + 1 } : l)),
      );
      if (result.stockUnitId !== null) {
        setUnitSerials((prev) => (prev.includes(value) ? prev : [...prev, value]));
      }
    } catch (err) {
      // Verbatim, and BLOCKING. "That unit was picked for a different
      // parcel" is the entire value of the gate; softening it would
      // throw that away, and so would letting the packer scan straight
      // past it. The modal takes the field's focus and does not give it
      // back until they have said they have fixed it — a refusal that
      // scrolls away is a refusal nobody read.
      setRefusal(serverVerdict(err));
    }
  }

  /**
   * Finish a parcel whose box closed but whose completion wanted the
   * serials listed out.
   *
   * No count gate here on purpose: the server checks the scanned SET
   * against the parcel's PICKED units, and that target is not something
   * this screen can compute without re-deriving the rule it would then
   * be free to disagree with. Send what was scanned; the verdict is the
   * server's.
   */
  async function onFinishPack(): Promise<void> {
    if (pending === null || unitSerials.length === 0) return;
    setError(null);
    try {
      const result = await completePack.mutateAsync({
        shipmentId: pending.shipmentId,
        scannedSerials: unitSerials,
      });
      toast.success(
        result.manifestNumber
          ? `Packed — manifest ${result.manifestNumber}`
          : 'Packed — ready for pickup',
      );
      reset();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  /**
   * The parcel whose contents cannot be scanned.
   *
   * Goods shelved before product labelling existed, or a sticker torn
   * off in transit. A supervisor says so in writing and the parcel goes
   * out; the reason is the only record that anybody chose this, which
   * is why the server insists on a real sentence.
   */
  async function onForceComplete(): Promise<void> {
    if (box === null) return;
    setError(null);
    try {
      const result = await forceComplete.mutateAsync({
        shipmentId: box.shipmentId,
        reason: forceReason.trim(),
      });
      toast.success(
        result.manifestNumber
          ? `Packed without scanning — manifest ${result.manifestNumber}`
          : 'Packed without scanning',
      );
      setForcing(false);
      setForceReason('');
      reset();
    } catch (err) {
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

  const busy =
    open.isPending ||
    scan.isPending ||
    close.isPending ||
    cancel.isPending ||
    completePack.isPending;

  return (
    <div className="space-y-4">
      {block.data != null && (
        <Card>
          <CardBody>
            <div className="border-status-failed-fg/40 bg-status-failed-bg/40 rounded-md border p-3">
              <div className="text-status-failed-fg flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={15} /> Scanning is stopped
              </div>
              <p className="mt-1 text-sm">{block.data.title}</p>
              <p className="text-text-muted mt-2 text-xs whitespace-pre-line">
                {block.data.detail}
              </p>
              <p className="text-text-faint mt-2 text-xs">
                Put the box aside and get an admin. They clear it on{' '}
                <Link href="/system-issues" className="hover:text-text underline">
                  system issues
                </Link>
                , after checking whether there are two of them.
              </p>
            </div>
          </CardBody>
        </Card>
      )}
      {/* While a parcel is waiting on its serials the label field means
          nothing — a scan would open a second box on a bench that is not
          free yet. */}
      {pending === null && block.data == null && (
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
              // Disabled while a refusal is up: a scan gun types and
              // presses Enter on its own, so an un-blocked field would
              // let the next scan land before anybody read the warning.
              disabled={busy || refusal !== null}
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
      )}

      {error !== null && (
        <div
          role="alert"
          className="text-critical rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      {pending !== null ? (
        <Card>
          <CardBody className="space-y-3">
            <div>
              <div className="text-text-bright text-sm font-medium">
                One step left on <span className="font-mono">{pending.awbNumber}</span>
              </div>
              <p className="text-text-muted mt-1 text-xs">
                The box is closed and its contents matched. This parcel is tracked per unit, so the
                serials go with it — these are the ones you scanned in. Add any the box did not
                recognise, then finish.
              </p>
            </div>
            <SerialScanner
              id="pack-finish-serials"
              label="Unit serials in this parcel"
              serials={unitSerials}
              onChange={setUnitSerials}
              disabled={busy}
              autoFocus
              hint="No target count here — the server checks these against the units picked for this parcel and will say if one is missing or does not belong."
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="md"
                disabled={busy || unitSerials.length === 0}
                onClick={() => void onFinishPack()}
              >
                {completePack.isPending ? 'Finishing…' : 'Finish pack'}
              </Button>
              <Button variant="ghost" size="md" disabled={busy} onClick={() => reset()}>
                Leave it for now
              </Button>
            </div>
            <p className="text-text-faint text-xs">
              Leaving it discards this list and changes nothing on the parcel — it stays picked and
              un-packed, and whoever takes it next scans its label to open a fresh box.
            </p>
          </CardBody>
        </Card>
      ) : box === null ? (
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

              {/* The escape hatch, and only for somebody who can carry
                  it: a packer must not be able to waive the check they
                  are the one performing. Cosmetic here — the server
                  holds the permission (FE-2). */}
              {canForce && !cancelling && (
                <div className="border-border-subtle mt-3 border-t pt-3">
                  {!forcing ? (
                    <button
                      type="button"
                      className="text-text-faint hover:text-text text-xs underline"
                      onClick={() => setForcing(true)}
                    >
                      These products have no labels to scan
                    </button>
                  ) : (
                    <>
                      <p className="text-text-muted mb-2 text-xs">
                        This packs the parcel without checking its contents. It is recorded against
                        your name with the reason below.
                      </p>
                      <Input
                        value={forceReason}
                        placeholder="Why? e.g. stock received before product labelling; counted by hand against the pick list"
                        onChange={(e) => setForceReason(e.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="md"
                          disabled={forceReason.trim().length < 20 || forceComplete.isPending}
                          onClick={() => void onForceComplete()}
                        >
                          {forceComplete.isPending ? 'Packing…' : 'Pack without scanning'}
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => setForcing(false)}>
                          Back
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
      <CameraScanButton onClick={() => setCamera(true)} />
      <BarcodeCamera
        open={camera}
        onClose={() => setCamera(false)}
        onScan={(scanned) => {
          setCamera(false);
          setCode(scanned);
          void onScan(scanned);
        }}
        title={box === null ? 'Scan the shipping label' : 'Scan a product'}
      />

      {/* A refusal STOPS the bench. The packer says they have fixed it
          before anything else can be scanned — which is the difference
          between a warning and a gate. */}
      <Modal
        open={refusal !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRefusal(null);
            setCode('');
            inputRef.current?.focus();
          }
        }}
        title="That scan was refused"
        tone="critical"
      >
        <p className="text-sm">{refusal}</p>
        <p className="text-text-muted mt-2 text-xs">
          Nothing was added to the box. Put that item aside, find the right one, and carry on.
        </p>
        <ModalFooter>
          <Button
            onClick={() => {
              setRefusal(null);
              setCode('');
              inputRef.current?.focus();
            }}
          >
            I have fixed it
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
