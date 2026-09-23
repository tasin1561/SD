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
            Cancel
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
  const [open, setOpen] = useState(false);

  if (isManualCourier) {
    return (
      <p className="os-note">
        Placed manually with a non-integrated courier — arrange any change directly with them.
      </p>
    );
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
    return (
      <p className="os-note">No AWB yet. Courier actions become available once one is issued.</p>
    );
  }

  return open ? (
    <CourierOpsBody shipmentId={shipmentId} awbNumber={awbNumber} onClose={() => setOpen(false)} />
  ) : (
    <div className="os-tools">
      <Button variant="ghost" size="sm" icon={<Truck size={14} />} onClick={() => setOpen(true)}>
        Courier actions &amp; costs
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
          toast.error(
            r.message ??
              'The courier holds no such document for this parcel. They only serve documents they have not archived.',
          );
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
          ? (r.message ?? 'Request submitted.')
          : `Request submitted (ref ${r.uplId}). Delhivery confirms separately.`,
      );
    } catch (err) {
      setNdrError(serverVerdict(err));
      throw err;
    }
  }

  async function doCancel(): Promise<void> {
    try {
      await cancel.mutateAsync({ shipmentId, reason: cancelReason.trim() });
      toast.success(
        'Cancellation sent. A parcel already moving comes back as a return; its scans will move the order.',
      );
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
        <p className="oo-card__title">Courier</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Hide
        </Button>
      </div>

      {insight.isError ? (
        <ErrorState message={serverVerdict(insight.error)} retry={() => void insight.refetch()} />
      ) : insight.isLoading ? (
        <div className="os-skel" role="status" aria-label="Loading courier details">
          <Skeleton width="75%" height={14} />
          <Skeleton width="50%" height={14} />
        </div>
      ) : (
        <>
          <Facts
            items={[
              {
                label: 'Expected transit',
                value:
                  insight.data?.tat?.tatDays == null ? (
                    <span className="oo-faint">—</span>
                  ) : (
                    <Num value={insight.data.tat.tatDays} suffix=" days" />
                  ),
              },
              {
                label: 'Courier cost',
                value:
                  insight.data?.cost == null ? (
                    <span className="oo-faint">—</span>
                  ) : (
                    <Money amount={insight.data.cost.totalInr} />
                  ),
              },
              {
                label: 'Their zone',
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
            Proof of delivery
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconRight={<ExternalLink size={13} />}
            disabled={document.isPending}
            onClick={() => void getDocument('SIGNATURE_URL')}
          >
            Signature
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
              {ndr.isPending ? 'Requesting…' : 'Request another delivery attempt'}
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
            Re-attempt unavailable
            {readiness.data?.reason === null || readiness.data?.reason === undefined
              ? '.'
              : `: ${readiness.data.reason}`}
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
            Correct recipient
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
            Cancel with courier
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
        title="Request another delivery attempt?"
        entity={awbNumber}
        entityIsIdentifier
        consequence="The courier is asked to send its van out to the customer again; it confirms separately, and only its own scans move the order."
        confirmLabel="Request the attempt"
        onConfirm={takeNdrAction}
        error={ndrError ?? undefined}
      />
      <ReasonConfirm
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this parcel with the courier?"
        entity={awbNumber}
        consequence="A parcel already in transit does not vanish — it becomes a return and comes back to us, at the cost of a return leg. Only a not-yet-collected parcel stops where it is."
        note="The order is not moved by this action; the courier's own scans will move it."
        destructive
        confirmLabel="Cancel parcel"
        busyLabel="Cancelling…"
        busy={cancel.isPending}
        disabled={cancel.isPending || cancelReason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doCancel()}
      >
        <TextArea
          label="Reason"
          rows={2}
          placeholder="Why is this being pulled?"
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
  const toast = useToast();
  const cancel = useCancelWithCourier();
  const recordOutside = useRecordCancelledOutside();
  const [confirming, setConfirming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reason, setReason] = useState('');

  if (awbNumber === null) {
    return (
      <p className="os-note">
        Voided with its order. It never had a waybill, so there is nothing at the courier.
      </p>
    );
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
        toast.success('The courier accepted the cancellation. The waybill is closed.');
      } else {
        toast.error(r.message ?? 'The courier did not accept the cancellation.');
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
      toast.success(r.message ?? 'Recorded as cancelled outside Skydrop.');
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
          Cancel waybill with courier
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRecording(true)}>
          Mark cancelled outside Skydrop
        </Button>
      </div>
      <ReasonConfirm
        open={recording}
        onOpenChange={setRecording}
        title="Record this waybill as cancelled outside Skydrop?"
        entity={awbNumber}
        consequence="Use this only when the waybill was already cancelled in the courier's own portal or by phone. Skydrop does NOT call the courier; it records your word, and the record says so."
        destructive={false}
        confirmLabel="Record as cancelled"
        busyLabel="Recording…"
        busy={recordOutside.isPending}
        disabled={recordOutside.isPending || reason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doRecordOutside()}
      >
        <TextArea
          label="How was it cancelled?"
          rows={2}
          placeholder="How was it cancelled? e.g. cancelled in the Delhivery portal on 12 Sep"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ReasonConfirm>
      <ReasonConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this waybill with the courier?"
        entity={awbNumber}
        consequence="The order is already cancelled. This asks the courier to close the waybill it booked, which is what credits the booking charge back. The order does not change."
        destructive
        confirmLabel="Cancel waybill"
        busyLabel="Cancelling…"
        busy={cancel.isPending}
        disabled={cancel.isPending || reason.trim().length < MIN_CANCEL_REASON}
        onConfirm={() => void doCancel()}
      >
        <TextArea
          label="Reason"
          rows={2}
          placeholder="Why? e.g. order cancelled before pickup"
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
      toast.success('Correction sent to the courier.');
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
      title="Correct the recipient"
      description="Only the fields you fill are changed. Delhivery refuses edits on parcels already dispatched or in a terminal state."
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{ idle: 'Send correction', busy: 'Sending…' }}
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
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="edit-phone"
          label="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+919812345678"
        />
        <TextArea
          id="edit-address"
          label="Address"
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
      toast.success('E-way bill attached.');
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
      title="Attach an e-way bill"
      description="Required by law above ₹50,000 of goods. Moving them without one risks the consignment being detained and penalised."
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{ idle: 'Attach', busy: 'Attaching…' }}
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
          label="Invoice number"
          hint="The invoice the e-way bill was raised against."
          requiredMark
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
        />
        <TextField
          id="ewb-number"
          label="E-way bill number"
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
