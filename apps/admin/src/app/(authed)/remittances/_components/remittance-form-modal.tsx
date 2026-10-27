'use client';

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Info } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import type { CreateRemittanceRequest } from '@skydrop/api-client';
import { useCreateRemittance, useSellersList, useSellerWalletBalance } from '@/lib/api-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { PayoutInstructionPanel } from './payout-instruction-panel';
import { serverVerdict } from '@/lib/server-verdict';
import { MkAlert, MkCallout, MkDl } from '../../seller-wallets/_components/money-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

/**
 * Record a remittance. Two-currency model:
 *   sourceCurrency / sourceAmount  — the side that DEBITS the wallet
 *                                    (typically INR; that's where COD lands)
 *   currency       / amount        — the side that hit the BANK
 *                                    (typically BDT for BD sellers)
 *   fxRateSnapshot                 — what FX was applied (1 for same-currency)
 *
 * Server validates: bank details present, fx consistency, balance suffices.
 * FE-2: server rejection surfaces `[code] message` VERBATIM.
 */
export function RemittanceFormModal({
  initialSellerId,
  settling,
  onClose,
  onSuccess,
}: {
  readonly initialSellerId?: string;
  /**
   * The withdrawal request this is settling, when the form was opened
   * to pay one. The amount is prefilled from it and a difference is
   * warned about — the caller knows which request it is paying, and
   * throwing that away is what let a ₹300 payment sit against a ₹500
   * request with nothing saying so.
   */
  readonly settling?: { readonly requestId: string; readonly amountInr: string };
  readonly onClose: () => void;
  /**
   * Handed the remittance that was just created, so a caller who opened
   * this to pay a specific withdrawal can close that request without
   * anybody copying an id between two screens.
   */
  readonly onSuccess: (created: { id: string }) => void;
}): ReactElement {
  const t = useT();

  // 100 is the endpoint's MAXIMUM (@Max(100) on the query DTO); asking
  // for 200 is a 400 and this select renders empty, which reads as "there
  // are no approved sellers".
  const sellers = useSellersList({ status: 'APPROVED', page: 1, pageSize: 100 });
  const create = useCreateRemittance();
  const bankAccounts = usePlatformBankAccounts();

  const [sellerId, setSellerId] = useState(initialSellerId ?? '');
  const balance = useSellerWalletBalance(sellerId);
  // Fixed, not chosen: the wallet is INR-canonical. Every entry the
  // system writes is INR, and taka is a conversion of the balance rather
  // than a pot that could be debited.
  const sourceCurrency = 'INR' as const;
  const [currency, setCurrency] = useState<'INR' | 'BDT'>('BDT');
  // Prefilled from the request being settled. The default is the
  // common case; typing over it is still allowed, because what leaves
  // the bank is the operator's fact and a part payment is a real thing.
  const [sourceAmount, setSourceAmount] = useState(settling?.amountInr ?? '');

  // What will be sent, when it differs from what was asked for. Null
  // when there is no request, or the figures agree, or nothing is typed
  // yet — a warning that fires mid-keystroke is noise.
  const mismatch = (() => {
    if (settling === undefined || sourceAmount.trim() === '') return null;
    const typed = Number(sourceAmount);
    if (!Number.isFinite(typed) || typed <= 0) return null;
    return typed === Number(settling.amountInr) ? null : typed.toFixed(2);
  })();

  // Seeded from the rate the SYSTEM holds (M16 `FxRateService`, the same
  // one the balance panel above converts with), not from a number typed
  // into this file. It was hardcoded '1.38' while the panel two inches
  // higher was converting at the real rate — the operator was shown two
  // different rates on one screen and the wrong one was the editable
  // one, so a payout could be booked at a rate nobody set.
  //
  // Still EDITABLE, deliberately: what the bank actually achieved is the
  // operator's fact, and TRE-5 records the gap against our quote as
  // FX_SPREAD rather than pretending the quote was the outcome.
  /**
   * More than the wallet holds.
   *
   * The server refuses this outright (INSUFFICIENT_WALLET_BALANCE, read
   * live INSIDE the write transaction), so this is UX, not the guard —
   * but finding out at submit means retyping a form you had finished.
   *
   * The cap is the WALLET, not what we physically hold for this seller
   * in the paying account. Those are different questions: the wallet is
   * what we OWE them, and paying more than we happen to be holding for
   * them just draws on our capital, which is normal (TRE-4/TRE-8). What
   * must never happen is paying out more than the debt.
   */
  const overBalance = (() => {
    const held = (balance.data?.balances ?? []).find(
      (b) => b.currency === sourceCurrency && !b.isConverted,
    );
    if (held === undefined || sourceAmount.trim() === '') return null;
    const asked = Number(sourceAmount);
    const have = Number(held.balance);
    if (!Number.isFinite(asked) || !Number.isFinite(have) || asked <= have) return null;
    return { asked: asked.toFixed(2), have: held.balance };
  })();

  const [fxRate, setFxRate] = useState('');
  const [fxTouched, setFxTouched] = useState(false);
  const [bankReference, setBankReference] = useState('');
  const [paidFromAccountId, setPaidFromAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(toLocalDt(new Date()));
  const [note, setNote] = useState('');
  // What the bank took for sending it, in the bank currency. Ours — booked
  // as a bank charge — so it never reduces what the seller receives.
  const [bankFee, setBankFee] = useState('');
  const [busy, setBusy] = useState(false);
  // Only accounts held in the currency that hits the seller's bank. The
  // server refuses a mismatch outright (BANK_CURRENCY_MISMATCH); offering
  // the choice at all would just be a slower way to reach that error.
  useEffect(() => {
    // Switching the bank currency invalidates the chosen account — a
    // stale id here would be a BDT payout booked against an INR bank.
    setPaidFromAccountId((prev) =>
      prev && !(bankAccounts.data ?? []).some((a) => a.id === prev && a.currency === currency)
        ? ''
        : prev,
    );
  }, [currency, bankAccounts.data]);

  const matchingAccounts = useMemo(
    () => (bankAccounts.data ?? []).filter((a) => a.currency === currency && a.isActive),
    [bankAccounts.data, currency],
  );
  const [error, setError] = useState<string | null>(null);
  // One key for the life of this form (it mounts per opening), kept
  // across retries: a retried save is answered with the remittance
  // already recorded, so the seller's wallet is never debited twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // The checked request, waiting on the restating confirm. The SAME body
  // (and so the same idempotency key) is what the confirm sends.
  const [confirming, setConfirming] = useState<CreateRemittanceRequest | null>(null);
  const formId = useId();

  // Same-currency → force fxRate=1.
  useEffect(() => {
    if (sourceCurrency === currency && fxRate !== '1') {
      setFxRate('1');
    }
  }, [sourceCurrency, currency, fxRate]);

  // The system rate for this pair, as carried on the converted balance
  // line. Null until the balance loads, and absent entirely if no rate
  // is configured — in which case the field stays empty and the
  // operator supplies one rather than being handed a guess.
  const systemFxRate = useMemo(() => {
    if (sourceCurrency === currency) return null;
    const converted = (balance.data?.balances ?? []).find(
      (b) => b.currency === currency && b.isConverted,
    );
    return converted?.fxRate ?? null;
  }, [balance.data, sourceCurrency, currency]);

  useEffect(() => {
    // Seed once, and never over a number the operator has typed.
    if (fxTouched || sourceCurrency === currency) return;
    if (systemFxRate !== null && fxRate === '') setFxRate(String(systemFxRate));
  }, [systemFxRate, fxTouched, fxRate, sourceCurrency, currency]);

  // Derived destination amount = source × fx (always recomputed).
  const destAmount = useMemo(() => {
    const s = Number(sourceAmount);
    const f = Number(fxRate);
    if (!Number.isFinite(s) || !Number.isFinite(f) || s <= 0 || f <= 0) return '';
    return (s * f).toFixed(2);
  }, [sourceAmount, fxRate]);

  // What leaves our account in all: the payout plus the bank's fee. Null
  // while there is no fee to add, so the line only appears when it says
  // something the destination amount does not.
  const leavesAccount = useMemo(() => {
    const d = Number(destAmount);
    const f = Number(bankFee);
    if (bankFee.trim() === '' || !Number.isFinite(f) || f <= 0 || !Number.isFinite(d)) return null;
    return (d + f).toFixed(2);
  }, [destAmount, bankFee]);

  function fmtError(e: unknown): string {
    return serverVerdict(e, t('remittancesRemittanceFormModal.actionFailed'));
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!sellerId) {
      setError(t('remittancesRemittanceFormModal.pickAClient'));
      return;
    }
    const src = Number(sourceAmount);
    const dst = Number(destAmount);
    const fx = Number(fxRate);
    if (!Number.isFinite(src) || src <= 0) {
      setError(t('remittancesRemittanceFormModal.sourceAmountMustBeA'));
      return;
    }
    if (!Number.isFinite(fx) || fx <= 0) {
      setError(t('remittancesRemittanceFormModal.fxRateMustBeA'));
      return;
    }
    if (!bankReference.trim()) {
      setError(t('remittancesRemittanceFormModal.bankReferenceRequired'));
      return;
    }
    if (!paidFromAccountId) {
      setError(t('remittancesRemittanceFormModal.sayWhichOfOurAccounts'));
      return;
    }
    const fee = bankFee.trim() === '' ? null : Number(bankFee);
    if (fee !== null && !Number.isFinite(fee)) {
      setError(t('remittancesRemittanceFormModal.bankFeeMustBeA'));
      return;
    }
    const body: CreateRemittanceRequest = {
      sellerId,
      currency,
      amount: dst,
      sourceCurrency,
      sourceAmount: src,
      fxRateSnapshot: fx,
      bankReference: bankReference.trim(),
      paidFromAccountId,
      paidAt: new Date(paidAt).toISOString(),
      ...(note.trim() ? { note: note.trim() } : {}),
      // Sent as typed: the server decides what a valid fee is (FE-2).
      ...(fee !== null ? { bankFee: fee } : {}),
      idempotencyKey,
    };
    // Checked; now restated before it is sent (a remittance debits the
    // seller's wallet and records cash leaving our account).
    setConfirming(body);
  }

  /** The confirmed request, exactly as checked. Rejects on a refusal. */
  async function post(): Promise<void> {
    if (confirming === null) return;
    setError(null);
    setBusy(true);
    try {
      const created = await create.mutateAsync(confirming);
      setConfirming(null);
      onSuccess(created);
    } catch (err) {
      setError(fmtError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const sellerName =
    sellers.data?.items.find((x) => x.id === (confirming?.sellerId ?? sellerId))?.companyName ??
    null;
  const paidFrom = (bankAccounts.data ?? []).find((a) => a.id === confirming?.paidFromAccountId);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        locked={busy}
        title={t('remittancesRemittanceFormModal.recordRemittance')}
        description={t('remittancesRemittanceFormModal.debitsTheClientSWallet')}
        size="lg"
        footer={
          <DialogFooter>
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={onClose}>
              {t('remittancesRemittanceFormModal.cancel')}
            </Button>
            <Button type="submit" form={formId} variant="primary" size="md" disabled={busy}>
              {busy
                ? t('remittancesRemittanceFormModal.recording')
                : t('remittancesRemittanceFormModal.recordRemittance')}
            </Button>
          </DialogFooter>
        }
      >
        <form id={formId} onSubmit={(e) => void onSubmit(e)} className="mk-stack">
          <Select
            label={t('remittancesRemittanceFormModal.client')}
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            required
            disabled={sellers.isLoading || Boolean(initialSellerId)}
          >
            <option value="">
              {sellers.isLoading
                ? t('remittancesRemittanceFormModal.loadingClients')
                : t('remittancesRemittanceFormModal.selectAClient')}
            </option>
            {sellers.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName} · {s.email}
              </option>
            ))}
          </Select>

          {sellerId && (
            <div className="mk-panel">
              <div className="mk-panel__part">
                <p className="mk-panel__title">
                  {t('remittancesRemittanceFormModal.currentWalletBalance')}
                </p>
                {balance.isLoading ? (
                  <Skeleton height={16} width="50%" />
                ) : balance.isError ? (
                  <div className="mk-text" data-tone="critical">
                    {serverVerdict(
                      balance.error,
                      t('remittancesRemittanceFormModal.failedToLoadBalance'),
                    )}
                  </div>
                ) : (
                  <div className="mk-balances">
                    {(balance.data?.balances ?? []).map((b) => {
                      const amt = Number(b.balance);
                      const money = (
                        <Money
                          amount={b.balance}
                          currency={b.currency === 'BDT' ? 'BDT' : 'INR'}
                          convert={false}
                        />
                      );
                      // A converted figure is the same money in another
                      // currency, so it cannot be clicked to fill a wallet
                      // debit — there is no taka pot to debit from.
                      return (
                        <div key={b.currency} className="mk-balances">
                          <span className="mk-small">
                            {b.currency}
                            {b.isConverted ? ' (≈)' : ''}:
                          </span>
                          {b.isConverted ? (
                            <span
                              className="mk-small"
                              title={
                                b.fxRate === null
                                  ? ''
                                  : t('remittancesRemittanceFormModal.convertedAt1', {
                                      fxRate: b.fxRate,
                                    })
                              }
                            >
                              {money}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSourceAmount(b.balance)}
                              disabled={amt <= 0}
                              className="mk-inline-link"
                              title={
                                amt > 0
                                  ? t('remittancesRemittanceFormModal.clickToFillSourceAmount')
                                  : ''
                              }
                            >
                              {money}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mk-form mk-form--2">
            <TextField
              label={t('remittancesRemittanceFormModal.walletCurrencyDebit')}
              hint={t('remittancesRemittanceFormModal.theWalletIsKeptIn')}
              value="INR"
              disabled
              readOnly
            />
            <Select
              label={t('remittancesRemittanceFormModal.bankCurrencyCreditHitAccount')}
              requiredMark
              value={currency}
              onChange={(e) => setCurrency(e.target.value as 'INR' | 'BDT')}
            >
              <option value="INR">INR</option>
              <option value="BDT">BDT</option>
            </Select>
          </div>

          <div className="mk-form mk-form--2">
            <TextField
              label={t('remittancesRemittanceFormModal.sourceAmount', { sourceCurrency })}
              type="number"
              min={0.01}
              step="0.01"
              value={sourceAmount}
              onChange={(e) => setSourceAmount(e.target.value)}
              required
            />
            <TextField
              label={t('remittancesRemittanceFormModal.fxRate')}
              hint={
                sourceCurrency === currency
                  ? t('remittancesRemittanceFormModal.sameCurrencyLockedAt1')
                  : systemFxRate === null
                    ? t('remittancesRemittanceFormModal.1XNoSystemRate', {
                        sourceCurrency,
                        currency,
                      })
                    : fxTouched && fxRate !== String(systemFxRate)
                      ? t('remittancesRemittanceFormModal.1XSystemRateIs', {
                          sourceCurrency,
                          currency,
                          systemFxRate,
                        })
                      : t('remittancesRemittanceFormModal.1XFromTheSystem', {
                          sourceCurrency,
                          currency,
                          systemFxRate,
                        })
              }
              type="number"
              min={0.000001}
              step="0.000001"
              value={fxRate}
              onChange={(e) => {
                setFxTouched(true);
                setFxRate(e.target.value);
              }}
              disabled={sourceCurrency === currency}
              required
            />
          </div>

          <TextField
            label={t('remittancesRemittanceFormModal.destinationAmount', { currency })}
            hint={t('remittancesRemittanceFormModal.derivedSourceFx')}
            value={destAmount}
            readOnly
            disabled
            floatLabel
          />

          {/* Where it goes, and whether any one of our accounts can send
              it. Both were absent from the screen that records the
              payment, so the operator had to leave to find the first and
              could only discover the second by failing. */}
          {sellerId !== '' && (
            <PayoutInstructionPanel sellerId={sellerId} currency={currency} amount={destAmount} />
          )}

          <Select
            label={t('remittancesRemittanceFormModal.paidFrom')}
            required
            hint={
              matchingAccounts.length === 0
                ? t('remittancesRemittanceFormModal.noAccountIsSetUp', { currency })
                : t('remittancesRemittanceFormModal.whichOfOurAccountsThe')
            }
            value={paidFromAccountId}
            onChange={(e) => setPaidFromAccountId(e.target.value)}
          >
            <option value="">{t('remittancesRemittanceFormModal.selectAnAccount')}</option>
            {matchingAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.bankName} · {a.currency}
              </option>
            ))}
          </Select>

          <TextField
            label={t('remittancesRemittanceFormModal.bankFeeOptional', { currency })}
            hint={t('remittancesRemittanceFormModal.whatTheBankChargedTo')}
            type="number"
            min={0}
            step="0.01"
            value={bankFee}
            onChange={(e) => setBankFee(e.target.value)}
            placeholder="0.00"
          />
          {leavesAccount !== null && (
            <div className="mk-small">
              {richMessage(t('remittancesRemittanceFormModal.leavesOurAccountInAll'), {
                money: <Money amount={leavesAccount} currency={currency} convert={false} />,
              })}
            </div>
          )}

          <div className="mk-form mk-form--2">
            <TextField
              label={t('remittancesRemittanceFormModal.bankReference')}
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              maxLength={120}
              showCount
              placeholder={t('remittancesRemittanceFormModal.eGTrf202606')}
              required
              inputClassName="sk-ident"
            />
            <DateField
              label={t('remittancesRemittanceFormModal.paidAt')}
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              required
            />
          </div>

          <TextArea
            label={t('remittancesRemittanceFormModal.note')}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            showCount
            placeholder={t('remittancesRemittanceFormModal.anythingOpsShouldKnowAbout')}
          />

          {/*
            Paying something other than what was asked for is allowed — a
            part payment is a real thing — but it will NOT close the
            request, and finding that out afterwards is how a partly-paid
            request sits in the queue looking untouched. Said before
            recording, not after.
          */}
          {overBalance !== null && (
            <MkAlert>
              {richMessage(t('remittancesRemittanceFormModal.theWalletHoldsSoIs'), {
                money: (
                  <Money amount={overBalance.have} currency={sourceCurrency} convert={false} />
                ),
                money2: (
                  <Money amount={overBalance.asked} currency={sourceCurrency} convert={false} />
                ),
              })}
            </MkAlert>
          )}

          {mismatch !== null && (
            <MkCallout tone="warn" icon={<Info size={16} />}>
              <p>
                {richMessage(t('remittancesRemittanceFormModal.thisRequestAskedForPaying'), {
                  money: (
                    <Money amount={settling?.amountInr ?? '0'} currency="INR" convert={false} />
                  ),
                  money2: <Money amount={mismatch} currency="INR" convert={false} />,
                  span: (
                    <span className="mk-strong">
                      {t('remittancesRemittanceFormModal.notCloseIt')}
                    </span>
                  ),
                })}
              </p>
            </MkCallout>
          )}

          {error && <MkAlert>{error}</MkAlert>}
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={t('remittancesRemittanceFormModal.recordThisRemittance')}
        entity={sellerName ?? confirming?.sellerId ?? ''}
        amount={
          confirming === null ? undefined : (
            <Money
              amount={String(confirming.sourceAmount)}
              currency={confirming.sourceCurrency === 'BDT' ? 'BDT' : 'INR'}
              convert={false}
            />
          )
        }
        consequence={t('remittancesRemittanceFormModal.debitsThisClientSWallet')}
        confirmLabel={t('remittancesRemittanceFormModal.recordRemittance')}
        onConfirm={post}
        error={error}
      >
        {confirming !== null && (
          <MkDl
            items={[
              {
                label: t('remittancesRemittanceFormModal.theyReceive'),
                value: (
                  <Money
                    amount={String(confirming.amount)}
                    currency={confirming.currency === 'BDT' ? 'BDT' : 'INR'}
                    convert={false}
                  />
                ),
              },
              {
                label: t('remittancesRemittanceFormModal.rate'),
                value: (
                  <span className="sk-figure">
                    1 {confirming.sourceCurrency} = {confirming.fxRateSnapshot}{' '}
                    {confirming.currency}
                  </span>
                ),
              },
              {
                label: t('remittancesRemittanceFormModal.bankReference'),
                value: <Ident value={confirming.bankReference} />,
              },
              {
                label: t('remittancesRemittanceFormModal.paidFrom'),
                value:
                  paidFrom === undefined
                    ? confirming.paidFromAccountId
                    : `${paidFrom.label} · ${paidFrom.bankName} · ${paidFrom.currency}`,
              },
              ...(confirming.bankFee !== undefined
                ? [
                    {
                      label: t('remittancesRemittanceFormModal.bankFee'),
                      value: (
                        <Money
                          amount={String(confirming.bankFee)}
                          currency={confirming.currency === 'BDT' ? 'BDT' : 'INR'}
                          convert={false}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </ConfirmDialog>
    </>
  );
}

function toLocalDt(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
