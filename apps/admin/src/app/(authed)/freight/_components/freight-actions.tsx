'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  ConfirmDialog,
  ErrorNote,
  FormField,
  Modal,
  ModalFooter,
  Money,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { InboundFreightStatus } from '@skydrop/db';
import {
  useSettleFreight,
  useVoidFreight,
  useWaiveFreight,
  type FreightChargeView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

const MIN_WAIVE_REASON = 10;
const MIN_VOID_REASON = 10;

/**
 * Settle / waive / void for one freight bill.
 *
 * All three are money decisions, so all three confirm — and the
 * confirmation states the amount, because "settle" on the wrong row
 * debits a seller who owes nothing. Waive and void each demand a
 * written reason: money we chose not to collect, and money we took
 * back, both have to stay explainable months later.
 *
 * **Waive and void are different acts and the copy says so.** A waived
 * bill was CORRECT and we forgave it — it stays countable as a waiver,
 * and whatever was already charged stays charged. A voided bill was
 * WRONG — a mistyped rate, a recount — so it is withdrawn and anything
 * it charged is handed back, leaving a corrected bill to be raised in
 * its place. Reaching for the wrong one either bills a seller for a
 * figure nobody meant or writes off a debt that was real.
 *
 * FE-2: the buttons are hidden on terminal rows for clarity, but the
 * server re-guards all three (`settle` re-checks status inside the tx so
 * two operators cannot double-debit) and its verdict is shown as-is.
 */
export function FreightActions({ row }: { readonly row: FreightChargeView }): ReactElement {
  const toast = useToast();
  const canWrite = usePermission('money.freight.manage');
  const settle = useSettleFreight();
  const waive = useWaiveFreight();
  const voidBill = useVoidFreight();

  const [confirmSettle, setConfirmSettle] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open =
    row.status === InboundFreightStatus.PENDING ||
    row.status === InboundFreightStatus.PARTIALLY_SETTLED;

  if (!open) {
    return (
      <span className="text-text-faint text-xs">
        {row.voidedAt !== null
          ? 'Withdrawn'
          : row.status === InboundFreightStatus.WAIVED
            ? 'Waived'
            : 'Closed'}
      </span>
    );
  }

  async function doSettle(): Promise<void> {
    setError(null);
    try {
      await settle.mutateAsync({ freightChargeId: row.id });
      toast.success('Freight bill settled against the wallet.');
      setConfirmSettle(false);
    } catch (err) {
      toast.error(serverVerdict(err));
      setConfirmSettle(false);
    }
  }

  async function doWaive(): Promise<void> {
    setError(null);
    try {
      await waive.mutateAsync({ freightChargeId: row.id, reason: reason.trim() });
      toast.success('Freight bill waived.');
      setWaiving(false);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function doVoid(): Promise<void> {
    setError(null);
    try {
      await voidBill.mutateAsync({ freightChargeId: row.id, reason: voidReason.trim() });
      toast.success('Freight bill withdrawn. Raise the corrected one when you have it.');
      setVoiding(false);
      setVoidReason('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // Settle, waive and void all move money; without the permission this
  // row simply has no actions rather than three buttons that 403.
  if (!canWrite) return <></>;

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setConfirmSettle(true)}
        disabled={settle.isPending}
      >
        Settle
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setWaiving(true)}>
        Waive
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setVoiding(true)}>
        Void
      </Button>

      <ConfirmDialog
        open={confirmSettle}
        onOpenChange={setConfirmSettle}
        title="Settle this freight bill?"
        description={
          <>
            Debits the seller&apos;s wallet by the outstanding <Money amount={row.outstandingInr} />{' '}
            for arrival{' '}
            {row.receiptNumber ?? row.consignmentNumber ?? row.consignmentId.slice(0, 8)}. The
            ledger entry is permanent.
          </>
        }
        confirmLabel={settle.isPending ? 'Settling…' : 'Settle'}
        confirmVariant="primary"
        disabled={settle.isPending}
        onConfirm={() => void doSettle()}
      />

      <Modal
        open={waiving}
        onOpenChange={(next) => {
          setWaiving(next);
          if (!next) setError(null);
        }}
        size="md"
        title="Waive this freight bill"
        description={
          <>
            Forgives <Money amount={row.outstandingInr} /> — no wallet movement, and the bill stays
            countable as a waiver rather than disappearing. Audited at HIGH severity.
          </>
        }
      >
        <FormField
          label="Reason"
          htmlFor="waive-reason"
          hint={`At least ${MIN_WAIVE_REASON} characters. This is what explains the write-off at audit time.`}
          required
        >
          <Textarea
            id="waive-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Consignment mis-handled at our warehouse; goodwill on the freight."
          />
        </FormField>

        {error !== null && <ErrorNote className="mt-3" message={error} />}

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setWaiving(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={reason.trim().length < MIN_WAIVE_REASON || waive.isPending}
            onClick={() => void doWaive()}
          >
            {waive.isPending ? 'Waiving…' : 'Waive bill'}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={voiding}
        onOpenChange={(next) => {
          setVoiding(next);
          if (!next) setError(null);
        }}
        size="md"
        title="Withdraw this freight bill"
        description={
          <>
            For a bill that was WRONG — a mistyped rate, a recount. It is withdrawn and whatever it
            charged (<Money amount={row.amountSettledInr} />) goes back to the seller&apos;s wallet.
            Raise the corrected bill for this stop afterwards; until you do, this arrival has no
            freight against it. Audited at HIGH severity.
            <br />
            <span className="text-text-muted">
              Not the same as a waiver: waive is for a bill that was right and we chose to forgive.
            </span>
          </>
        }
      >
        <FormField
          label="What was wrong with it"
          htmlFor="void-reason"
          hint={`At least ${MIN_VOID_REASON} characters. The seller sees this on their consignment, so write what actually happened.`}
          required
        >
          <Textarea
            id="void-reason"
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Rate typed as 300/kg; the forwarder's invoice says 30/kg."
          />
        </FormField>

        {error !== null && <ErrorNote className="mt-3" message={error} />}

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setVoiding(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={voidReason.trim().length < MIN_VOID_REASON || voidBill.isPending}
            onClick={() => void doVoid()}
          >
            {voidBill.isPending ? 'Withdrawing…' : 'Withdraw bill'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
