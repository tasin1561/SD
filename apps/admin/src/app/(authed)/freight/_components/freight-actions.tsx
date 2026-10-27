'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { MkAlert } from '../../seller-wallets/_components/money-parts';
import { InboundFreightStatus } from '@skydrop/db';
import {
  useSettleFreight,
  useVoidFreight,
  useWaiveFreight,
  type FreightChargeView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
  const t = useT();

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
  const [settleError, setSettleError] = useState<string | null>(null);

  const open =
    row.status === InboundFreightStatus.PENDING ||
    row.status === InboundFreightStatus.PARTIALLY_SETTLED;

  if (!open) {
    return (
      <span className="mk-faint">
        {row.voidedAt !== null
          ? t('freightFreightActions.withdrawn')
          : row.status === InboundFreightStatus.WAIVED
            ? t('freightFreightActions.waived')
            : t('freightFreightActions.closed')}
      </span>
    );
  }

  /** Rejects on a refusal (the verdict shown verbatim inside the confirm). */
  async function doSettle(): Promise<void> {
    setSettleError(null);
    try {
      await settle.mutateAsync({ freightChargeId: row.id });
      toast.success(t('freightFreightActions.freightBillSettledAgainstThe'));
      setConfirmSettle(false);
    } catch (err) {
      setSettleError(serverVerdict(err));
      throw err;
    }
  }

  async function doWaive(): Promise<void> {
    setError(null);
    try {
      await waive.mutateAsync({ freightChargeId: row.id, reason: reason.trim() });
      toast.success(t('freightFreightActions.freightBillWaived'));
      setWaiving(false);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  async function doVoid(): Promise<void> {
    setError(null);
    try {
      await voidBill.mutateAsync({ freightChargeId: row.id, reason: voidReason.trim() });
      toast.success(t('freightFreightActions.freightBillWithdrawnRaiseThe'));
      setVoiding(false);
      setVoidReason('');
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  // Settle, waive and void all move money; without the permission this
  // row simply has no actions rather than three buttons that 403.
  if (!canWrite) return <></>;

  const arrival = row.receiptNumber ?? row.consignmentNumber ?? row.consignmentId.slice(0, 8);

  return (
    <div className="mk-actions">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setSettleError(null);
          setConfirmSettle(true);
        }}
        disabled={settle.isPending}
      >
        {t('freightFreightActions.settle')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setWaiving(true)}>
        {t('freightFreightActions.waive')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setVoiding(true)}>
        {t('freightFreightActions.void')}
      </Button>

      <ConfirmDialog
        open={confirmSettle}
        onOpenChange={setConfirmSettle}
        title={t('freightFreightActions.settleThisFreightBill')}
        entity={t('freightFreightActions.arrival', {
          arrival,
          value: row.sellerCompanyName !== null ? ` · ${row.sellerCompanyName}` : '',
        })}
        amount={<Money amount={row.outstandingInr} />}
        consequence={t('freightFreightActions.debitsTheClientSWallet', { arrival })}
        confirmLabel={t('freightFreightActions.settle')}
        onConfirm={doSettle}
        error={settleError}
      />

      <Dialog
        open={waiving}
        onOpenChange={(next) => {
          setWaiving(next);
          if (!next) setError(null);
        }}
        size="md"
        tone="critical"
        locked={waive.isPending}
        title={t('freightFreightActions.waiveThisFreightBill')}
        description={
          <>
            {richMessage(t('freightFreightActions.forgivesNoWalletMovementAnd'), {
              money: <Money amount={row.outstandingInr} />,
            })}
          </>
        }
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setWaiving(false)}
              disabled={waive.isPending}
            >
              {t('freightFreightActions.cancel')}
            </Button>
            <AsyncButton
              variant="destructive"
              size="md"
              disabled={reason.trim().length < MIN_WAIVE_REASON}
              labels={{
                idle: t('freightFreightActions.waiveBill'),
                busy: t('freightFreightActions.waiving'),
                done: t('freightFreightActions.waived'),
                error: t('freightFreightActions.refused'),
              }}
              onAction={doWaive}
            />
          </DialogFooter>
        }
      >
        <div className="mk-stack">
          <TextArea
            id="waive-reason"
            label={t('freightFreightActions.reason')}
            hint={t('freightFreightActions.atLeastCharactersThisIs', {
              minWaiveReason: MIN_WAIVE_REASON,
            })}
            requiredMark
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('freightFreightActions.consignmentMisHandledAtOur')}
          />
          {error !== null && <MkAlert>{error}</MkAlert>}
        </div>
      </Dialog>

      <Dialog
        open={voiding}
        onOpenChange={(next) => {
          setVoiding(next);
          if (!next) setError(null);
        }}
        size="md"
        tone="critical"
        locked={voidBill.isPending}
        title={t('freightFreightActions.withdrawThisFreightBill')}
        description={
          <>
            {richMessage(t('freightFreightActions.forABillThatWas'), {
              money: <Money amount={row.amountSettledInr} />,
            })}
          </>
        }
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setVoiding(false)}
              disabled={voidBill.isPending}
            >
              {t('freightFreightActions.cancel')}
            </Button>
            <AsyncButton
              variant="destructive"
              size="md"
              disabled={voidReason.trim().length < MIN_VOID_REASON}
              labels={{
                idle: t('freightFreightActions.withdrawBill'),
                busy: t('freightFreightActions.withdrawing'),
                done: t('freightFreightActions.withdrawn'),
                error: t('freightFreightActions.refused'),
              }}
              onAction={doVoid}
            />
          </DialogFooter>
        }
      >
        <div className="mk-stack">
          <div className="mk-subject">
            <span className="mk-subject__label">{t('freightFreightActions.billForArrival')}</span>
            <span className="mk-subject__main sk-ident">{arrival}</span>
            {row.sellerCompanyName !== null && (
              <span className="mk-small">{row.sellerCompanyName}</span>
            )}
          </div>
          <TextArea
            id="void-reason"
            label={t('freightFreightActions.whatWasWrongWithIt')}
            hint={t('freightFreightActions.atLeastCharactersTheClient', {
              minVoidReason: MIN_VOID_REASON,
            })}
            requiredMark
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder={t('freightFreightActions.rateTypedAs300Kg')}
          />
          {error !== null && <MkAlert>{error}</MkAlert>}
        </div>
      </Dialog>
    </div>
  );
}
