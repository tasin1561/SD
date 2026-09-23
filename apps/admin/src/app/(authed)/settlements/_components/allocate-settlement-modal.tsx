'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { MkAlert } from '../../seller-wallets/_components/money-parts';
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
      throw err;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={allocate.isPending}
      title="Allocate more of this payout"
      description={`${reference} — name the orders it also covered. The payout total is not changed; this moves money already in the bank to the sellers it belongs to.`}
      footer={
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={allocate.isPending}
          >
            Cancel
          </Button>
          <AsyncButton
            labels={{ idle: 'Allocate', busy: 'Allocating…', done: 'Allocated', error: 'Refused' }}
            disabled={filled.length === 0 || over}
            onAction={submit}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        <div className="mk-subject">
          <span className="mk-subject__label">Payout</span>
          <span className="mk-subject__main">
            <Ident value={reference} />
          </span>
          <span className="mk-small">
            Left to allocate: <Money amount={unallocatedInr} />
          </span>
        </div>

        {lines.map((line, i) => (
          <div key={i} className="mk-line mk-line--2">
            <TextField
              label="Order ID"
              value={line.orderId}
              onChange={(e) => set(i, 'orderId', e.target.value)}
              placeholder="Order UUID"
              inputClassName="sk-ident"
            />
            <TextField
              label="Settled (INR)"
              value={line.settledInr}
              onChange={(e) => set(i, 'settledInr', e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
        ))}

        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setLines((prev) => [...prev, { orderId: '', settledInr: '' }])}
          >
            Add order
          </Button>
        </div>

        {over && (
          <MkAlert>
            You have named more than this payout has left. The server refuses this — record a
            separate payout for cash that landed separately.
          </MkAlert>
        )}
      </div>
    </Dialog>
  );
}
