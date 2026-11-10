'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import Link from 'next/link';
import {
  AlertTriangle,
  Ban,
  Check,
  CircleHelp,
  Clock,
  Copy,
  ImageOff,
  ListChecks,
  OctagonX,
  PackageX,
  ScanLine,
  Trash2,
  Undo2,
} from 'lucide-react';
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
import { useScanSound } from '@/lib/scan-sound';
import { ScanSoundToggle } from '@/components/scan-sound-toggle';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import { SerialScanner } from '@/components/ui/serial-scanner';
import { PackQueueList } from './pack-queue-list';
import { PackStepStrip } from './pack-step-strip';
import { DISMISS_TRIPLE, packErrorCopy, type PackErrorKind } from './pack-error-copy';
import '../../_components/benches.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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

/**
 * The icon for the SHAPE of a refusal, so the dialog says something
 * before a single word is read. Paired with a tone on the dialog — never
 * colour alone.
 */
const KIND_ICON: Readonly<Record<PackErrorKind, ReactElement>> = {
  wrongItem: <PackageX size={22} />,
  duplicate: <Copy size={22} />,
  count: <ListChecks size={22} />,
  notReady: <Clock size={22} />,
  empty: <ScanLine size={22} />,
  stop: <OctagonX size={22} />,
};

export function PackStation(): ReactElement {
  const t = useT();

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
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The server's CODE, kept beside the verbatim verdict so the dialog can
  // pick the friendly three-language sentence. The verdict is still what
  // is rendered (FE-2); the code only chooses which words sit above it.
  const [refusalCode, setRefusalCode] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  // Every code the server came back and said was a serialized unit —
  // the packer scanned them, so the parcel's serials are already known
  // by the time completion asks for them.
  const [unitSerials, setUnitSerials] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<PendingCompletion | null>(null);

  // The one feedback channel that needs no literacy: a packer looking at
  // the item in their hands still HEARS whether the scan was taken.
  const sound = useScanSound();

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

  // After a refusal is acknowledged the field re-enables in the same render
  // that closes the dialog, so focus() at the click finds it still disabled
  // and the dialog's own focus-return then lands on <body>. Give the field
  // focus on the next frame instead, once both have settled — the next
  // scan must go straight in (fixed 2026-09-23, owner).
  const hadRefusal = useRef(false);
  useEffect(() => {
    if (refusal !== null) {
      hadRefusal.current = true;
      return;
    }
    if (!hadRefusal.current) return;
    hadRefusal.current = false;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [refusal]);

  // SCAN-1 — the operator is stopped. The screen says no, so the room
  // hears no, once, when the stop appears.
  const wasBlocked = useRef(false);
  const blocked = block.data != null;
  useEffect(() => {
    if (blocked && !wasBlocked.current) sound.refused();
    wasBlocked.current = blocked;
  }, [blocked, sound]);

  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const done = lines.reduce((n, l) => n + l.scanned, 0);
  const complete = total > 0 && done === total;

  /**
   * Which of the three steps the packer is standing on.
   *
   *   1  nothing in hand yet — scan the shipping label
   *   2  box open, products still outstanding
   *   3  everything in (or the box already closed and only the serials are
   *      left) — scan the label again to finish
   *
   * Derived, never stored: the strip must agree with the bench by
   * construction rather than by somebody remembering to update it.
   */
  const step: 1 | 2 | 3 = pending !== null ? 3 : box === null ? 1 : complete ? 3 : 2;

  /** Inline refusal: on screen AND in the room (every refusal is audible). */
  function fail(err: unknown): void {
    setError(serverVerdict(err));
    setErrorCode(verdictCode(err));
    sound.refused();
  }

  function dismissRefusal(): void {
    setRefusal(null);
    setRefusalCode(null);
    setCode('');
  }

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
    setErrorCode(null);
    setCode('');
    // The keypress that got here IS the gesture a browser waits for before
    // it will play anything. Priming can never throw.
    sound.prime();

    try {
      if (box === null) {
        const opened = await open.mutateAsync({ awbNumber: value });
        setBox(opened);
        setLines(opened.expected.map((l) => ({ ...l, scanned: 0 })));
        sound.accepted();
        toast.info(
          opened.alreadyOpen
            ? t('warehousePackPackStation.boxAlreadyOpen')
            : t('warehousePackPackStation.boxOpen', { awbNumber: opened.awbNumber }),
        );
        return;
      }

      if (value === box.awbNumber) {
        try {
          const result = await close.mutateAsync({ packBoxId: box.packBoxId, awbNumber: value });
          sound.accepted();
          toast.success(
            result.manifestNumber
              ? t('warehousePackPackStation.packedManifest', {
                  manifestNumber: result.manifestNumber,
                })
              : t('warehousePackPackStation.packedReadyForPickup'),
          );
          reset();
        } catch (err) {
          fail(err);
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
      sound.accepted();
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
      setRefusalCode(verdictCode(err));
      sound.refused();
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
    setErrorCode(null);
    try {
      const result = await completePack.mutateAsync({
        shipmentId: pending.shipmentId,
        scannedSerials: unitSerials,
      });
      sound.accepted();
      toast.success(
        result.manifestNumber
          ? t('warehousePackPackStation.packedManifest', { manifestNumber: result.manifestNumber })
          : t('warehousePackPackStation.packedReadyForPickup'),
      );
      reset();
    } catch (err) {
      fail(err);
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
    setErrorCode(null);
    try {
      const result = await forceComplete.mutateAsync({
        shipmentId: box.shipmentId,
        reason: forceReason.trim(),
      });
      sound.accepted();
      toast.success(
        result.manifestNumber
          ? t('warehousePackPackStation.packedWithoutScanningManifest', {
              manifestNumber: result.manifestNumber,
            })
          : t('warehousePackPackStation.packedWithoutScanning'),
      );
      setForcing(false);
      setForceReason('');
      reset();
    } catch (err) {
      fail(err);
    }
  }

  async function onCancel(): Promise<void> {
    if (box === null || reason.trim().length < 3) return;
    setError(null);
    setErrorCode(null);
    try {
      const result = await cancel.mutateAsync({ packBoxId: box.packBoxId, reason: reason.trim() });
      sound.accepted();
      toast.info(
        result.releasedScans > 0
          ? t('warehousePackPackStation.boxCancelledScanSReleased', {
              releasedScans: result.releasedScans,
            })
          : t('warehousePackPackStation.boxCancelledParcelBackIn'),
      );
      reset();
    } catch (err) {
      fail(err);
    }
  }

  const busy =
    open.isPending ||
    scan.isPending ||
    close.isPending ||
    cancel.isPending ||
    completePack.isPending;

  // The friendly, three-language words for whatever the server refused.
  // Never undefined: an unknown code gets the generic triple and the raw
  // message still shows beneath it.
  const friendly = packErrorCopy(refusalCode);
  const inlineFriendly = packErrorCopy(errorCode);

  return (
    <div className="wh-stack">
      {/* The whole job, always on screen: 1 label → 2 products → 3 label.
          Followable with the words covered up. */}
      <div className="wh-steps-bar">
        <PackStepStrip current={step} />
        <div className="wh-steps-bar__aside">
          <ScanSoundToggle />
        </div>
      </div>

      {block.data != null && (
        <div className="wh-stop">
          <div className="wh-stop__title">
            <AlertTriangle size={18} /> {t('warehousePackPackStation.scanningIsStopped')}
          </div>
          <p>{block.data.title}</p>
          <p className="wh-pre">{block.data.detail}</p>
          <p>
            {richMessage(t('warehousePackPackStation.putTheBoxAsideAnd'), {
              link: (
                <Link href="/system-issues" className="wh-link">
                  {t('warehousePackPackStation.systemIssues')}
                </Link>
              ),
            })}
          </p>
        </div>
      )}
      {/* While a parcel is waiting on its serials the label field means
          nothing — a scan would open a second box on a bench that is not
          free yet. */}
      {pending === null && block.data == null && (
        <section className="wh-card wh-scan">
          <label htmlFor="pack-scan" className="wh-scan__label">
            {box === null
              ? t('warehousePackPackStation.scanTheShippingLabelTo')
              : t('warehousePackPackStation.scanAProductOrThe')}
          </label>
          {/* The camera is the SAME action by another means, so it sits
              beside the field it belongs to rather than alone at the foot
              of the page. The row wraps below ~34rem, which stacks the
              button under a full-width field instead of squeezing both. */}
          <div className="wh-scan__row wh-scan__row--with-camera">
            <input
              id="pack-scan"
              ref={inputRef}
              value={code}
              // Disabled while a refusal is up: a scan gun types and
              // presses Enter on its own, so an un-blocked field would
              // let the next scan land before anybody read the warning.
              disabled={busy || refusal !== null}
              autoComplete="off"
              placeholder={
                box === null
                  ? t('warehousePackPackStation.shippingLabel')
                  : t('warehousePackPackStation.productBarcodeOrSerial')
              }
              onChange={(e) => setCode(e.target.value)}
              onFocus={() => sound.prime()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onScan(code);
                }
              }}
              className="wh-scan__input"
            />
            <div className="wh-scan__camera">
              <CameraScanButton onClick={() => setCamera(true)} />
            </div>
          </div>
          {box !== null && (
            <>
              <div className="wh-scan__meta">
                {richMessage(t('warehousePackPackStation.boxOpenOnOfScanned'), {
                  span: <span className="sk-ident">{box.awbNumber}</span>,
                  span2: <span className="sk-figure">{done}</span>,
                  span3: <span className="sk-figure">{total}</span>,
                })}
              </div>
              {/* Progress read as progress: a big figure, one tick per
                  piece, and a bar that fills. The fraction stays in the
                  DOM because it is the thing a supervisor reads out. */}
              <div
                className="wh-prog"
                data-complete={complete ? '1' : undefined}
                role="group"
                aria-label={t('warehousePackPackStation.howManyPiecesAreIn')}
              >
                <div className="wh-prog__figure">
                  <span className="wh-prog__done sk-figure">{done}</span>
                  <span className="wh-prog__slash" aria-hidden>
                    /
                  </span>
                  <span className="wh-prog__total sk-figure">{total}</span>
                </div>
                <div className="wh-prog__right">
                  <div className="wh-prog__ticks" aria-hidden>
                    {Array.from({ length: Math.min(total, 24) }, (_, i) => (
                      <span key={i} className="wh-prog__tick" data-on={i < done ? '1' : undefined}>
                        {i < done ? <Check size={14} /> : null}
                      </span>
                    ))}
                  </div>
                  <div className="wh-prog__bar" aria-hidden>
                    <span
                      className="wh-prog__fill"
                      style={{ transform: `scaleX(${total === 0 ? 0 : done / total})` }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* A refusal that is NOT a scan (a close, a cancel, a completion)
          stays inline rather than taking the field away — but it is read by
          the same person, so it carries the same three-language sentence
          above the server's verbatim verdict (FE-2). */}
      {error !== null && (
        <div role="alert" className="wh-alert wh-alert--rich">
          <div className="wh-oops" data-kind={inlineFriendly.kind}>
            <span className="wh-oops__icon" aria-hidden>
              {KIND_ICON[inlineFriendly.kind]}
            </span>
            <div className="wh-tri">
              <p className="wh-tri__line wh-tri__line--lead" lang="en">
                {inlineFriendly.en}
              </p>
              <p className="wh-tri__line" lang="bn">
                {inlineFriendly.bn}
              </p>
              <p className="wh-tri__line" lang="hi">
                {inlineFriendly.hi}
              </p>
            </div>
          </div>
          <p className="wh-verdict">
            <CircleHelp size={14} className="wh-inline-icon" /> <span>{error}</span>
          </p>
        </div>
      )}

      {pending !== null ? (
        <section className="wh-card wh-stack">
          <div>
            <div className="wh-title">
              {richMessage(t('warehousePackPackStation.oneStepLeftOn'), {
                span: <span className="sk-ident">{pending.awbNumber}</span>,
              })}
            </div>
            <p className="wh-note">{t('warehousePackPackStation.theBoxIsClosedAnd')}</p>
          </div>
          <SerialScanner
            id="pack-finish-serials"
            label={t('warehousePackPackStation.unitSerialsInThisParcel')}
            serials={unitSerials}
            onChange={setUnitSerials}
            disabled={busy}
            autoFocus
            hint={t('warehousePackPackStation.noTargetCountHereThe')}
          />
          <div className="wh-row">
            <Button
              variant="primary"
              size="md"
              disabled={busy || unitSerials.length === 0}
              onClick={() => void onFinishPack()}
            >
              {completePack.isPending
                ? t('warehousePackPackStation.finishing')
                : t('warehousePackPackStation.finishPack')}
            </Button>
            <Button variant="ghost" size="md" disabled={busy} onClick={() => reset()}>
              {t('warehousePackPackStation.leaveItForNow')}
            </Button>
          </div>
          <p className="wh-faint">{t('warehousePackPackStation.leavingItDiscardsThisList')}</p>
        </section>
      ) : box === null ? (
        // Nothing in hand — so show what is coming rather than an empty
        // card telling the packer what they already know.
        <PackQueueList />
      ) : (
        <>
          <section
            className="wh-card"
            data-flush="1"
            aria-label={t('warehousePackPackStation.whatGoesInThisBox')}
          >
            <ul className="wh-lines">
              {lines.map((l) => {
                const satisfied = l.scanned >= l.quantity;
                const image = l.imageUrl ?? null;
                return (
                  <li key={l.variantId}>
                    <div className="wh-line" data-done={satisfied ? '1' : undefined}>
                      {/* The picture is how a packer who reads no English
                          matches the line to the thing in their hand, so it
                          leads the row. No image ⇒ a neutral tile, never a
                          broken frame. */}
                      {image === null ? (
                        <div className="wh-line__thumb wh-line__thumb--none" aria-hidden>
                          <ImageOff size={22} />
                        </div>
                      ) : (
                        <img src={image} alt="" className="wh-line__thumb" loading="lazy" />
                      )}
                      <div className="wh-min0 wh-line__text">
                        <div className="wh-line__name">{l.productName}</div>
                        <div className="wh-line__sku sk-ident">{l.skuCode}</div>
                      </div>
                      <div className="wh-line__count sk-figure">
                        <span className="wh-line__state" aria-hidden>
                          {satisfied ? (
                            <Check size={18} className="wh-line__check" />
                          ) : (
                            <ScanLine size={18} className="wh-line__waiting" />
                          )}
                        </span>
                        <span className="wh-line__figure">
                          {l.scanned} / {l.quantity}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {complete && (
            <div className="wh-good">
              <Check size={14} /> {t('warehousePackPackStation.everythingIsInScanThe')}
            </div>
          )}

          <section className="wh-card wh-stack">
            {!cancelling ? (
              // It LOOKS like what it does. As plain ghost text it read as a
              // caption and nobody pressed it; cancelling a box is
              // destructive, so it carries the destructive shape and a bin.
              <div className="wh-row">
                <Button
                  variant="destructive"
                  size="lg"
                  icon={<Trash2 size={18} />}
                  onClick={() => setCancelling(true)}
                >
                  {t('warehousePackPackStation.cancelThisBox')}
                </Button>
              </div>
            ) : (
              <>
                <p className="wh-note">{t('warehousePackPackStation.theScansAreDiscardedAnd')}</p>
                <TextField
                  label={t('warehousePackPackStation.reasonForCancelling')}
                  value={reason}
                  placeholder={t('warehousePackPackStation.whyEGDamagedOuter')}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="wh-row">
                  <Button
                    variant="destructive"
                    size="lg"
                    icon={<Trash2 size={18} />}
                    disabled={reason.trim().length < 3 || cancel.isPending}
                    onClick={() => void onCancel()}
                  >
                    {cancel.isPending
                      ? t('warehousePackPackStation.cancelling')
                      : t('warehousePackPackStation.cancelTheBox')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    icon={<Undo2 size={18} />}
                    onClick={() => setCancelling(false)}
                  >
                    {t('warehousePackPackStation.keepPacking')}
                  </Button>
                </div>
              </>
            )}

            {/* The escape hatch, and only for somebody who can carry
                it: a packer must not be able to waive the check they
                are the one performing. Cosmetic here — the server
                holds the permission (FE-2). */}
            {canForce && !cancelling && (
              <div className="wh-stack wh-divide">
                {!forcing ? (
                  // An ORDINARY action (it only opens a reason field; the
                  // server holds the permission), so a secondary button —
                  // but a button, with a shape and an icon. It was plain
                  // text and read as a caption.
                  <div className="wh-row">
                    <Button
                      variant="secondary"
                      size="lg"
                      icon={<Ban size={18} />}
                      onClick={() => setForcing(true)}
                    >
                      {t('warehousePackPackStation.theseProductsHaveNoLabels')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="wh-note">
                      {t('warehousePackPackStation.thisPacksTheParcelWithout')}
                    </p>
                    <TextField
                      label={t('warehousePackPackStation.reasonForPackingWithoutScanning')}
                      value={forceReason}
                      placeholder={t('warehousePackPackStation.whyEGStockReceived')}
                      onChange={(e) => setForceReason(e.target.value)}
                    />
                    <div className="wh-row">
                      <Button
                        variant="destructive"
                        size="lg"
                        icon={<Ban size={18} />}
                        disabled={forceReason.trim().length < 20 || forceComplete.isPending}
                        onClick={() => void onForceComplete()}
                      >
                        {forceComplete.isPending
                          ? t('warehousePackPackStation.packing')
                          : t('warehousePackPackStation.packWithoutScanning')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="lg"
                        icon={<Undo2 size={18} />}
                        onClick={() => setForcing(false)}
                      >
                        {t('warehousePackPackStation.back')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
      {/* MOVED (owner, 2026-11-10): the camera button used to sit here, at
          the foot of the page, far from the field it belongs to — so it
          read as unrelated to scanning. It is now inside the scan row. */}
      <BarcodeCamera
        open={camera}
        onClose={() => setCamera(false)}
        onScan={(scanned) => {
          setCamera(false);
          setCode(scanned);
          void onScan(scanned);
        }}
        title={
          box === null
            ? t('warehousePackPackStation.scanTheShippingLabel')
            : t('warehousePackPackStation.scanAProduct')
        }
      />

      {/* A refusal STOPS the bench. The packer says they have fixed it
          before anything else can be scanned — which is the difference
          between a warning and a gate. */}
      <Dialog
        open={refusal !== null}
        onOpenChange={(o) => {
          if (!o) {
            dismissRefusal();
            inputRef.current?.focus();
          }
        }}
        title={t('warehousePackPackStation.thatScanWasRefused')}
        tone="critical"
        icon={KIND_ICON[friendly.kind]}
        footer={
          <DialogFooter>
            <Button
              size="lg"
              fullWidth
              icon={<Check size={18} />}
              // The accessible name stays the ONE translated sentence even
              // though the eye reads three — a stable name for assistive
              // tech, three languages for the packer.
              aria-label={t('warehousePackPackStation.iHaveFixedIt')}
              onClick={() => {
                dismissRefusal();
                inputRef.current?.focus();
              }}
            >
              <span className="wh-tri wh-tri--btn">
                {DISMISS_TRIPLE.map((line, i) => (
                  <span key={i} className="wh-tri__line">
                    {line}
                  </span>
                ))}
              </span>
            </Button>
          </DialogFooter>
        }
      >
        {/*
          THREE LANGUAGES AT ONCE, ON PURPOSE (do not "fix" this to one).
          Every other string on this screen goes through t() in the chosen
          locale. Here English, Bangla and Hindi all show, one under the
          other, because the packer may read none of them, cannot
          necessarily change the language setting, and the person called
          over to help may read a different one. See pack-error-copy.ts.
        */}
        <div className="wh-oops" data-kind={friendly.kind}>
          <span className="wh-oops__icon" aria-hidden>
            {KIND_ICON[friendly.kind]}
          </span>
          <div className="wh-tri">
            <p className="wh-tri__line wh-tri__line--lead" lang="en">
              {friendly.en}
            </p>
            <p className="wh-tri__line" lang="bn">
              {friendly.bn}
            </p>
            <p className="wh-tri__line" lang="hi">
              {friendly.hi}
            </p>
          </div>
        </div>
        {/* FE-2 — the server's own verdict, VERBATIM, never hidden and
            never contradicted. Small and secondary: it is for whoever is
            called over, not for the packer. */}
        <p className="wh-verdict">
          <CircleHelp size={14} className="wh-inline-icon" /> <span>{refusal}</span>
        </p>
        <p className="wh-note wh-gap-top">{t('warehousePackPackStation.nothingWasAddedToThe')}</p>
      </Dialog>
    </div>
  );
}
