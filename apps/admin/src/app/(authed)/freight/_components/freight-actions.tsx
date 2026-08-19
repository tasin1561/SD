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
import { useSettleFreight, useWaiveFreight, type FreightChargeView } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

const MIN_WAIVE_REASON = 10;

/**
 * Settle / waive for one freight bill.
 *
 * Both are money decisions, so both confirm — and the confirmation
 * states the amount, because "settle" on the wrong row debits a
 * seller who owes nothing. Waive additionally demands a written
 * reason: forgiven money has to stay explainable months later.
 *
 * FE-2: the buttons are hidden on terminal rows for clarity, but the
 * server re-guards both (`settle` re-checks status inside the tx so
 * two operators cannot double-debit) and its verdict is shown as-is.
 */
export function FreightActions({ row }: { readonly row: FreightChargeView }): ReactElement {
  const toast = useToast();
  const canWrite = usePermission('money.freight.manage');
  const settle = useSettleFreight();
  const waive = useWaiveFreight();

  const [confirmSettle, setConfirmSettle] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open =
    row.status === InboundFreightStatus.PENDING ||
    row.status === InboundFreightStatus.PARTIALLY_SETTLED;

  if (!open) {
    return (
      <span className="text-text-faint text-xs">
        {row.status === InboundFreightStatus.WAIVED ? 'Waived' : 'Closed'}
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

  // Settle and waive both move money; without the permission this
  // row simply has no actions rather than two buttons that 403.
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

      <ConfirmDialog
        open={confirmSettle}
        onOpenChange={setConfirmSettle}
        title="Settle this freight bill?"
        description={
          <>
            Debits the seller&apos;s wallet by the outstanding <Money amount={row.outstandingInr} />{' '}
            for receipt {row.consignmentNumber ?? row.consignmentId.slice(0, 8)}. The ledger entry
            is permanent.
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
    </div>
  );
}
