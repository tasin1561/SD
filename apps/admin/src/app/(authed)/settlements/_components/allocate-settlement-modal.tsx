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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
      toast.success(t('settlementsAllocateSettlementModal.allocatedThoseClientsHaveBeen'));
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
      title={t('settlementsAllocateSettlementModal.allocateMoreOfThisPayout')}
      description={t('settlementsAllocateSettlementModal.nameTheOrdersItAlso', { reference })}
      footer={
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={allocate.isPending}
          >
            {t('settlementsAllocateSettlementModal.cancel')}
          </Button>
          <AsyncButton
            labels={{
              idle: t('settlementsAllocateSettlementModal.allocate'),
              busy: t('settlementsAllocateSettlementModal.allocating'),
              done: t('settlementsAllocateSettlementModal.allocated'),
              error: t('settlementsAllocateSettlementModal.refused'),
            }}
            disabled={filled.length === 0 || over}
            onAction={submit}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        <div className="mk-subject">
          <span className="mk-subject__label">
            {t('settlementsAllocateSettlementModal.payout')}
          </span>
          <span className="mk-subject__main">
            <Ident value={reference} />
          </span>
          <span className="mk-small">
            {t('settlementsAllocateSettlementModal.leftToAllocate')}{' '}
            <Money amount={unallocatedInr} />
          </span>
        </div>

        {lines.map((line, i) => (
          <div key={i} className="mk-line mk-line--2">
            <TextField
              label={t('settlementsAllocateSettlementModal.orderId')}
              value={line.orderId}
              onChange={(e) => set(i, 'orderId', e.target.value)}
              placeholder={t('settlementsAllocateSettlementModal.orderUuid')}
              inputClassName="sk-ident"
            />
            <TextField
              label={t('settlementsAllocateSettlementModal.settledInr')}
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
            {t('settlementsAllocateSettlementModal.addOrder')}
          </Button>
        </div>

        {over && <MkAlert>{t('settlementsAllocateSettlementModal.youHaveNamedMoreThan')}</MkAlert>}
      </div>
    </Dialog>
  );
}
