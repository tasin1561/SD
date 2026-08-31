'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
  Textarea,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CreateRemittanceRequest } from '@skydrop/api-client';
import { useCreateRemittance, useSellersList, useSellerWalletBalance } from '@/lib/api-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';

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

  const [fxRate, setFxRate] = useState('1.38'); // sensible BDT/INR seed
  const [bankReference, setBankReference] = useState('');
  const [paidFromAccountId, setPaidFromAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(toLocalDt(new Date()));
  const [note, setNote] = useState('');
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

  // Same-currency → force fxRate=1.
  useEffect(() => {
    if (sourceCurrency === currency && fxRate !== '1') {
      setFxRate('1');
    }
  }, [sourceCurrency, currency, fxRate]);

  // Derived destination amount = source × fx (always recomputed).
  const destAmount = useMemo(() => {
    const s = Number(sourceAmount);
    const f = Number(fxRate);
    if (!Number.isFinite(s) || !Number.isFinite(f) || s <= 0 || f <= 0) return '';
    return (s * f).toFixed(2);
  }, [sourceAmount, fxRate]);

  function fmtError(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!sellerId) {
      setError('Pick a seller');
      return;
    }
    const src = Number(sourceAmount);
    const dst = Number(destAmount);
    const fx = Number(fxRate);
    if (!Number.isFinite(src) || src <= 0) {
      setError('Source amount must be a positive number');
      return;
    }
    if (!Number.isFinite(fx) || fx <= 0) {
      setError('FX rate must be a positive number');
      return;
    }
    if (!bankReference.trim()) {
      setError('Bank reference required');
      return;
    }
    if (!paidFromAccountId) {
      setError('Say which of our accounts the money left');
      return;
    }
    setBusy(true);
    try {
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
      };
      const created = await create.mutateAsync(body);
      onSuccess(created);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Record remittance"
      description="Debits the seller's wallet on the source currency + writes a paired credit on the destination currency for cross-currency remits."
      size="lg"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <FormField label="Seller" required>
          <Select
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            required
            disabled={sellers.isLoading || Boolean(initialSellerId)}
          >
            <option value="">{sellers.isLoading ? 'Loading sellers…' : 'Select a seller'}</option>
            {sellers.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName} · {s.email}
              </option>
            ))}
          </Select>
        </FormField>

        {sellerId && (
          <div className="rounded-[6px] border border-border bg-surface-raised px-3 py-2 text-xs">
            <div className="text-text-faint uppercase tracking-wide mb-1">
              Current wallet balance
            </div>
            {balance.isLoading ? (
              <div className="text-text-muted">Loading…</div>
            ) : balance.isError ? (
              <div className="text-critical">Failed to load balance</div>
            ) : (
              <div className="flex items-center gap-4 font-mono">
                {(balance.data?.balances ?? []).map((b) => {
                  const amt = Number(b.balance);
                  const money = `${b.currency === 'INR' ? '₹' : '৳'} ${amt.toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  )}`;
                  // A converted figure is the same money in another
                  // currency, so it cannot be clicked to fill a wallet
                  // debit — there is no taka pot to debit from.
                  return (
                    <div key={b.currency} className="flex items-baseline gap-1">
                      <span className="text-text-muted">
                        {b.currency}
                        {b.isConverted ? ' (≈)' : ''}:
                      </span>
                      {b.isConverted ? (
                        <span
                          className="text-text-muted"
                          title={b.fxRate === null ? '' : `Converted at ₹1 = ৳${b.fxRate}`}
                        >
                          {money}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSourceAmount(b.balance)}
                          disabled={amt <= 0}
                          className={amt > 0 ? 'text-accent hover:underline' : 'text-text-muted'}
                          title={amt > 0 ? 'Click to fill source amount' : ''}
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
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label="Wallet currency (debit)"
            hint="The wallet is kept in rupees; taka is a conversion of it, not a second pot."
          >
            <Input value="INR" disabled readOnly />
          </FormField>
          <FormField label="Bank currency (credit hit account)" required>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as 'INR' | 'BDT')}>
              <option value="INR">INR</option>
              <option value="BDT">BDT</option>
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Source amount (${sourceCurrency})`} required>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={sourceAmount}
              onChange={(e) => setSourceAmount(e.target.value)}
              required
            />
          </FormField>
          <FormField
            label="FX rate"
            hint={
              sourceCurrency === currency
                ? 'Same currency — locked at 1'
                : `1 ${sourceCurrency} = X ${currency}`
            }
            required
          >
            <Input
              type="number"
              min={0.000001}
              step="0.000001"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value)}
              disabled={sourceCurrency === currency}
              required
            />
          </FormField>
        </div>

        <FormField label={`Destination amount (${currency})`} hint="Derived = source × FX">
          <Input value={destAmount} readOnly disabled />
        </FormField>

        <FormField
          label="Paid from"
          required
          hint={
            matchingAccounts.length === 0
              ? `No ${currency} account is set up yet — add one under Bank accounts.`
              : 'Which of our accounts the money physically left'
          }
        >
          <Select
            value={paidFromAccountId}
            onChange={(e) => setPaidFromAccountId(e.target.value)}
            required
          >
            <option value="">Select an account…</option>
            {matchingAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.bankName} · {a.currency}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Bank reference" required>
            <Input
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              maxLength={120}
              placeholder="e.g. TRF-2026-06-03-12345"
              required
            />
          </FormField>
          <FormField label="Paid at" required>
            <Input
              type="datetime-local"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label="Note">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="Anything ops should know about this withdrawal"
          />
        </FormField>

        {/*
          Paying something other than what was asked for is allowed — a
          part payment is a real thing — but it will NOT close the
          request, and finding that out afterwards is how a partly-paid
          request sits in the queue looking untouched. Said before
          recording, not after.
        */}
        {mismatch !== null && (
          <div className="border-border text-text-body rounded-[5px] border border-dashed px-3 py-2 text-xs">
            This request asked for{' '}
            <Money amount={settling?.amountInr ?? '0'} currency="INR" convert={false} />. Paying{' '}
            <Money amount={mismatch} currency="INR" convert={false} /> will{' '}
            <span className="text-text-bright">not close it</span> — it stays in the queue for
            whoever settles the rest.
          </div>
        )}

        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={busy}>
            {busy ? 'Recording…' : 'Record remittance'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function toLocalDt(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
