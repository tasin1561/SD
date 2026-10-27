'use client';

import { useState, type ReactElement } from 'react';
import { OctagonX, Scale } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from '../../_components/orders-parts';
import { useRaiseStoreDispute } from '@/lib/ops-hooks';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';

const MIN_SUBJECT = 3;

/**
 * RS-7 (2026-09-19) — Seller staff raise a dispute with the reseller
 * store about ONE of its orders.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS A DISPUTE ────────────────────────
 * Once a reseller order's credits are CREDITED, the money on it cannot
 * be re-worked-out: `seller_wallet_entries_once_per_order_uq` allows
 * each direction once per order, which is the guard against paying an
 * order twice, and a correction that reversed and rewrote a credit would
 * need a second one. So a paid order whose figures are wrong is settled
 * BETWEEN the two wallets through the dispute Skydrop already referees —
 * the same path, the same guardrails, one place where money moves.
 *
 * The STORE is not named here. It is read off the order by the server,
 * so a dispute cannot be filed against a store that had nothing to do
 * with it.
 *
 * The claim is a CLAIM. Skydrop settles with its own figure; what this
 * carries is what the seller says is owed, beside the money as it stood
 * when they said it, so the settlement is not typed from nothing.
 */
export function DisputeFiguresModal({
  open,
  onOpenChange,
  orderId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orderId: string;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const raise = useRaiseStoreDispute();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [correction, setCorrection] = useState(true);
  const [claimAmount, setClaimAmount] = useState('');
  const [claimPayer, setClaimPayer] = useState<'STORE' | 'SELLER'>('STORE');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setSubject('');
    setDescription('');
    setCorrection(true);
    setClaimAmount('');
    setClaimPayer('STORE');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync({
        orderId,
        subject: subject.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...(correction
          ? {
              disputeKind: 'FIGURE_CORRECTION' as const,
              claimAmountInr: claimAmount.trim(),
              claimPayer,
            }
          : {}),
      });
      toast.success(t('orderDispute.raisedWithTheStore'));
      reset();
      onOpenChange(false);
    } catch (err) {
      // FE-2 — the server's own verdict, verbatim.
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('orderDispute.raiseThisWithThe')}
      description={t('orderDispute.skydropRefereesItA')}
      icon={<Scale size={18} />}
      locked={raise.isPending}
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={raise.isPending}>
            {t('orderDispute.cancel')}
          </Button>
          <AsyncButton
            state={raise.isPending ? 'busy' : undefined}
            labels={{ idle: t('orderDispute.raiseIt'), busy: t('orderDispute.raising') }}
            onClick={() => void submit()}
            disabled={raise.isPending || subject.trim().length < MIN_SUBJECT}
          />
        </DialogFooter>
      }
    >
      <div className="ord-stack ord-stack--tight">
        <Checkbox
          checked={correction}
          onChange={(e) => setCorrection(e.target.checked)}
          label={t('orderDispute.theMoneyWorkedOut')}
          description={<>{t('orderDispute.sayWhatYouThink')}</>}
        />

        {correction ? (
          <div className="ord-grid-2">
            <TextField
              id="dispute-claim-amount"
              label={t('orderDispute.howMuch')}
              hint={t('orderDispute.upTo2Decimals')}
              inputMode="decimal"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              placeholder="120.00"
            />
            <Select
              id="dispute-claim-payer"
              label={t('orderDispute.whoOwesIt')}
              value={claimPayer}
              onChange={(e) => setClaimPayer(e.target.value === 'SELLER' ? 'SELLER' : 'STORE')}
            >
              <option value="STORE">{t('orderDispute.theStoreOwesUs')}</option>
              <option value="SELLER">{t('orderDispute.weOweTheStore')}</option>
            </Select>
          </div>
        ) : null}

        <TextField
          id="dispute-subject"
          label={t('orderDispute.whatIsWrong')}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder={t('orderDispute.theTransferPriceOn')}
        />
        <TextArea
          id="dispute-description"
          label={t('orderDispute.tellUsMore')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
        />
        {error !== null ? (
          <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
            <span>{error}</span>
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}
