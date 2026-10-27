'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import {
  ExternalLink,
  FileText,
  PenLine,
  RotateCcw,
  TriangleAlert,
  Truck,
  XCircle,
} from 'lucide-react';
import { Ident, Money, Num, openExternalWhenReady } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useAttachEwaybill,
  useCancelWithCourier,
  useRecordCancelledOutside,
  useEditShipment,
  useFetchDocument,
  useNdrAction,
  useNdrReadiness,
  useShipmentInsight,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { Facts } from './order-ops-parts';
import './order-shipping.css';
import { useT } from '@/i18n/client';

const MIN_CANCEL_REASON = 10;

/**
 * A confirm that restates the waybill and the consequence, whose confirm
 * button stays DISABLED until the reason meets the server's floor —
 * exactly as the legacy confirm gated it. The app `ConfirmDialog` has no
 * `disabled`, so this draws the same restating layout (`sk-confirm`) on
 * the app `Dialog` rather than let a click through that the old dialog
 * refused.
 */
function ReasonConfirm({
  open,
  onOpenChange,
  title,
  entity,
  consequence,
  note,
  confirmLabel,
  busyLabel,
  busy,
  disabled,
  destructive,
  onConfirm,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly entity: string | null;
  readonly consequence: string;
  readonly note?: string | undefined;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly destructive: boolean;
  readonly onConfirm: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      tone={destructive ? 'critical' : 'default'}
      icon={destructive ? <TriangleAlert size={18} /> : <PenLine size={18} />}
      title={title}
      locked={busy}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('ordersCourierOpsPanel.cancel')}
          </Button>
          <AsyncButton
            variant={destructive ? 'destructive' : 'primary'}
            labels={{ idle: confirmLabel, busy: busyLabel }}
            state={busy ? 'busy' : 'idle'}
            disabled={disabled}
            onClick={onConfirm}
          />
        </DialogFooter>
      }
    >
      <div className="sk-confirm">
        {entity !== null && (
          <div className="sk-confirm__subject">
            <span className="sk-confirm__entity sk-ident">{entity}</span>
          </div>
        )}
        <p className="sk-confirm__consequence">{consequence}</p>
        {note !== undefined && <p className="os-note">{note}</p>}
        {children}
      </div>
    </Dialog>
  );
}

/**
 * What the courier says about this parcel, and what we can ask it to do.
 *
 * Collapsed by default: it costs live courier calls to populate, and an
 * operator opening an order to check its status does not need a lane
 * priced. Opening it is the consent to spend the lookup.
 *
 * FE-2 throughout — every refusal here comes from the server (the
 * write guard, Delhivery's own status rules, the NDR eligibility table)
 * and is shown verbatim. The one thing the UI decides locally is
 * whether to *offer* the NDR button, and even that reads the server's
 * readiness verdict rather than reimplementing it.
 */
export function CourierOpsPanel({
  shipmentId,
  awbNumber,
  isManualCourier,
  status,
  courierCancelledAt,
}: {
  readonly shipmentId: string;
  readonly awbNumber: string | null;
  readonly isManualCourier: boolean;
  /** CANCELLED = voided with its order; only the waybill cancel applies. */
  readonly status: string;
  readonly courierCancelledAt: string | null;
}): ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (isManualCourier) {
    return <p className="os-note">{t('ordersCourierOpsPanel.placedManuallyWithANon')}</p>;
  }
  if (status === 'CANCELLED') {
    return (
      <VoidedWaybill
        shipmentId={shipmentId}
        awbNumber={awbNumber}
        courierCancelledAt={courierCancelledAt}
      />
    );
  }
  if (awbNumber === null) {
    return <p className="os-note">{t('ordersCourierOpsPanel.noAwbYetCourierActions')}</p>;
  }

  return open ? (
    <CourierOpsBody shipmentId={shipmentId} awbNumber={awbNumber} onClose={() => setOpen(false)} />
  ) : (
    <div className="os-tools">
      <Button variant="ghost" size="sm" icon={<Truck size={14} />} onClick={() => setOpen(true)}>
        {t('ordersCourierOpsPanel.courierActionsCosts')}
      </Button>
    </div>
  );
}

function CourierOpsBody({
  shipmentId,
  awbNumber,
  onClose,
}: {
  readonly shipmentId: string;
  readonly awbNumber: string;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const insight = useShipmentInsight(shipmentId);
  const readiness = useNdrReadiness(shipmentId);
  const document = useFetchDocument();
  const ndr = useNdrAction();
  const cancel = useCancelWithCourier();

  const [editing, setEditing] = useState(false);
  const [ewaybilling, setEwaybilling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmNdr, setConfirmNdr] = useState(false);
  const [ndrError, setNdrError] = useState<string | null>(null);

  async function getDocument(docType: string): Promise<void> {
    try {
      // The tab is opened inside the click and filled when the URL
      // arrives — a window.open AFTER the await has left the user
      // gesture and the blocker eats it, so the document silently never
      // appears.
      await openExternalWhenReady(async () => {
        const r = await document.mutateAsync({ shipmentId, docType });
        if (r.url === null) {
          toast.error(r.message ?? t('ordersCourierOpsPanel.theCourierHoldsNoSuch'));
          return null;
        }
        return r.url;
      });
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  // Now behind a confirm that restates the waybill (it sends a van). The
  // request is the same; a refusal stays on the confirm, verbatim.
  async function takeNdrAction(): Promise<void> {
    setNdrError(null);
    try {
      const r = await ndr.mutateAsync({ shipmentId, action: 'RE-ATTEMPT' });
      // Delhivery answers asynchronously — saying "re-attempt booked"
      // here would claim more than we know.
      toast.success(
        r.uplId === null
          ? (r.message ?? t('ordersCourierOpsPanel.requestSubmitted'))
          : t('ordersCourierOpsPanel.requestSubmittedRefDelhiveryConfirms', { uplId: r.uplId }),
      );
    } catch (err) {
      setNdrError(serverVerdict(err));
      throw err;
    }
  }

  async function doCancel(): Promise<void> {
    try {
      await cancel.mutateAsync({ shipmentId, reason: cancelReason.trim() });
      toast.success(t('ordersCourierOpsPanel.cancellationSentAParcelAlready'));
      setConfirmCancel(false);
      setCancelReason('');
    } catch (err) {
      toast.error(serverVerdict(err));
      setConfirmCancel(false);
    }
  }

  return (
    <div className="os-panel">
      <div className="oo-card__head">
        <p className="oo-card__title">{t('ordersCourierOpsPanel.courier')}</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('ordersCourierOpsPanel.hide')}
        </Button>
      </div>

      {insight.isError ? (
        <ErrorState message={serverVerdict(insight.error)} retry={() => void insight.refetch()} />
      ) : insight.isLoading ? (
        <div
          className="os-skel"
          role="status"
          aria-label={t('ordersCourierOpsPanel.loadingCourierDetails')}
        >
          <Skeleton width="75%" height={14} />
          <Skeleton width="50%" height={14} />
        </div>
      ) : (
        <>
          <Facts
            items={[
              {
                label: t('ordersCourierOpsPanel.expectedTransit'),
                value:
                  insight.data?.tat?.tatDays == null ? (
                    <span className="oo-faint">—</span>
                  ) : (
                    <Num value={insight.data.tat.tatDays} suffix=" days" />
                  ),
              },
              {
                label: t('ordersCourierOpsPanel.courierCost'),
                value:
                  insight.data?.cost == null ? (
                    <span className="oo-faint">—</span>
                  ) : (
                    <Money amount={insight.data.cost.totalInr} />
                  ),
              },
              {
                label: t('ordersCourierOpsPanel.theirZone'),
                value: insight.data?.cost?.zone ?? <span className="oo-faint">—</span>,
              },
            ]}
          />

          {(insight.data?.unavailable.length ?? 0) > 0 && (
            <ul className="oo-list oo-faint">
              {insight.data?.unavailable.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── evidence ── */}
      <div className="os-panel__block">
        <div className="os-tools">
          <Button
            variant="secondary"
            size="sm"
            icon={<FileText size={14} />}
            disabled={document.isPending}
            onClick={() => void getDocument('EPOD')}
          >
            {t('ordersCourierOpsPanel.proofOfDelivery')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconRight={<ExternalLink size={13} />}
            disabled={document.isPending}
            onClick={() => void getDocument('SIGNATURE_URL')}
          >
            {t('ordersCourierOpsPanel.signature')}
          </Button>
        </div>
      </div>

      {/* ── NDR ── */}
      <div className="os-panel__block">
        {readiness.isLoading ? (
          <Skeleton width="66%" height={14} />
        ) : readiness.data?.eligible === true ? (
          <div className="os-tools">
            <Button
              variant="primary"
              size="sm"
              icon={<RotateCcw size={14} />}
              disabled={ndr.isPending}
              onClick={() => {
                setNdrError(null);
                setConfirmNdr(true);
              }}
            >
              {ndr.isPending
                ? t('ordersCourierOpsPanel.requesting')
                : t('ordersCourierOpsPanel.requestAnotherDeliveryAttempt')}
            </Button>
            <span className="os-note">
              after <span className="sk-figure">{readiness.data.attemptCount}</span> failed attempt
              {readiness.data.attemptCount === 1 ? '' : 's'}
              {readiness.data.nslCode !== null && (
                <>
                  {' · '}
                  <Ident value={readiness.data.nslCode} />
                </>
              )}
            </span>
          </div>
        ) : (
          // The server's verdict, not a guess. Saying WHY a re-attempt
          // is unavailable is the difference between a disabled button
          // and a useful one.
          <p className="os-note">
            {t('ordersCourierOpsPanel.reAttemptUnavailable', {
              value:
                readiness.data?.reason === null || readiness.data?.reason === undefined
                  ? '.'
                  : `: ${readiness.data.reason}`,
            })}
          </p>
        )}
      </div>

      {/* ── corrections ── */}
      <div className="os-panel__block">
        <div className="os-tools">
          <Button
            variant="secondary"
            size="sm"
            icon={<PenLine size={14} />}
            onClick={() => setEditing(true)}
          >
            {t('ordersCourierOpsPanel.correctRecipient')}
          </Button>
          {/*
            DELISTED, NOT DELETED — "Attach e-way bill" (2026-09-19).

            An e-way bill is required above ₹50,000
            (EWAYBILL_THRESHOLD_INR). The owner's figure is that no
            parcel Skydrop ships exceeds ₹10,000, so this control
            applied to nothing on the floor while sitting between two
            buttons that are used every day — and it only ever worked on
            Delhivery (it reached their API whatever carrier held the
            parcel, which is the bug CUR-12 now stops in the dispatcher).

            The endpoint and the modal below both stay: this is one line
            away the day a parcel above the threshold is normal, and
            deleting it would mean rebuilding it from scratch to answer
            a question the codebase has already answered.
          */}
          <Button
            variant="destructive"
            size="sm"
            icon={<XCircle size={14} />}
            onClick={() => setConfirmCancel(true)}
          >
            {t('ordersCourierOpsPanel.cancelWithCourier')}
          </Button>
        </div>
      </div>

      <EditRecipientModal shipmentId={shipmentId} open={editing} onOpenChange={setEditing} />
      <EwaybillModal shipmentId={shipmentId} open={ewaybilling} onOpenChange={setEwaybilling} />
      <ConfirmDialog
        open={confirmNdr}
        onOpenChange={(next) => {
          setConfirmNdr(next);
          if (!next) setNdrError(null);
        }}
        title={t('ordersCourierOpsPanel.requestAnotherDeliveryAttempt2')}
        entity={awbNumber}
        entityIsIdentifier
        consequence={t('ordersCourierOpsPanel.theCourierIsAskedTo')}
        confirmLabel={t('ordersCourierOpsPanel.requestTheAttempt')}
        onConfirm={takeNdrAction}
        error={ndrError ?? undefined}
      />
      <ReasonConfirm
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('ordersCourierOpsPanel.cancelThisParcelWithThe')}
        entity={awbNumber}
        consequence={t('ordersCourierOpsPanel.aParcelAlreadyInTransit')}
        note={t('ordersCourierOpsPanel.theOrderIsNotMoved')}
        destructive
        confirmLabel={t('ordersCourierOpsPanel.cancelParcel')}
        busyLabel={t('ordersCourierOpsPanel.cancelling')}
        busy={cancel.isPending}
        disabled={cancel.isPending || cancelReason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doCancel()}
      >
        <TextArea
          label={t('ordersCourierOpsPanel.reason')}
          rows={2}
          placeholder={t('ordersCourierOpsPanel.whyIsThisBeingPulled')}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        />
      </ReasonConfirm>
    </div>
  );
}

/**
 * A shipment voided because its order was cancelled or rejected.
 *
 * Its waybill was booked (and charged) at confirmation and stays live
 * with the courier until it is cancelled with them — only then is the
 * charge credited back. Cancelling it is the one courier action left, so
 * it is the only one offered; insight, NDR and edits make no sense on a
 * parcel that is not going anywhere. The server decides whether it is
 * allowed (FE-2) and its refusal is shown verbatim.
 */
function VoidedWaybill({
  shipmentId,
  awbNumber,
  courierCancelledAt,
}: {
  readonly shipmentId: string;
  readonly awbNumber: string | null;
  readonly courierCancelledAt: string | null;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const cancel = useCancelWithCourier();
  const recordOutside = useRecordCancelledOutside();
  const [confirming, setConfirming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reason, setReason] = useState('');

  if (awbNumber === null) {
    return <p className="os-note">{t('ordersCourierOpsPanel.voidedWithItsOrderIt')}</p>;
  }
  if (courierCancelledAt !== null) {
    return (
      <p className="os-note">
        Voided with its order. Waybill cancelled with the courier on{' '}
        <span className="sk-figure">
          {new Date(courierCancelledAt).toISOString().slice(0, 16).replace('T', ' ')}
        </span>{' '}
        UTC.
      </p>
    );
  }

  async function doCancel(): Promise<void> {
    try {
      const r = await cancel.mutateAsync({ shipmentId, reason: reason.trim() });
      if (r.success) {
        toast.success(t('ordersCourierOpsPanel.theCourierAcceptedTheCancellation'));
      } else {
        toast.error(r.message ?? t('ordersCourierOpsPanel.theCourierDidNotAccept'));
      }
      setConfirming(false);
      setReason('');
    } catch (err) {
      toast.error(serverVerdict(err));
      setConfirming(false);
    }
  }

  async function doRecordOutside(): Promise<void> {
    try {
      const r = await recordOutside.mutateAsync({ shipmentId, reason: reason.trim() });
      toast.success(r.message ?? t('ordersCourierOpsPanel.recordedAsCancelledOutsideSkydrop'));
      setRecording(false);
      setReason('');
    } catch (err) {
      toast.error(serverVerdict(err));
      setRecording(false);
    }
  }

  return (
    <div className="os-panel">
      <p className="os-warn-line">
        Voided with its order, but waybill <Ident value={awbNumber} /> is still live with the
        courier. Cancel it so the booking charge is credited back.
      </p>
      <div className="os-tools">
        <Button
          variant="destructive"
          size="sm"
          icon={<XCircle size={14} />}
          onClick={() => setConfirming(true)}
        >
          {t('ordersCourierOpsPanel.cancelWaybillWithCourier')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
          {t('ordersCourierOpsPanel.markCancelledOutsideSkydrop')}
        </Button>
      </div>
      <ReasonConfirm
        open={recording}
        onOpenChange={setRecording}
        title={t('ordersCourierOpsPanel.recordThisWaybillAsCancelled')}
        entity={awbNumber}
        consequence={t('ordersCourierOpsPanel.useThisOnlyWhenThe')}
        destructive={false}
        confirmLabel={t('ordersCourierOpsPanel.recordAsCancelled')}
        busyLabel={t('ordersCourierOpsPanel.recording')}
        busy={recordOutside.isPending}
        disabled={recordOutside.isPending || reason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doRecordOutside()}
      >
        <TextArea
          label={t('ordersCourierOpsPanel.howWasItCancelled')}
          rows={2}
          placeholder={t('ordersCourierOpsPanel.howWasItCancelledE')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ReasonConfirm>
      <ReasonConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title={t('ordersCourierOpsPanel.cancelThisWaybillWithThe')}
        entity={awbNumber}
        consequence={t('ordersCourierOpsPanel.theOrderIsAlreadyCancelled')}
        destructive
        confirmLabel={t('ordersCourierOpsPanel.cancelWaybill')}
        busyLabel={t('ordersCourierOpsPanel.cancelling')}
        busy={cancel.isPending}
        disabled={cancel.isPending || reason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doCancel()}
      >
        <TextArea
          label={t('ordersCourierOpsPanel.reason')}
          rows={2}
          placeholder={t('ordersCourierOpsPanel.whyEGOrderCancelled')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ReasonConfirm>
    </div>
  );
}

function EditRecipientModal({
  shipmentId,
  open,
  onOpenChange,
}: {
  readonly shipmentId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const edit = useEditShipment();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const anything = name.trim() !== '' || phone.trim() !== '' || address.trim() !== '';

  async function submit(): Promise<void> {
    setError(null);
    try {
      await edit.mutateAsync({
        shipmentId,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
        ...(address.trim() === '' ? {} : { address: address.trim() }),
      });
      toast.success(t('ordersCourierOpsPanel.correctionSentToTheCourier'));
      setName('');
      setPhone('');
      setAddress('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<PenLine size={18} />}
      title={t('ordersCourierOpsPanel.correctTheRecipient')}
      description={t('ordersCourierOpsPanel.onlyTheFieldsYouFill')}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('ordersCourierOpsPanel.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{
              idle: t('ordersCourierOpsPanel.sendCorrection'),
              busy: t('ordersCourierOpsPanel.sending'),
            }}
            state={edit.isPending ? 'busy' : 'idle'}
            disabled={!anything || edit.isPending}
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="os-fields">
        <TextField
          id="edit-name"
          label={t('ordersCourierOpsPanel.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="edit-phone"
          label={t('ordersCourierOpsPanel.phone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+919812345678"
        />
        <TextArea
          id="edit-address"
          label={t('ordersCourierOpsPanel.address')}
          rows={3}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        {error !== null && (
          <p className="oo-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function EwaybillModal({
  shipmentId,
  open,
  onOpenChange,
}: {
  readonly shipmentId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const attach = useAttachEwaybill();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [ewaybillNumber, setEwaybillNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await attach.mutateAsync({
        shipmentId,
        invoiceNumber: invoiceNumber.trim(),
        ewaybillNumber: ewaybillNumber.trim(),
      });
      toast.success(t('ordersCourierOpsPanel.eWayBillAttached'));
      setInvoiceNumber('');
      setEwaybillNumber('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<FileText size={18} />}
      title={t('ordersCourierOpsPanel.attachAnEWayBill')}
      description={t('ordersCourierOpsPanel.requiredByLawAbove50')}
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('ordersCourierOpsPanel.cancel')}
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{
              idle: t('ordersCourierOpsPanel.attach'),
              busy: t('ordersCourierOpsPanel.attaching'),
            }}
            state={attach.isPending ? 'busy' : 'idle'}
            disabled={
              invoiceNumber.trim() === '' || ewaybillNumber.trim() === '' || attach.isPending
            }
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="os-fields">
        <TextField
          id="ewb-invoice"
          label={t('ordersCourierOpsPanel.invoiceNumber')}
          hint={t('ordersCourierOpsPanel.theInvoiceTheEWay')}
          requiredMark
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
        />
        <TextField
          id="ewb-number"
          label={t('ordersCourierOpsPanel.eWayBillNumber')}
          requiredMark
          value={ewaybillNumber}
          onChange={(e) => setEwaybillNumber(e.target.value)}
        />
        {error !== null && (
          <p className="oo-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
