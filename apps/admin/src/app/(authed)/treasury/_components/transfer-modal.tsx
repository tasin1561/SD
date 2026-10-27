'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { useRecordTransfer, useTreasuryOverview } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { useFxRatesList, useSellersList } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { localNow } from '@/lib/datetime-local';
import { Notice } from './money-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * Money moving between two of our own accounts.
 *
 * BOTH amounts are entered, never one derived from a rate. What left the
 * sending account and what arrived in the receiving one are two facts
 * from two statements, and computing the second from the first would
 * quietly absorb every bank charge and every difference between the rate
 * we were quoted and the rate we got.
 *
 * When the money is a SELLER's and the currencies differ, the quoted
 * rate is a promise: they are credited at the rate they were shown, and
 * the difference between that and what we actually achieved is booked as
 * ours — positive or negative. Honouring a quote that moved against us
 * is a real cost and it is recorded as one. Only INTO another currency:
 * into rupees there is nothing to quote (their wallet is in rupees), and
 * the server refuses one.
 */
export function TransferModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const t = useT();

  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  // Seeds the quoted rate. Gated: this page is `money.treasury.view` and
  // reading FX is its own permission, so an operator who may move money
  // but not read rates gets no seed rather than a 403 on open.
  const fxRates = useFxRatesList(usePermission('fx.view'));
  const sellers = useSellersList({ status: 'APPROVED', page: 1, pageSize: 100 });
  const transfer = useRecordTransfer();

  const [fromAccountId, setFrom] = useState('');
  const [toAccountId, setTo] = useState('');
  const [amountOut, setOut] = useState('');
  const [amountIn, setIn] = useState('');
  const [quotedRate, setQuoted] = useState('');
  const [quotedTouched, setQuotedTouched] = useState(false);
  const [sellerId, setSellerId] = useState('');
  const [movedAt, setMovedAt] = useState(localNow);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One key per opening of the form, kept across retries: a retried
  // request with it is answered with the transfer already recorded, so a
  // double-click or a timed-out save cannot move the money twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setIdempotencyKey(crypto.randomUUID());
  }, [open]);

  const list = accounts.data ?? [];
  const from = list.find((a) => a.id === fromAccountId);

  /*
    Only asked for while the modal is open — the overview is a heavy
    read and this is a hint on one field.
  */
  const overview = useTreasuryOverview(open);
  const heldHere = useMemo(() => {
    if (sellerId === '' || fromAccountId === '') return null;
    const account = overview.data?.accounts.find((a) => a.accountId === fromAccountId);
    if (account === undefined) return null;
    // Absent from `bySeller` means they hold nothing here, which is the
    // most useful thing this hint can say — not a reason to stay quiet.
    return account.bySeller.find((b) => b.sellerId === sellerId)?.amount ?? '0.00';
  }, [overview.data, fromAccountId, sellerId]);
  const to = list.find((a) => a.id === toAccountId);
  const crossCurrency = from !== undefined && to !== undefined && from.currency !== to.currency;
  // A quote only means something when a seller's money leaves rupees for
  // another currency. INTO rupees the server refuses one
  // (TRANSFER_QUOTE_INTO_WALLET_CURRENCY) — they are credited what the money
  // was worth to their wallet and the gap is ours — so the field is hidden
  // and its value never sent: it is seeded from the system rate, and a
  // hidden seed would turn every such transfer into that refusal.
  const intoWalletCurrency = sellerId !== '' && crossCurrency && to?.currency === 'INR';
  const quoteApplies = sellerId !== '' && crossCurrency && !intoWalletCurrency;

  // The rate the SYSTEM holds for this direction — what the seller would
  // have been quoted. Seeded into the field rather than left blank,
  // because the two obvious things to type are both wrong: a blank rate
  // credits them nothing, and the ACHIEVED rate credits them exactly
  // what the bank gave us, which is the one number TRE-5 says is NOT the
  // quote. The gap between quote and achieved is the whole point of
  // FX_SPREAD, and it can only exist if the quote is recorded.
  const systemRate = useMemo(() => {
    if (from === undefined || to === undefined || from.currency === to.currency) return null;
    const row = (fxRates.data ?? []).find(
      (r) => r.fromCurrency === from.currency && r.toCurrency === to.currency,
    );
    return row?.rate ?? null;
  }, [fxRates.data, from, to]);

  useEffect(() => {
    // Seed once, and never over a figure somebody has typed.
    if (quotedTouched || systemRate === null) return;
    if (quotedRate === '') setQuoted(systemRate);
  }, [systemRate, quotedTouched, quotedRate]);

  const achieved = useMemo(() => {
    const o = Number(amountOut);
    const i = Number(amountIn);
    if (!Number.isFinite(o) || !Number.isFinite(i) || o <= 0) return null;
    return (i / o).toFixed(6);
  }, [amountOut, amountIn]);

  const [confirming, setConfirming] = useState(false);

  // The form's checks, unchanged, run before the confirm step opens.
  function review(): void {
    setError(null);
    if (fromAccountId === '' || toAccountId === '') {
      setError(t('treasuryTransferModal.pickBothAccounts'));
      return;
    }
    if (fromAccountId === toAccountId) {
      setError(t('treasuryTransferModal.anAccountCannotPayItself'));
      return;
    }
    const o = Number(amountOut);
    const i = Number(amountIn);
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(i) || i <= 0) {
      setError(t('treasuryTransferModal.enterWhatLeftAndWhat'));
      return;
    }
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    const o = Number(amountOut);
    const i = Number(amountIn);
    try {
      await transfer.mutateAsync({
        fromAccountId,
        toAccountId,
        amountOut: o.toFixed(2),
        amountIn: i.toFixed(2),
        ...(intoWalletCurrency || quotedRate.trim() === ''
          ? {}
          : { quotedRate: Number(quotedRate).toFixed(6) }),
        ...(sellerId === '' ? {} : { sellerId }),
        movedAt: new Date(movedAt).toISOString(),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        idempotencyKey,
      });
      setOut('');
      setIn('');
      setQuoted('');
      setReference('');
      setNote('');
      setConfirming(false);
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry
      // (the same idempotency key goes with the retry).
      throw err;
    }
  }

  const sellerName =
    sellerId === ''
      ? null
      : ((sellers.data?.items ?? []).find((x) => x.id === sellerId)?.companyName ??
        t('treasuryTransferModal.aClient'));
  const whenLabel = movedAt === '' ? '' : new Date(movedAt).toLocaleString('en-IN');

  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setError(null);
        }}
        icon={<ArrowLeftRight size={18} />}
        size="lg"
        title={t('treasuryTransferModal.moveMoneyBetweenAccounts')}
        description={t('treasuryTransferModal.bothSidesAreEnteredFrom')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('treasuryTransferModal.cancel')}
            </Button>
            <Button variant="primary" onClick={review} disabled={transfer.isPending}>
              {t('treasuryTransferModal.reviewTransfer')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <div className="mo-fields" data-cols="2">
            <Select
              label={t('treasuryTransferModal.from')}
              requiredMark
              value={fromAccountId}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">{t('treasuryTransferModal.select')}</option>
              {list
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.currency}
                  </option>
                ))}
            </Select>
            <Select
              label={t('treasuryTransferModal.to')}
              requiredMark
              value={toAccountId}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">{t('treasuryTransferModal.select')}</option>
              {list
                .filter((a) => a.isActive && a.id !== fromAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.currency}
                  </option>
                ))}
            </Select>
          </div>

          <div className="mo-fields" data-cols="2">
            <TextField
              label={t('treasuryTransferModal.left2', { value: from ? ` (${from.currency})` : '' })}
              requiredMark
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              inputClassName="sk-figure"
              value={amountOut}
              onChange={(e) => setOut(e.target.value)}
            />
            <TextField
              label={t('treasuryTransferModal.arrived2', { value: to ? ` (${to.currency})` : '' })}
              requiredMark
              hint={
                achieved !== null && crossCurrency
                  ? t('treasuryTransferModal.achievedRate', { achieved })
                  : undefined
              }
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              inputClassName="sk-figure"
              value={amountIn}
              onChange={(e) => setIn(e.target.value)}
            />
          </div>

          <Select
            label={t('treasuryTransferModal.whoseMoney')}
            hint={t('treasuryTransferModal.leaveAsOursUnlessThis')}
            /*
              WHAT THEY ACTUALLY HOLD IN THE SENDING ACCOUNT.

              Informational, never a gate — the server refuses an
              over-attributed transfer with TRANSFER_EXCEEDS_SELLER_HOLDING
              and stays the boundary (FE-2). But "whose money" is a choice
              somebody makes from a dropdown, and choosing a seller who has
              nothing in this account is an easy mistake to make silently.
              Showing the figure beside the choice is how it stops being
              silent.
            */
            notice={
              heldHere === null
                ? undefined
                : t('treasuryTransferModal.holdsForThemATransfer', {
                    value: from?.label ?? t('treasuryTransferModal.thisAccount'),
                    heldHere,
                    value2: from?.currency ?? '',
                  })
            }
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
          >
            <option value="">{t('treasuryTransferModal.ours')}</option>
            {(sellers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>

          {intoWalletCurrency && (
            <p className="mo-p">
              {t('treasuryTransferModal.intoRupeesThereIsNo', {
                value: from?.label ?? t('treasuryTransferModal.theSendingAccount'),
              })}
            </p>
          )}

          {quoteApplies && (
            <TextField
              label={t('treasuryTransferModal.rateQuotedToTheClient')}
              hint={
                systemRate === null
                  ? t('treasuryTransferModal.theyAreCreditedAtThis')
                  : t('treasuryTransferModal.fromTheSystemRateThey', {
                      systemRate,
                      value: achieved ?? '—',
                    })
              }
              type="number"
              inputMode="decimal"
              step="0.000001"
              min="0"
              inputClassName="sk-figure"
              value={quotedRate}
              onChange={(e) => {
                setQuotedTouched(true);
                setQuoted(e.target.value);
              }}
              placeholder={systemRate ?? achieved ?? '0.000000'}
            />
          )}

          <div className="mo-fields" data-cols="2">
            <DateField
              type="datetime-local"
              label={t('treasuryTransferModal.when')}
              requiredMark
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
            />
            <TextField
              label={t('treasuryTransferModal.reference')}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
              inputClassName="sk-ident"
            />
          </div>
          <TextArea
            label={t('treasuryTransferModal.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />

          {quoteApplies && quotedRate.trim() !== '' && amountOut !== '' && (
            <Notice tone={Number(quotedRate) > 0 ? 'neutral' : 'warn'}>
              <p>
                {Number(quotedRate) > 0 ? (
                  <>
                    {richMessage(t('treasuryTransferModal.theClientWouldBeCredited'), {
                      money: (
                        <Money
                          amount={(Number(amountOut) * Number(quotedRate)).toFixed(2)}
                          currency={to?.currency === 'BDT' ? 'BDT' : 'INR'}
                          convert={false}
                        />
                      ),
                    })}
                  </>
                ) : (
                  /* A zero rate is not a quote, it is an unfilled field. Stated
                     calmly it reads as arithmetic; what it actually does is
                     move the seller's whole balance to us. */
                  <>{t('treasuryTransferModal.aRateOfZeroCredits')}</>
                )}
              </p>
            </Notice>
          )}

          {error !== null && !confirming && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={open && confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={t('treasuryTransferModal.recordThisTransfer')}
        entity={`${from?.label ?? 'From'} → ${to?.label ?? 'To'}`}
        amount={
          <span className="mo-stack mo-stack--tight">
            <span>
              {t('treasuryTransferModal.left')}{' '}
              <Money
                amount={Number(amountOut).toFixed(2)}
                currency={from?.currency === 'BDT' ? 'BDT' : 'INR'}
                convert={false}
              />
            </span>
            <span>
              {t('treasuryTransferModal.arrived')}{' '}
              <Money
                amount={Number(amountIn).toFixed(2)}
                currency={to?.currency === 'BDT' ? 'BDT' : 'INR'}
                convert={false}
              />
            </span>
          </span>
        }
        consequence={t('treasuryTransferModal.recordsLeavingAndArrivingIn', {
          value: from?.currency ?? '',
          value2: from?.label ?? t('treasuryTransferModal.theSendingAccount'),
          value3: to?.currency ?? '',
          value4: to?.label ?? t('treasuryTransferModal.theReceivingAccount'),
          whenLabel,
          value5:
            sellerName === null
              ? t('treasuryTransferModal.ourOwnMoney')
              : t('treasuryTransferModal.moneyHeldFor', { sellerName }),
        })}
        confirmLabel={t('treasuryTransferModal.recordTransfer')}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
