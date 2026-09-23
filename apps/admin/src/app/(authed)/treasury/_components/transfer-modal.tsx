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
      setError('Pick both accounts');
      return;
    }
    if (fromAccountId === toAccountId) {
      setError('An account cannot pay itself');
      return;
    }
    const o = Number(amountOut);
    const i = Number(amountIn);
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(i) || i <= 0) {
      setError('Enter what left and what arrived');
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
      : ((sellers.data?.items ?? []).find((x) => x.id === sellerId)?.companyName ?? 'a seller');
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
        title="Move money between accounts"
        description="Both sides are entered from the two statements — nothing is derived from a rate."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={transfer.isPending}>
              Review transfer
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <div className="mo-fields" data-cols="2">
            <Select
              label="From"
              requiredMark
              value={fromAccountId}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">Select…</option>
              {list
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.currency}
                  </option>
                ))}
            </Select>
            <Select
              label="To"
              requiredMark
              value={toAccountId}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">Select…</option>
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
              label={`Left${from ? ` (${from.currency})` : ''}`}
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
              label={`Arrived${to ? ` (${to.currency})` : ''}`}
              requiredMark
              hint={achieved !== null && crossCurrency ? `Achieved rate ${achieved}` : undefined}
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
            label="Whose money"
            hint="Leave as ours unless this is moving a seller's balance between our accounts"
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
                : `${from?.label ?? 'This account'} holds ${heldHere} ${from?.currency ?? ''} for them. A transfer cannot move more than that.`
            }
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
          >
            <option value="">Ours</option>
            {(sellers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>

          {intoWalletCurrency && (
            <p className="mo-p">
              Into rupees there is no quote: the seller is credited what this money was worth to
              their wallet (their average rate in {from?.label ?? 'the sending account'}), and the
              difference against what arrived is booked as ours.
            </p>
          )}

          {quoteApplies && (
            <TextField
              label="Rate quoted to the seller"
              hint={
                systemRate === null
                  ? 'They are credited at this rate; the gap against what we achieved is booked as ours, either way.'
                  : `From the system rate (${systemRate}). They are credited at this rate; the gap against the ${achieved ?? '—'} we achieved is booked as ours, either way.`
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
              label="When"
              requiredMark
              value={movedAt}
              onChange={(e) => setMovedAt(e.target.value)}
            />
            <TextField
              label="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
              inputClassName="sk-ident"
            />
          </div>
          <TextArea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

          {quoteApplies && quotedRate.trim() !== '' && amountOut !== '' && (
            <Notice tone={Number(quotedRate) > 0 ? 'neutral' : 'warn'}>
              <p>
                {Number(quotedRate) > 0 ? (
                  <>
                    The seller would be credited{' '}
                    <Money
                      amount={(Number(amountOut) * Number(quotedRate)).toFixed(2)}
                      currency={to?.currency === 'BDT' ? 'BDT' : 'INR'}
                      convert={false}
                    />{' '}
                    and the remainder booked to us.
                  </>
                ) : (
                  /* A zero rate is not a quote, it is an unfilled field. Stated
                     calmly it reads as arithmetic; what it actually does is
                     move the seller's whole balance to us. */
                  <>
                    A rate of zero credits the seller NOTHING and books the entire amount to us.
                    That is almost certainly not what you mean — use the system rate, or whatever
                    you actually quoted them.
                  </>
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
        title="Record this transfer?"
        entity={`${from?.label ?? 'From'} → ${to?.label ?? 'To'}`}
        amount={
          <span className="mo-stack mo-stack--tight">
            <span>
              Left{' '}
              <Money
                amount={Number(amountOut).toFixed(2)}
                currency={from?.currency === 'BDT' ? 'BDT' : 'INR'}
                convert={false}
              />
            </span>
            <span>
              Arrived{' '}
              <Money
                amount={Number(amountIn).toFixed(2)}
                currency={to?.currency === 'BDT' ? 'BDT' : 'INR'}
                convert={false}
              />
            </span>
          </span>
        }
        consequence={`Records ${from?.currency ?? ''} leaving ${from?.label ?? 'the sending account'} and ${to?.currency ?? ''} arriving in ${to?.label ?? 'the receiving account'} on ${whenLabel}, as ${sellerName === null ? 'our own money' : `money held for ${sellerName}`}; both balances change at once.`}
        confirmLabel="Record transfer"
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
