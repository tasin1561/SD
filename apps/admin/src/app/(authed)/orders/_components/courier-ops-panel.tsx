'use client';

import { useState, type ReactElement } from 'react';
import { ExternalLink, FileText, Truck } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DescriptionList,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Money,
  Num,
  Skeleton,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import {
  useAttachEwaybill,
  useCancelWithCourier,
  useEditShipment,
  useFetchDocument,
  useNdrAction,
  useNdrReadiness,
  useShipmentInsight,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const MIN_CANCEL_REASON = 10;

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
}: {
  readonly shipmentId: string;
  readonly awbNumber: string | null;
  readonly isManualCourier: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);

  if (isManualCourier) {
    return (
      <p className="text-text-faint text-xs">
        Placed manually with a non-integrated courier — arrange any change
        directly with them.
      </p>
    );
  }
  if (awbNumber === null) {
    return (
      <p className="text-text-faint text-xs">
        No AWB yet. Courier actions become available once one is issued.
      </p>
    );
  }

  return open ? (
    <CourierOpsBody shipmentId={shipmentId} onClose={() => setOpen(false)} />
  ) : (
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
      <Truck size={13} aria-hidden /> Courier actions &amp; costs
    </Button>
  );
}

function CourierOpsBody({
  shipmentId,
  onClose,
}: {
  readonly shipmentId: string;
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

  async function getDocument(docType: string): Promise<void> {
    try {
      const r = await document.mutateAsync({ shipmentId, docType });
      if (r.url === null) {
        toast.error(
          r.message ??
            'The courier holds no such document for this parcel. They only serve documents they have not archived.',
        );
        return;
      }
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  async function takeNdrAction(): Promise<void> {
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
      toast.error(serverVerdict(err));
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
    <Card className="mt-2">
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-text-muted text-xs font-medium tracking-wide uppercase">
            Courier
          </h4>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Hide
          </Button>
        </div>

        {insight.isError ? (
          <ErrorNote
            message={serverVerdict(insight.error)}
            retry={() => void insight.refetch()}
          />
        ) : insight.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <DescriptionList
              columns={3}
              items={[
                {
                  label: 'Expected transit',
                  value:
                    insight.data?.tat?.tatDays == null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <Num value={insight.data.tat.tatDays} suffix=" days" />
                    ),
                },
                {
                  label: 'Courier cost',
                  value:
                    insight.data?.cost == null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <Money amount={insight.data.cost.totalInr} />
                    ),
                },
                {
                  label: 'Their zone',
                  value: insight.data?.cost?.zone ?? (
                    <span className="text-text-faint">—</span>
                  ),
                },
              ]}
            />

            {(insight.data?.unavailable.length ?? 0) > 0 && (
              <ul className="text-text-faint space-y-1 text-xs">
                {insight.data?.unavailable.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ── evidence ── */}
        <div className="border-border flex flex-wrap gap-2 border-t pt-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={document.isPending}
            onClick={() => void getDocument('EPOD')}
          >
            <FileText size={13} aria-hidden /> Proof of delivery
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={document.isPending}
            onClick={() => void getDocument('SIGNATURE_URL')}
          >
            Signature <ExternalLink size={12} aria-hidden />
          </Button>
        </div>

        {/* ── NDR ── */}
        <div className="border-border border-t pt-3">
          {readiness.isLoading ? (
            <Skeleton className="h-4 w-2/3" />
          ) : readiness.data?.eligible === true ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={ndr.isPending}
                onClick={() => void takeNdrAction()}
              >
                {ndr.isPending ? 'Requesting…' : 'Request another delivery attempt'}
              </Button>
              <span className="text-text-faint text-xs">
                after {readiness.data.attemptCount} failed attempt
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
            <p className="text-text-faint text-xs leading-relaxed">
              Re-attempt unavailable
              {readiness.data?.reason === null || readiness.data?.reason === undefined
                ? '.'
                : `: ${readiness.data.reason}`}
            </p>
          )}
        </div>

        {/* ── corrections ── */}
        <div className="border-border flex flex-wrap gap-2 border-t pt-3">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Correct recipient
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEwaybilling(true)}>
            Attach e-way bill
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmCancel(true)}
          >
            Cancel with courier
          </Button>
        </div>
      </CardBody>

      <EditRecipientModal
        shipmentId={shipmentId}
        open={editing}
        onOpenChange={setEditing}
      />
      <EwaybillModal
        shipmentId={shipmentId}
        open={ewaybilling}
        onOpenChange={setEwaybilling}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this parcel with the courier?"
        confirmVariant="destructive"
        confirmLabel={cancel.isPending ? 'Cancelling…' : 'Cancel parcel'}
        disabled={
          cancel.isPending || cancelReason.trim().length < MIN_CANCEL_REASON
        }
        onConfirm={() => void doCancel()}
        description={
          <div className="space-y-2">
            <p>
              A parcel already in transit does not vanish — it becomes a return
              and comes back to us, at the cost of a return leg. Only a
              not-yet-collected parcel stops where it is.
            </p>
            <p className="text-text-faint">
              The order is not moved by this action; the courier&apos;s own scans
              will move it.
            </p>
            <Textarea
              rows={2}
              placeholder="Why is this being pulled?"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
        }
      />
    </Card>
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

  const anything =
    name.trim() !== '' || phone.trim() !== '' || address.trim() !== '';

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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Correct the recipient"
      description="Only the fields you fill are changed. Delhivery refuses edits on parcels already dispatched or in a terminal state."
    >
      <div className="space-y-3">
        <FormField label="Name" htmlFor="edit-name">
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Phone" htmlFor="edit-phone">
          <Input
            id="edit-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919812345678"
          />
        </FormField>
        <FormField label="Address" htmlFor="edit-address">
          <Textarea
            id="edit-address"
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>
        {error !== null && <ErrorNote message={error} />}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={!anything || edit.isPending}
          onClick={() => void submit()}
        >
          {edit.isPending ? 'Sending…' : 'Send correction'}
        </Button>
      </ModalFooter>
    </Modal>
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Attach an e-way bill"
      description="Required by law above ₹50,000 of goods. Moving them without one risks the consignment being detained and penalised."
    >
      <div className="space-y-3">
        <FormField
          label="Invoice number"
          htmlFor="ewb-invoice"
          hint="The invoice the e-way bill was raised against."
          required
        >
          <Input
            id="ewb-invoice"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </FormField>
        <FormField label="E-way bill number" htmlFor="ewb-number" required>
          <Input
            id="ewb-number"
            value={ewaybillNumber}
            onChange={(e) => setEwaybillNumber(e.target.value)}
          />
        </FormField>
        {error !== null && <ErrorNote message={error} />}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={
            invoiceNumber.trim() === '' ||
            ewaybillNumber.trim() === '' ||
            attach.isPending
          }
          onClick={() => void submit()}
        >
          {attach.isPending ? 'Attaching…' : 'Attach'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
