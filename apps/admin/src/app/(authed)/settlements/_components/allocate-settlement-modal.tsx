'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useAllocateSettlement } from '@/lib/ops-hooks';

/**
 * Finish attributing a payout that was recorded before every order it
 * covered was recognised.
 *
 * Deliberately has NO amount field. The payout total is what the bank
 * statement says and cannot be improved on here — allocating names the
 * orders the money already belongs to, and moves it from capital to
 * those sellers. Offering an amount would invite recording cash twice,
 * which is the failure the whole ledger exists to prevent.
 */
export function AllocateSettlementModal({
  settlementId,
  reference,
  unallocatedInr,
  open,
  onOpenChange,
}: {
  readonly settlementId: string;
  readonly reference: string;
  readonly unallocatedInr: string;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const allocate = useAllocateSettlement();
  const [lines, setLines] = useState<Array<{ orderId: string; settledInr: string }>>([
    { orderId: '', settledInr: '' },
  ]);

  useEffect(() => {
    if (open) {
      setLines([{ orderId: '', settledInr: '' }]);
      allocate.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settlementId]);

  const filled = lines.filter((l) => l.orderId.trim() !== '' && l.settledInr.trim() !== '');
  const naming = filled.reduce((sum, l) => sum + (Number(l.settledInr) || 0), 0);
  const remaining = Number(unallocatedInr);
  // Shown before submitting, because the server's refusal is correct but
  // arrives after the operator has typed everything.
  const over = naming > remaining;

  function set(i: number, key: 'orderId' | 'settledInr', value: string): void {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, [key]: value } : l)));
  }

  async function submit(): Promise<void> {
    try {
      await allocate.mutateAsync({
        settlementId,
        lines: filled.map((l) => ({ orderId: l.orderId.trim(), settledInr: l.settledInr.trim() })),
      });
      toast.success('Allocated. Those sellers have been credited.');
      onOpenChange(false);
    } catch (err) {
      // FE-2 — the server owns the rules; show its refusal verbatim.
      toast.error(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Allocate more of this payout"
      description={`${reference} — name the orders it also covered. The payout total is not changed; this moves money already in the bank to the sellers it belongs to.`}
    >
      <div className="text-text-muted mb-3 text-xs">
        Left to allocate: <Money amount={unallocatedInr} />
      </div>

      {lines.map((line, i) => (
        <div key={i} className="mb-2 flex gap-2">
          <FormField label={i === 0 ? 'Order ID' : ''} className="flex-1">
            <Input
              value={line.orderId}
              onChange={(e) => set(i, 'orderId', e.target.value)}
              placeholder="Order UUID"
            />
          </FormField>
          <FormField label={i === 0 ? 'Settled (INR)' : ''} className="w-40">
            <Input
              value={line.settledInr}
              onChange={(e) => set(i, 'settledInr', e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </FormField>
        </div>
      ))}

      <Button
        variant="ghost"
        onClick={() => setLines((prev) => [...prev, { orderId: '', settledInr: '' }])}
      >
        + Add order
      </Button>

      {over && (
        <ErrorNote message="You have named more than this payout has left. The server refuses this — record a separate payout for cash that landed separately." />
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={filled.length === 0 || over || allocate.isPending}
        >
          {allocate.isPending ? 'Allocating…' : 'Allocate'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
