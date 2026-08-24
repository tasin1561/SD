'use client';

import { useState, type ReactElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Check, CircleCheck, Landmark } from 'lucide-react';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  Money,
  useToast,
} from '@skydrop/ui/components';
import {
  usePresignTopupProof,
  useSubmitTopup,
  type PlatformBankAccountView,
  type TopupBankAccountsResponse,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Recording a bank transfer, one decision at a time.
 *
 * This was a single form with everything on it, and the shape was
 * wrong for the job: the account details a seller has to COPY INTO
 * THEIR BANK were hidden inside a dropdown option, so the screen asked
 * for a payment reference before it had shown them where to pay.
 *
 * The order now matches what actually happens:
 *   1. see the accounts in full, pick the one you are paying
 *   2. enter what you sent — in that account's own currency
 *   3. read what happens next
 *
 * The amount is in the BANK'S currency because that is the number on
 * the seller's transfer receipt, and asking them to convert it is
 * asking them to make an arithmetic mistake that we would then have to
 * find on a statement. The rupee equivalent is shown beside it — that
 * is what reaches the wallet, and INR is what the wallet is kept in.
 */
export function TopupWizard({
  open,
  onDone,
  banks,
  onSubmitted,
}: {
  readonly open: boolean;
  readonly onDone: () => void;
  readonly banks: UseQueryResult<TopupBankAccountsResponse>;
  readonly onSubmitted: () => void;
}): ReactElement {
  const toast = useToast();
  const presign = usePresignTopupProof();
  const submit = useSubmitTopup();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [bank, setBank] = useState<PlatformBankAccountView | null>(null);
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accounts = banks.data?.accounts ?? [];
  const inrToBdt = banks.data?.inrToBdt ?? null;

  function reset(): void {
    setStep(1);
    setBank(null);
    setAmount('');
    setTransactionRef('');
    setProof(null);
    setError(null);
  }

  const amountNum = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(amountNum) && amountNum > 0;

  /**
   * The same amount in both currencies. Rupees is the one that matters —
   * the wallet is kept in rupees and that is what gets credited — but a
   * seller paying in taka needs to recognise the number they sent, so
   * both are shown and only one is called credited.
   */
  const inrAmount =
    bank === null || !amountValid
      ? null
      : bank.currency === 'INR'
        ? amountNum
        : bank.rateToInr === null
          ? null
          : amountNum * Number(bank.rateToInr);
  const bdtAmount =
    inrAmount === null ? null : inrToBdt === null ? null : inrAmount * Number(inrToBdt);

  // Either identifies the payment on a statement. Neither does not:
  // without one we are looking for an unnamed amount on a day.
  const hasEvidence = transactionRef.trim() !== '' || proof !== null;

  async function onSubmit(): Promise<void> {
    if (bank === null || !amountValid) return;
    setError(null);
    setBusy(true);
    try {
      let proofSpacesKey: string | undefined;
      let proofMimeType: string | undefined;
      if (proof !== null) {
        const signed = await presign.mutateAsync({ mimeType: proof.type });
        const put = await fetch(signed.uploadUrl, {
          method: 'PUT',
          body: proof,
          headers: { 'Content-Type': proof.type },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        proofSpacesKey = signed.spacesKey;
        proofMimeType = proof.type;
      }
      await submit.mutateAsync({
        bankAccountId: bank.id,
        amount: amountNum,
        ...(transactionRef.trim() ? { transactionRef: transactionRef.trim() } : {}),
        ...(proofSpacesKey !== undefined && proofMimeType !== undefined
          ? { proofSpacesKey, proofMimeType }
          : {}),
      });
      onSubmitted();
      setStep(3);
    } catch (err) {
      setError(serverVerdict(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onDone();
          reset();
        }
      }}
      size="lg"
      title="Top up your wallet"
    >
      <Stepper step={step} />

      {error !== null && <ErrorNote message={error} />}

      {step === 1 && (
        <SelectBank
          accounts={accounts}
          loading={banks.isLoading}
          onPick={(a) => {
            setBank(a);
            setStep(2);
          }}
        />
      )}

      {step === 2 && bank !== null && (
        <PaymentDetails
          bank={bank}
          amount={amount}
          onAmount={setAmount}
          inrAmount={inrAmount}
          bdtAmount={bdtAmount}
          transactionRef={transactionRef}
          onTransactionRef={setTransactionRef}
          proof={proof}
          onProof={setProof}
          hasEvidence={hasEvidence}
          canSubmit={amountValid && hasEvidence && !busy}
          busy={busy}
          onBack={() => setStep(1)}
          onSubmit={() => void onSubmit()}
        />
      )}

      {step === 3 && (
        <Submitted
          onClose={() => {
            onDone();
            reset();
            toast.success('Top-up recorded. We will email you when it is verified.');
          }}
        />
      )}
    </Modal>
  );
}

function Stepper({ step }: { readonly step: 1 | 2 | 3 }): ReactElement {
  const labels = ['Choose account', 'Payment details', 'Submitted'] as const;
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step;
        const active = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ' +
                (done
                  ? 'bg-[var(--color-success)] text-white'
                  : active
                    ? 'bg-accent text-white'
                    : 'border-border text-text-faint border')
              }
            >
              {done ? <Check size={11} /> : n}
            </span>
            <span className={active ? 'text-text-bright font-medium' : 'text-text-muted'}>
              {label}
            </span>
            {n < 3 && <span className="text-text-faint px-1">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function SelectBank({
  accounts,
  loading,
  onPick,
}: {
  readonly accounts: readonly PlatformBankAccountView[];
  readonly loading: boolean;
  readonly onPick: (a: PlatformBankAccountView) => void;
}): ReactElement {
  if (loading) return <p className="text-text-muted py-4 text-sm">Loading accounts…</p>;
  if (accounts.length === 0) {
    return (
      <div className="border-border text-text-muted rounded-md border px-3 py-3 text-sm">
        We have not published a bank account yet, so there is nowhere to send money. Please contact
        support before transferring anything — a payment we have not published an account for is one
        we cannot match to you.
      </div>
    );
  }
  return (
    <>
      <p className="text-text-muted mb-3 text-sm">
        Send the money to one of these accounts first, then come back and tell us. Nothing reaches
        your balance until we match it against our statement.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            className="border-border hover:border-accent focus-visible:border-accent rounded-lg border p-3 text-left transition-colors"
          >
            <div className="mb-2 flex items-start gap-2">
              <span className="bg-accent/10 text-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                <Landmark size={15} />
              </span>
              <div className="min-w-0">
                <div className="text-text-bright text-sm font-medium">{a.bankName}</div>
                <div className="text-text-muted truncate text-xs">
                  {[a.branchName, a.district].filter(Boolean).join(' — ') || a.label}
                </div>
              </div>
              <span className="text-text-muted border-border ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px]">
                {a.currency === 'BDT' ? '৳ BDT' : '₹ INR'}
              </span>
            </div>
            <dl className="bg-surface-raised rounded-md px-2 py-1.5 text-xs">
              <div className="flex justify-between gap-2 py-0.5">
                <dt className="text-text-muted">Account name</dt>
                <dd className="text-text-body truncate font-mono">{a.accountName}</dd>
              </div>
              <div className="flex justify-between gap-2 py-0.5">
                <dt className="text-text-muted">Account number</dt>
                <dd className="text-text-body font-mono">{a.accountNumber}</dd>
              </div>
              {a.routingNumber !== null && (
                <div className="flex justify-between gap-2 py-0.5">
                  <dt className="text-text-muted">Routing</dt>
                  <dd className="text-text-body font-mono">{a.routingNumber}</dd>
                </div>
              )}
            </dl>
          </button>
        ))}
      </div>
    </>
  );
}

function PaymentDetails(props: {
  readonly bank: PlatformBankAccountView;
  readonly amount: string;
  readonly onAmount: (v: string) => void;
  readonly inrAmount: number | null;
  readonly bdtAmount: number | null;
  readonly transactionRef: string;
  readonly onTransactionRef: (v: string) => void;
  readonly proof: File | null;
  readonly onProof: (f: File | null) => void;
  readonly hasEvidence: boolean;
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}): ReactElement {
  const { bank } = props;
  const symbol = bank.currency === 'BDT' ? '৳' : '₹';
  return (
    <div className="space-y-3">
      <div className="border-accent/40 bg-accent/5 rounded-lg border p-3">
        <div className="mb-2 flex items-start gap-2">
          <span className="bg-accent/10 text-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
            <Landmark size={15} />
          </span>
          <div className="min-w-0">
            <div className="text-text-bright text-sm font-medium">{bank.bankName}</div>
            <div className="text-text-muted truncate text-xs">
              {[bank.branchName, bank.district].filter(Boolean).join(' — ') || bank.label}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={props.onBack}>
            Change
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Detail label="Account name" value={bank.accountName} />
          <Detail label="Account number" value={bank.accountNumber} />
          {bank.routingNumber !== null && (
            <Detail label="Routing number" value={bank.routingNumber} />
          )}
          {bank.district !== null && <Detail label="District" value={bank.district} />}
        </dl>
        {bank.instructions !== null && bank.instructions !== '' && (
          <p className="text-text-muted mt-2 text-xs">{bank.instructions}</p>
        )}
      </div>

      {/* In the ACCOUNT's currency, because that is the number on the
          seller's transfer receipt. Asking them to convert first is
          asking for an arithmetic mistake we would then have to find on
          a statement. */}
      <FormField
        label={`Amount you paid (${symbol} ${bank.currency})`}
        htmlFor="tw-amount"
        required
      >
        <Input
          id="tw-amount"
          className="max-w-none"
          inputMode="decimal"
          value={props.amount}
          onChange={(e) => props.onAmount(e.target.value)}
          placeholder="0.00"
        />
      </FormField>

      {props.inrAmount !== null && (
        <div className="border-border rounded-md border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-muted">Credited to your wallet</span>
            <span className="text-text-bright font-medium">
              <Money amount={props.inrAmount.toFixed(2)} currency="INR" convert={false} />
            </span>
          </div>
          {props.bdtAmount !== null && (
            <div className="text-text-faint mt-0.5 flex items-center justify-between gap-2 text-xs">
              <span>Same amount in taka</span>
              <span>
                <Money amount={props.bdtAmount.toFixed(2)} currency="BDT" convert={false} />
              </span>
            </div>
          )}
          <p className="text-text-faint mt-1 text-xs">
            Your wallet is kept in rupees, so the rupee figure is what gets credited.
          </p>
        </div>
      )}

      <FormField
        label="Transaction ID / reference"
        htmlFor="tw-ref"
        hint="From your bank's confirmation."
      >
        <Input
          id="tw-ref"
          className="max-w-none"
          value={props.transactionRef}
          onChange={(e) => props.onTransactionRef(e.target.value)}
          placeholder="e.g. TXN123456789"
        />
      </FormField>

      <FormField
        label="Payment proof"
        htmlFor="tw-proof"
        hint="A screenshot or PDF of the transfer (JPG, PNG, WEBP, PDF)."
      >
        {/* A bare file input renders as unstyled system text — "Choose
            File No file chosen" — which does not read as a control at
            all, on a step where uploading a receipt is one of only two
            ways to proceed. The `file:` variants style the button the
            browser draws for us; the filename is echoed separately
            because the native one truncates and cannot be cleared. */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="tw-proof"
            /* Remounts on clear, which resets the NATIVE value too.
               Without it the element still holds the file after Remove,
               so re-picking the same one fires no change event and the
               seller is stuck with a field that ignores them. */
            key={props.proof === null ? 'empty' : 'chosen'}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className={
              'text-text-muted min-h-[36px] max-w-full text-sm ' +
              'file:border-border file:bg-surface-raised file:text-text-body ' +
              'file:mr-3 file:cursor-pointer file:rounded-md file:border file:px-3 file:py-1.5 ' +
              'file:text-sm file:font-medium file:transition-colors ' +
              'hover:file:border-accent hover:file:text-accent'
            }
            onChange={(e) => props.onProof(e.target.files?.[0] ?? null)}
          />
          {props.proof !== null && (
            <button
              type="button"
              className="text-text-muted hover:text-text-body min-h-[32px] text-xs underline"
              onClick={() => props.onProof(null)}
            >
              Remove
            </button>
          )}
        </div>
        {props.proof !== null && (
          <p className="text-text-faint mt-1 text-xs">
            {props.proof.name} · {(props.proof.size / 1024).toFixed(0)} KB
          </p>
        )}
      </FormField>

      {/* Either identifies the payment on a statement; neither leaves us
          hunting an unnamed amount on a day. */}
      {!props.hasEvidence && (
        <div className="border-[var(--color-warning-ring)] bg-[var(--color-warning-tint)] text-text-body rounded-md border px-3 py-2 text-xs">
          Give a transaction ID or upload a receipt — either one lets us find your payment. Both is
          better.
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="md" onClick={props.onBack}>
          Back
        </Button>
        <Button variant="primary" size="md" disabled={!props.canSubmit} onClick={props.onSubmit}>
          {props.busy ? 'Submitting…' : 'Submit for verification'}
        </Button>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-body font-mono">{value}</dd>
    </div>
  );
}

function Submitted({ onClose }: { readonly onClose: () => void }): ReactElement {
  return (
    <div className="py-4 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-tint)] text-[var(--color-success)]">
        <CircleCheck size={26} />
      </span>
      <h3 className="text-text-bright text-base font-medium">We have your top-up</h3>
      <p className="text-text-muted mx-auto mt-1 max-w-md text-sm">
        We check every transfer against our bank statement by hand, which usually takes 24–48 hours.
        Your wallet is credited the moment it is matched, and we will email you either way.
      </p>
      <p className="text-text-faint mx-auto mt-2 max-w-md text-xs">
        Nothing has been added to your balance yet. You can follow it under Top-ups.
      </p>
      <div className="mt-4">
        <Button variant="primary" size="md" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
