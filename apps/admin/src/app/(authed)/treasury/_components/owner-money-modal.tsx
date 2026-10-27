'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Landmark } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { useRecordOwnerMoney } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * The owner putting money into the business, or taking it out.
 *
 * Its own action, not a reconciliation: a reconciliation says the book
 * was WRONG, and the P&L reads a positive one as money we did not know we
 * had — so an injection recorded that way read as profit, and a drawing
 * as a loss. Recorded here it is equity, on no P&L line at all.
 */
export function OwnerMoneyModal({
  accountId,
  accountLabel,
  currency,
  onClose,
}: {
  readonly accountId: string | null;
  readonly accountLabel: string;
  readonly currency: 'INR' | 'BDT';
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const record = useRecordOwnerMoney();
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One key per opening of the form, kept across retries: a retried save
  // is answered with the entry already recorded instead of a second one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (accountId !== null) setIdempotencyKey(crypto.randomUUID());
  }, [accountId]);

  const [confirming, setConfirming] = useState(false);

  function reset(): void {
    setDirection('IN');
    setAmount('');
    setOccurredOn(new Date().toISOString().slice(0, 10));
    setReason('');
    setReference('');
    setError(null);
    setConfirming(false);
  }

  // No client-side checks were ever run here (FE-2) — review only opens
  // the confirm, which restates the account, the amount and the date.
  function review(): void {
    setError(null);
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    if (accountId === null) return;
    try {
      await record.mutateAsync({
        accountId,
        direction,
        amount: amount.trim(),
        occurredAt: new Date(occurredOn).toISOString(),
        reason: reason.trim(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey,
      });
      reset();
      onClose();
    } catch (err) {
      // FE-2: the server's verdict, verbatim — no client-side mirror of
      // its rules (amount, reason length) to pre-empt it.
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const preview = amount.trim() !== '' && !Number.isNaN(Number(amount)) ? amount.trim() : null;

  const onLabel =
    occurredOn === ''
      ? ''
      : new Date(occurredOn).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

  return (
    <>
      <Dialog
        open={accountId !== null && !confirming}
        onOpenChange={(next) => {
          if (!next) {
            reset();
            onClose();
          }
        }}
        icon={<Landmark size={18} />}
        title={t('treasuryOwnerMoneyModal.ownerMoney', { accountLabel })}
        description={t('treasuryOwnerMoneyModal.moneyYouPutIntoThe')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {t('treasuryOwnerMoneyModal.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={review}
              disabled={record.isPending || amount.trim() === ''}
            >
              {t('treasuryOwnerMoneyModal.review')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <Select
            id="owner-money-direction"
            label={t('treasuryOwnerMoneyModal.whichWay')}
            requiredMark
            value={direction}
            onChange={(e) => setDirection(e.target.value === 'OUT' ? 'OUT' : 'IN')}
          >
            <option value="IN">{t('treasuryOwnerMoneyModal.putInMoneyIntoThe')}</option>
            <option value="OUT">{t('treasuryOwnerMoneyModal.takenOutMoneyOutOf')}</option>
          </Select>
          <TextField
            id="owner-money-amount"
            label={t('treasuryOwnerMoneyModal.amount', { currency })}
            hint={t('treasuryOwnerMoneyModal.asAPositiveFigureThe')}
            requiredMark
            inputMode="decimal"
            inputClassName="sk-figure"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {preview !== null && (
            <p className="mo-p">
              {direction === 'IN'
                ? t('treasuryOwnerMoneyModal.adds')
                : t('treasuryOwnerMoneyModal.takes')}{' '}
              <Money
                amount={direction === 'IN' ? preview : `-${preview}`}
                currency={currency}
                convert={false}
                direction={direction === 'IN' ? 'credit' : 'debit'}
              />{' '}
              {t('treasuryOwnerMoneyModal.ourOwnMoneyInThis', {
                value:
                  direction === 'IN'
                    ? t('treasuryOwnerMoneyModal.to')
                    : t('treasuryOwnerMoneyModal.from'),
              })}
            </p>
          )}
          <DateField
            id="owner-money-date"
            label={t('treasuryOwnerMoneyModal.on')}
            requiredMark
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
          <TextArea
            id="owner-money-reason"
            label={t('treasuryOwnerMoneyModal.whatItWasFor')}
            hint={t('treasuryOwnerMoneyModal.atLeastASentenceIt')}
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            showCount
            placeholder={t('treasuryOwnerMoneyModal.eGFounderSCapital')}
          />
          <TextField
            id="owner-money-ref"
            label={t('treasuryOwnerMoneyModal.bankReference')}
            hint={t('treasuryOwnerMoneyModal.optional')}
            inputClassName="sk-ident"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={accountId !== null && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={
          direction === 'IN'
            ? t('treasuryOwnerMoneyModal.recordMoneyPutIn')
            : t('treasuryOwnerMoneyModal.recordMoneyTakenOut')
        }
        entity={accountLabel}
        amount={
          preview === null ? undefined : (
            <Money
              amount={direction === 'IN' ? preview : `-${preview}`}
              currency={currency}
              convert={false}
              direction={direction === 'IN' ? 'credit' : 'debit'}
            />
          )
        }
        consequence={t('treasuryOwnerMoneyModal.ourOwnMoneyInOn', {
          value:
            direction === 'IN'
              ? t('treasuryOwnerMoneyModal.addsThisTo')
              : t('treasuryOwnerMoneyModal.takesThisFrom'),
          currency,
          accountLabel,
          onLabel,
        })}
        confirmLabel={t('treasuryOwnerMoneyModal.record')}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
