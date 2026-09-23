'use client';

import { useState, type ReactElement } from 'react';
import { Ban, Send } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useCancelManualPlacement, usePlaceManualAwb } from '@/lib/api-hooks';
import { Notice } from './order-ops-parts';
import './order-shipping.css';

/**
 * The fallback when no integrated courier will carry a parcel (CUR-8).
 *
 * ── WHY THIS SCREEN EXISTS ───────────────────────────────────────────
 * When Delhivery refuses an address, the AWB job routes the order to
 * PENDING_MANUAL_PLACEMENT and supersedes the shipment. That is the
 * system working: the parcel is real, the customer is waiting, and a
 * human is meant to book it with somebody else and type the waybill
 * back in.
 *
 * Both endpoints have existed since M9 and nothing called them. The
 * MANUAL_PLACEMENT_ADMIN role owns exactly these two actions and could
 * reach neither, so an order arriving here simply stopped — no way to
 * dispatch it, no way to close it.
 *
 * ── TWO WAYS OUT, AND ONLY TWO ───────────────────────────────────────
 * Place an AWB — somebody else is carrying it, and recording that
 * dispatches the order (this is the one moment stock leaves for a
 * manually-placed parcel). Or cancel it as unfulfillable, which
 * releases the reservation and voids the shipment. Leaving it sitting
 * here is not a third option; it is the absence of a decision.
 *
 * ── THE GUARD WORTH UNDERSTANDING ────────────────────────────────────
 * The server refuses to dispatch an order that was never picked
 * (MANUAL_PLACEMENT_NOT_ALLOCATED). An order can reach manual placement
 * two ways: refused at confirmation, before anyone touched it; or
 * escalated from the floor after a pick shortfall. Only the second is
 * ready to hand to a courier. That refusal is surfaced verbatim with a
 * note on what to do about it, because "route it back to PENDING_PICK"
 * is not something an operator can infer from an error code.
 */
export function ManualPlacementPanel({
  shipmentId,
  shipmentNumber,
  hasAwb,
}: {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly hasAwb: boolean;
}): ReactElement | null {
  // COSMETIC (FE-2), and necessary: this panel sits on /orders, which is
  // gated on `orders.view`. Without this, everyone who can read an order
  // would see two buttons the server refuses them. The server is still
  // the boundary — this only stops us offering what it will decline.
  const mayPlace = usePermission('courier.manual_placement');
  const toast = useToast();
  const place = usePlaceManualAwb();
  const cancel = useCancelManualPlacement();

  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [awbNumber, setAwbNumber] = useState('');
  const [courierName, setCourierName] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setAwbNumber('');
    setCourierName('');
    setServiceType('');
    setReason('');
    setError(null);
  }

  async function onPlace(): Promise<void> {
    setError(null);
    try {
      const r = await place.mutateAsync({
        shipmentId,
        awbNumber: awbNumber.trim(),
        courierName: courierName.trim(),
        ...(serviceType.trim() ? { serviceType: serviceType.trim() } : {}),
      });
      setPlacing(false);
      reset();
      // The order status comes back from the SERVER rather than being
      // assumed here — the dispatch is a saga and where it lands is its
      // to report, not ours to predict.
      toast.success(`AWB ${r.awbNumber} recorded. Order is now ${r.orderStatus}.`);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onCancel(): Promise<void> {
    setError(null);
    try {
      await cancel.mutateAsync({ shipmentId, reason: reason.trim() });
      setCancelling(false);
      reset();
      toast.success('Order cancelled and stock released.');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  if (!mayPlace) return null;

  const awbTooShort = awbNumber.trim() === '';
  // Both are required by the server. Disabling on a blank required field
  // is ordinary form behaviour, not a client-side copy of a policy —
  // the server still refuses either one on its own (FE-2).
  const carrierMissing = courierName.trim() === '';
  // The server's own floor. Mirrored so the operator is told before
  // submitting, not after — the server still decides (FE-2).
  const reasonTooShort = reason.trim().length < 10;

  return (
    <div className="os-panel">
      <div className="os-tools">
        <Button
          variant="primary"
          size="sm"
          icon={<Send size={14} />}
          onClick={() => setPlacing(true)}
          disabled={hasAwb}
        >
          Place with another courier
        </Button>
        <Button
          variant="destructive"
          size="sm"
          icon={<Ban size={14} />}
          onClick={() => setCancelling(true)}
        >
          Cannot be fulfilled
        </Button>
        {hasAwb && <span className="os-note">Already has an AWB — nothing further to place.</span>}
      </div>

      {/* ── Place ─────────────────────────────────────────────────── */}
      <Dialog
        open={placing}
        onOpenChange={(next) => {
          if (!next) {
            setPlacing(false);
            reset();
          }
        }}
        icon={<Send size={18} />}
        title={
          <>
            Record a manual AWB — <span className="sk-ident">{shipmentNumber}</span>
          </>
        }
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setPlacing(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              labels={{ idle: 'Record AWB and dispatch', busy: 'Recording…' }}
              state={place.isPending ? 'busy' : 'idle'}
              disabled={awbTooShort || carrierMissing || place.isPending}
              onClick={() => void onPlace()}
            />
          </DialogFooter>
        }
      >
        <div className="os-fields">
          <p className="oo-p">
            You have booked this parcel with a courier outside Skydrop. Recording the waybill
            dispatches the order and takes the stock off hand — do it once the parcel is actually
            with them.
          </p>

          {error !== null && (
            <p className="oo-error" role="alert">
              {error}
            </p>
          )}

          <TextField
            label="AWB number"
            requiredMark
            value={awbNumber}
            onChange={(e) => setAwbNumber(e.target.value)}
            maxLength={64}
            placeholder="As printed on their label"
            inputClassName="sk-ident"
          />
          <TextField
            label="Courier"
            requiredMark
            hint="Bluedart, DTDC, whoever has it. The seller and the customer both see this name on their tracking — leave it blank and they are told their parcel is with a courier called “manual”."
            value={courierName}
            onChange={(e) => setCourierName(e.target.value)}
            maxLength={80}
          />
          <TextField
            label="Service type"
            hint="Their service tier, if it matters later. Optional."
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            maxLength={40}
          />
        </div>
      </Dialog>

      {/* ── Cancel ────────────────────────────────────────────────── */}
      <Dialog
        open={cancelling}
        onOpenChange={(next) => {
          if (!next) {
            setCancelling(false);
            reset();
          }
        }}
        icon={<Ban size={18} />}
        title={
          <>
            Cancel as unfulfillable — <span className="sk-ident">{shipmentNumber}</span>
          </>
        }
        tone="critical"
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setCancelling(false);
                reset();
              }}
            >
              Keep the order
            </Button>
            <AsyncButton
              variant="destructive"
              size="md"
              labels={{ idle: 'Cancel the order', busy: 'Cancelling…' }}
              state={cancel.isPending ? 'busy' : 'idle'}
              disabled={reasonTooShort || cancel.isPending}
              onClick={() => void onCancel()}
            />
          </DialogFooter>
        }
      >
        <div className="os-fields">
          <Notice tone="bad" icon={<Ban size={16} />}>
            <p>
              No courier will carry this parcel. Cancelling releases the stock back to inventory and
              voids the shipment. The seller sees a cancelled order, so say why in terms they would
              recognise.
            </p>
          </Notice>

          {error !== null && (
            <p className="oo-error" role="alert">
              {error}
            </p>
          )}

          <TextArea
            label="Reason"
            requiredMark
            hint="At least 10 characters — it is kept on the order."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            showCount
            rows={3}
            placeholder="e.g. No courier serves this PIN; customer contacted and agrees to cancel."
          />
        </div>
      </Dialog>
    </div>
  );
}
