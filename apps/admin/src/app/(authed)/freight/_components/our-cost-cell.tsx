'use client';

import { useState, type ReactElement } from 'react';
import { Banknote } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { MkAlert, MkDl } from '../../seller-wallets/_components/money-parts';
import { usePayForwarder, useSetFreightOurCost, type FreightChargeView } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useT } from '@/i18n/client';

/**
 * What the FORWARDER charged us, against what we billed the seller.
 *
 * ── TWO ROUTES, AND THE PROMINENT ONE IS THE RIGHT ONE ───────────────
 * **Record payment** writes the bank entry, attributes it to this bill
 * and fills in the cost, in one transaction. That link is what stops the
 * P&L counting the same rupees twice — once as this leg's cost and again
 * in operating expenses — which is what happened when the cash was
 * recorded on /expenses and the cost typed in here separately.
 *
 * **Cost only** stays for the case it was built for: their invoice
 * routinely arrives weeks before it is paid, and the margin should not
 * wait on the bank. It is deliberately the quieter of the two, because
 * the number without the cash is the half that leaves the books
 * incomplete.
 *
 * Both are editable at any point in the bill's life, including after
 * settlement: what the seller paid is an independent fact from what we
 * paid, and blocking either on the other would only produce a guess. A
 * guessed cost is worse than a missing one — the P&L can say "not
 * measured", it cannot say "measured, but made up".
 */
export function OurCostCell({ row }: { readonly row: FreightChargeView }): ReactElement {
  const t = useT();
  // Read here rather than threaded down: the gate is cosmetic (FE-2 —
  // the server is the boundary), and a prop through every row exists
  // only to be forgotten on the next one added.
  const canWrite = usePermission('money.freight.manage');
  const [costOpen, setCostOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const margin = row.ourCostInr === null ? null : Number(row.totalInr) - Number(row.ourCostInr);

  return (
    <>
      {row.ourCostInr === null ? (
        canWrite ? (
          <div className="mk-cell mk-cell--end">
            {/* Loud on purpose. An unrecorded forwarder cost makes this
                consignment read as pure profit, and nothing else on the
                page says so. */}
            <Button size="sm" icon={<Banknote size={14} />} onClick={() => setPayOpen(true)}>
              {t('freightOurCostCell.recordPayment')}
            </Button>
            <button
              type="button"
              className="mk-inline-link mk-small"
              onClick={() => setCostOpen(true)}
            >
              {t('freightOurCostCell.costOnlyNotPaidYet')}
            </button>
          </div>
        ) : (
          <span className="mk-text mk-small" data-tone="warn">
            {t('freightOurCostCell.notRecorded')}
          </span>
        )
      ) : (
        <div className="mk-cell mk-cell--end">
          <button
            type="button"
            className="mk-inline-link mk-cell mk-cell--end"
            onClick={() => canWrite && setCostOpen(true)}
            disabled={!canWrite}
          >
            <Money amount={row.ourCostInr} />
            {margin !== null && (
              <span
                className="mk-text mk-small"
                data-tone={margin < 0 ? 'critical' : undefined}
                title={t('freightOurCostCell.whatWeBilledTheClient')}
              >
                <Money
                  amount={margin}
                  currency="INR"
                  convert={false}
                  direction={margin < 0 ? 'debit' : 'credit'}
                />{' '}
                margin
              </span>
            )}
          </button>
          {canWrite && (
            <button
              type="button"
              className="mk-inline-link mk-small"
              onClick={() => setPayOpen(true)}
            >
              {t('freightOurCostCell.recordAPayment')}
            </button>
          )}
        </div>
      )}

      {costOpen && <CostOnlyModal row={row} onClose={() => setCostOpen(false)} />}
      {payOpen && <PayForwarderModal row={row} onClose={() => setPayOpen(false)} />}
    </>
  );
}

/** The number only — for an invoice that has arrived but is not paid. */
function CostOnlyModal({
  row,
  onClose,
}: {
  readonly row: FreightChargeView;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const set = useSetFreightOurCost();
  const [value, setValue] = useState(row.ourCostInr ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    if (value.trim() === '' || Number.isNaN(Number(value))) {
      setError(t('freightOurCostCell.enterWhatTheForwarderCharged'));
      // Rejected, so the button says it did not save.
      throw new Error('invalid');
    }
    try {
      await set.mutateAsync({ freightChargeId: row.id, ourCostInr: Number(value).toFixed(2) });
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      locked={set.isPending}
      title={t('freightOurCostCell.whatDidTheForwarderCharge')}
      description={t('freightOurCostCell.theCostOnlyNoMoney')}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={set.isPending}>
            {t('freightOurCostCell.cancel')}
          </Button>
          <AsyncButton
            labels={{
              idle: t('freightOurCostCell.save'),
              busy: t('freightOurCostCell.saving'),
              done: t('freightOurCostCell.saved'),
              error: t('freightOurCostCell.refused'),
            }}
            onAction={save}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        <TextField
          label={t('freightOurCostCell.forwarderSChargeInr')}
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 8500.00"
          autoFocus
        />
        <p className="mk-small">
          {t('freightOurCostCell.billedToTheClient')} <Money amount={row.totalInr} />
        </p>
        {error !== null && <MkAlert>{error}</MkAlert>}
      </div>
    </Dialog>
  );
}

/** The cash and the attribution, in one act. */
function PayForwarderModal({
  row,
  onClose,
}: {
  readonly row: FreightChargeView;
  readonly onClose: () => void;
}): ReactElement {
  const t = useT();
  const pay = usePayForwarder();
  const banks = usePlatformBankAccounts(usePermission('money.view'));
  const [bankAccountId, setBankAccountId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Generated ONCE per opening of this modal and reused on every retry:
  // a double-click, or a retry after a timeout that actually landed, is
  // then the same request and the server records the payment once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // EVERY active account, not just the INR ones. The forwarder is a
  // Bangladeshi business and is routinely paid in BDT from a BDT
  // account; filtering those out made the ordinary case unrecordable.
  const accounts = (banks.data ?? []).filter((b) => b.isActive);
  const account = accounts.find((b) => b.id === bankAccountId);
  const crossCurrency = account !== undefined && account.currency !== 'INR';

  async function save(): Promise<void> {
    setError(null);
    if (bankAccountId === '' || amountPaid.trim() === '' || Number.isNaN(Number(amountPaid))) {
      setError(t('freightOurCostCell.chooseTheAccountAndEnter'));
      // Rejected, so the button says it did not save.
      throw new Error('invalid');
    }
    try {
      await pay.mutateAsync({
        freightChargeId: row.id,
        bankAccountId,
        amountPaid: Number(amountPaid).toFixed(2),
        occurredAt: new Date(`${occurredAt}T00:00:00Z`).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        idempotencyKey,
      });
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      locked={pay.isPending}
      title={t('freightOurCostCell.payTheForwarder')}
      description={t('freightOurCostCell.recordsTheMoneyLeavingThe')}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pay.isPending}>
            {t('freightOurCostCell.cancel')}
          </Button>
          <AsyncButton
            labels={{
              idle: t('freightOurCostCell.recordThePayment'),
              busy: t('freightOurCostCell.recording'),
              done: t('freightOurCostCell.recorded'),
              error: t('freightOurCostCell.refused'),
            }}
            onAction={save}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        <Select
          label={t('freightOurCostCell.paidFrom')}
          requiredMark
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
        >
          <option value="">{t('freightOurCostCell.chooseAnAccount')}</option>
          {accounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} · {b.bankName} · {b.currency}
            </option>
          ))}
        </Select>
        <div className="mk-form mk-form--2">
          <TextField
            label={t('freightOurCostCell.amountPaid', {
              value: account === undefined ? '' : ` (${account.currency})`,
            })}
            requiredMark
            hint={
              crossCurrency
                ? t('freightOurCostCell.whatActuallyLeftThatAccount')
                : t('freightOurCostCell.whatLeftTheAccount')
            }
            type="number"
            step="0.01"
            min="0"
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            placeholder="e.g. 8500.00"
            autoFocus
          />
          <DateField
            label={t('freightOurCostCell.datePaid')}
            requiredMark
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </div>
        <TextField
          label={t('freightOurCostCell.reference')}
          hint={t('freightOurCostCell.theirInvoiceNumberOrThe')}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          inputClassName="sk-ident"
        />
        <MkDl
          items={[
            {
              label: t('freightOurCostCell.billedToTheClientFor'),
              value: <Money amount={row.totalInr} />,
            },
            ...(row.ourCostInr === null
              ? []
              : [
                  {
                    label: t('freightOurCostCell.paidToTheForwarderSo'),
                    value: <Money amount={row.ourCostInr} />,
                  },
                ]),
          ]}
        />
        {error !== null && <MkAlert>{error}</MkAlert>}
      </div>
    </Dialog>
  );
}
