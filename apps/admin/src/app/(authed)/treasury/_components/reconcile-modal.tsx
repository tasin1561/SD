'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, Scale } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { useReconcileAccount } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { Notice } from './money-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * The book disagreed with the bank. Say so, in writing.
 *
 * The correction is posted as an ENTRY, never as an overwrite: the
 * ledger is the history of what we believed and when, and silently
 * setting a balance to the right number destroys the evidence of the
 * thing that went wrong. What lands is the DIFFERENCE, carrying the
 * reason, so a later reader can see both that it happened and why.
 */
export function ReconcileModal({
  accountId,
  accountLabel,
  currency,
  bookBalance,
  bySeller,
  onClose,
}: {
  readonly accountId: string | null;
  readonly accountLabel: string;
  readonly currency: 'INR' | 'BDT';
  readonly bookBalance: string;
  /** Whose money is in this account, so a seller's holding can be corrected too. */
  readonly bySeller: ReadonlyArray<{ sellerId: string; companyName: string; amount: string }>;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();

  const reconcile = useReconcileAccount();
  // '' means OUR money. A seller id corrects what we hold for them.
  const [sellerId, setSellerId] = useState('');
  const [statedBalance, setStated] = useState('');
  const [reason, setReason] = useState('');
  // Our own money only: the P&L leaves exactly the marked entry off its
  // reconciliation line, so an opening balance never reads as income.
  const [opening, setOpening] = useState(false);
  // A seller's holding in a taka account: what the correction is worth to
  // their wallet, in rupees. Required there by the server; not asked for
  // anywhere else.
  const [inrValue, setInrValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsInrValue = sellerId !== '' && currency !== 'INR';

  // Each owner is its own running sum, so the figure being corrected has
  // to be that owner's — comparing a seller's stated holding against the
  // account's capital balance would post a wildly wrong difference.
  const currentBook =
    sellerId === ''
      ? bookBalance
      : (bySeller.find((b) => b.sellerId === sellerId)?.amount ?? '0.00');

  const delta =
    statedBalance.trim() === '' || Number.isNaN(Number(statedBalance))
      ? null
      : Number(statedBalance) - Number(currentBook);

  const [confirming, setConfirming] = useState(false);

  // The form's checks, unchanged, run before the confirm step opens.
  function review(): void {
    setError(null);
    if (statedBalance.trim() === '' || Number.isNaN(Number(statedBalance))) {
      setError(t('treasuryReconcileModal.whatDoesTheStatementActually'));
      return;
    }
    if (reason.trim().length < 10) {
      setError(t('treasuryReconcileModal.sayWhatWasWrongAt'));
      return;
    }
    if (accountId === null) return;
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    if (accountId === null) return;
    try {
      await reconcile.mutateAsync({
        accountId,
        ownerKind: sellerId === '' ? 'CAPITAL' : 'SELLER',
        ...(sellerId === '' ? {} : { sellerId }),
        statedBalance: Number(statedBalance).toFixed(2),
        reason: reason.trim(),
        ...(sellerId === '' && opening ? { isOpeningBalance: true } : {}),
        ...(needsInrValue && inrValue.trim() !== '' ? { inrValue: inrValue.trim() } : {}),
      });
      setStated('');
      setSellerId('');
      setReason('');
      setOpening(false);
      setInrValue('');
      setConfirming(false);
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const ownerWords =
    sellerId === ''
      ? t('treasuryReconcileModal.ourOwnMoney')
      : `the holding for ${bySeller.find((b) => b.sellerId === sellerId)?.companyName ?? 'the client'}`;

  return (
    <>
      <Dialog
        open={accountId !== null && !confirming}
        onOpenChange={(next) => {
          if (!next) {
            setError(null);
            onClose();
          }
        }}
        icon={<Scale size={18} />}
        title={t('treasuryReconcileModal.reconcile', { accountLabel })}
        description={t('treasuryReconcileModal.postsTheDifferenceAsA')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {t('treasuryReconcileModal.cancel')}
            </Button>
            <Button variant="primary" onClick={review} disabled={reconcile.isPending}>
              {t('treasuryReconcileModal.reviewAdjustment')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          {bySeller.length > 0 && (
            <Select
              label={t('treasuryReconcileModal.whoseBalance')}
              hint={t('treasuryReconcileModal.eachOwnerIsASeparate')}
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">{t('treasuryReconcileModal.oursCapital')}</option>
              {bySeller.map((b) => (
                <option key={b.sellerId} value={b.sellerId}>
                  {b.companyName}
                </option>
              ))}
            </Select>
          )}
          <p className="mo-p">
            {richMessage(t('treasuryReconcileModal.ourBookSaysIs'), {
              money: <Money amount={currentBook} currency={currency} convert={false} />,
            })}{' '}
            {sellerId === ''
              ? 'ours'
              : `held for ${bySeller.find((b) => b.sellerId === sellerId)?.companyName ?? 'them'}`}{' '}
            {t('treasuryReconcileModal.inThisAccount')}
          </p>
          <TextField
            label={t('treasuryReconcileModal.whatTheStatementSays')}
            requiredMark
            type="number"
            inputMode="decimal"
            step="0.01"
            inputClassName="sk-figure"
            value={statedBalance}
            onChange={(e) => setStated(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {delta !== null && delta !== 0 && (
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <p>
                {richMessage(t('treasuryReconcileModal.anAdjustmentOfWillBe'), {
                  money: (
                    <Money
                      amount={delta.toFixed(2)}
                      currency={currency}
                      convert={false}
                      direction={delta < 0 ? 'debit' : 'credit'}
                    />
                  ),
                  value:
                    sellerId === ''
                      ? t('treasuryReconcileModal.ourOwnMoney')
                      : t('treasuryReconcileModal.theirHolding'),
                })}
              </p>
            </Notice>
          )}
          {needsInrValue && (
            <TextField
              label={t('treasuryReconcileModal.worthToTheirWalletInr')}
              requiredMark
              hint={t('treasuryReconcileModal.theRupeesThisDifferenceIs')}
              type="number"
              inputMode="decimal"
              step="0.01"
              inputClassName="sk-figure"
              value={inrValue}
              onChange={(e) => setInrValue(e.target.value)}
              placeholder="0.00"
            />
          )}
          {sellerId === '' && (
            <Checkbox
              checked={opening}
              onChange={(e) => setOpening(e.target.checked)}
              label={
                <span>
                  {richMessage(t('treasuryReconcileModal.thisIsTheAccountS'), {
                    strong: <strong>{t('treasuryReconcileModal.openingBalance')}</strong>,
                  })}
                </span>
              }
              description={t('treasuryReconcileModal.moneyTheBusinessAlreadyHad')}
            />
          )}
          <TextArea
            label={t('treasuryReconcileModal.whyTheBookWasWrong')}
            requiredMark
            hint={t('treasuryReconcileModal.atLeastASentenceIt')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
            showCount
            placeholder={t('treasuryReconcileModal.eGBankChargedA')}
          />
          {error !== null && !confirming && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={accountId !== null && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={t('treasuryReconcileModal.postThisAdjustment')}
        entity={accountLabel}
        amount={
          <span className="mo-stack mo-stack--tight">
            <span>
              {t('treasuryReconcileModal.statement')}{' '}
              <Money
                amount={Number(statedBalance).toFixed(2)}
                currency={currency}
                convert={false}
              />
            </span>
            {delta !== null && (
              <span>
                {t('treasuryReconcileModal.adjustment')}{' '}
                <Money
                  amount={delta.toFixed(2)}
                  currency={currency}
                  convert={false}
                  direction={delta < 0 ? 'debit' : 'credit'}
                />
              </span>
            )}
          </span>
        }
        consequence={`Posts the ${currency} difference as a new entry against ${ownerWords} in ${accountLabel}${sellerId === '' && opening ? ', marked as the opening balance' : ''}; nothing is overwritten.`}
        confirmLabel={t('treasuryReconcileModal.postAdjustment')}
        destructive={false}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
