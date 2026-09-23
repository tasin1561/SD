'use client';

import { useState, type ReactElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowLeft, Landmark, ReceiptText, Send, TriangleAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { topupStatusKind, topupStatusLabel } from '@skydrop/ui/status';
import { TopupRequestStatus } from '@skydrop/db';
import { Dialog } from '@skydrop/ui/app/dialog';
import { Stepper, type StepperStep } from '@skydrop/ui/app/stepper';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  usePresignTopupProof,
  useSubmitTopup,
  type PlatformBankAccountView,
  type TopupBankAccountsResponse,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { WalCallout } from './wallet-parts';

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
 *
 * Drawn as the u34 stepper: the connector fills as the steps complete
 * and the last step ends on the pending chip the claim will carry under
 * Top-ups ("Waiting for Skydrop to see it"), so the seller sees the
 * state their money is in rather than a bare "done".
 */
const STEPS: readonly StepperStep[] = [
  { id: 'account', label: 'Choose account', icon: <Landmark size={16} /> },
  { id: 'details', label: 'Payment details', icon: <ReceiptText size={16} /> },
  { id: 'submitted', label: 'Submitted', icon: <Send size={16} /> },
];

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onDone();
          reset();
        }
      }}
      size="lg"
      title="Top up your wallet"
      icon={<Landmark size={18} />}
    >
      <Stepper mode="wizard" label="Top-up steps" steps={STEPS} current={step - 1} navigable="none">
        <div className="wal-wizard">
          {error !== null && <ErrorState title="Not recorded" message={error} />}

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
              failed={error !== null}
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
        </div>
      </Stepper>
    </Dialog>
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
  if (loading) {
    return (
      <div className="wal-loading" role="status" aria-live="polite">
        <p className="wal-muted">Loading accounts…</p>
        <div className="wal-banks">
          <Skeleton height={132} rounded="md" />
          <Skeleton height={132} rounded="md" />
        </div>
      </div>
    );
  }
  if (accounts.length === 0) {
    return (
      <WalCallout tone="warn" icon={<TriangleAlert size={16} />}>
        <p>
          We have not published a bank account yet, so there is nowhere to send money. Please
          contact support before transferring anything — a payment we have not published an account
          for is one we cannot match to you.
        </p>
      </WalCallout>
    );
  }
  return (
    <>
      <p className="wal-muted">
        Send the money to one of these accounts first, then come back and tell us. Nothing reaches
        your balance until we match it against our statement.
      </p>
      <div className="wal-banks">
        {accounts.map((a) => (
          <button key={a.id} type="button" onClick={() => onPick(a)} className="wal-bank">
            <BankHead bank={a} />
            <dl className="wal-bank__details">
              <div className="wal-bank__line">
                <dt>Account name</dt>
                <dd>{a.accountName}</dd>
              </div>
              <div className="wal-bank__line">
                <dt>Account number</dt>
                <dd className="sk-ident">{a.accountNumber}</dd>
              </div>
              {a.routingNumber !== null && (
                <div className="wal-bank__line">
                  <dt>Routing</dt>
                  <dd className="sk-ident">{a.routingNumber}</dd>
                </div>
              )}
            </dl>
          </button>
        ))}
      </div>
    </>
  );
}

/** The bank's name, branch and currency, as the top of its card. */
function BankHead({
  bank,
  action,
}: {
  readonly bank: PlatformBankAccountView;
  readonly action?: ReactElement | undefined;
}): ReactElement {
  return (
    <div className="wal-bank__head">
      <span className="wal-bank__chip" aria-hidden>
        <Landmark size={15} />
      </span>
      <div className="wal-bank__names">
        <div className="wal-bank__name">{bank.bankName}</div>
        <div className="wal-bank__branch">
          {[bank.branchName, bank.district].filter(Boolean).join(' — ') || bank.label}
        </div>
      </div>
      {action ?? (
        <span className="wal-bank__cur">{bank.currency === 'BDT' ? '৳ BDT' : '₹ INR'}</span>
      )}
    </div>
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
  readonly failed: boolean;
  readonly onBack: () => void;
  readonly onSubmit: () => void;
}): ReactElement {
  const { bank } = props;
  const symbol = bank.currency === 'BDT' ? '৳' : '₹';
  return (
    <>
      <div className="wal-bank" data-chosen="1">
        <BankHead
          bank={bank}
          action={
            <Button variant="ghost" size="sm" onClick={props.onBack}>
              Change
            </Button>
          }
        />
        <dl className="wal-bank__details wal-bank__details--grid">
          <Detail label="Account name" value={bank.accountName} />
          <Detail label="Account number" value={bank.accountNumber} ident />
          {bank.routingNumber !== null && (
            <Detail label="Routing number" value={bank.routingNumber} ident />
          )}
          {bank.district !== null && <Detail label="District" value={bank.district} />}
        </dl>
        {bank.instructions !== null && bank.instructions !== '' && (
          <p className="wal-bank__note">{bank.instructions}</p>
        )}
      </div>

      {/* In the ACCOUNT's currency, because that is the number on the
          seller's transfer receipt. Asking them to convert first is
          asking for an arithmetic mistake we would then have to find on
          a statement. */}
      <TextField
        id="tw-amount"
        label={`Amount you paid (${symbol} ${bank.currency})`}
        required
        inputMode="decimal"
        value={props.amount}
        onChange={(e) => props.onAmount(e.target.value)}
        placeholder="0.00"
        inputClassName="sk-figure"
      />

      {props.inrAmount !== null && (
        <div className="wal-credited">
          <div className="wal-credited__row">
            <span>Credited to your wallet</span>
            <strong>
              <Money amount={props.inrAmount.toFixed(2)} currency="INR" convert={false} />
            </strong>
          </div>
          {props.bdtAmount !== null && (
            <div className="wal-credited__row wal-credited__row--sub">
              <span>Same amount in taka</span>
              <span>
                <Money amount={props.bdtAmount.toFixed(2)} currency="BDT" convert={false} />
              </span>
            </div>
          )}
          <p>Your wallet is kept in rupees, so the rupee figure is what gets credited.</p>
        </div>
      )}

      <TextField
        id="tw-ref"
        label="Transaction ID / reference"
        hint="From your bank's confirmation."
        value={props.transactionRef}
        onChange={(e) => props.onTransactionRef(e.target.value)}
        placeholder="e.g. TXN123456789"
      />

      <div className="wal-proof">
        <span className="wal-proof__label">Payment proof</span>
        {/* The drop zone uploads nothing: it hands the file over and the
            submit uploads it, exactly as the file input did. It is
            REMOUNTED on clear so its own list and the native value reset
            too — without that, re-picking the same file fires no change
            event and the seller is stuck with a field that ignores them.
            The chosen file is listed from the wizard's own state, so it
            is still named after going Back and returning. */}
        <DropZone
          id="tw-proof"
          key={props.proof === null ? 'empty' : 'chosen'}
          accept="image/jpeg,image/png,image/webp,application/pdf"
          label="Drop the receipt here"
          buttonText="Choose file"
          hint="A screenshot or PDF of the transfer (JPG, PNG, WEBP, PDF)."
          showFiles={false}
          onFiles={(files) => props.onProof(files[0] ?? null)}
        />
        {props.proof !== null && (
          <div className="wal-proof__chosen">
            <span>
              {props.proof.name} · {(props.proof.size / 1024).toFixed(0)} KB
            </span>
            <Button variant="ghost" size="sm" onClick={() => props.onProof(null)}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {/* Either identifies the payment on a statement; neither leaves us
          hunting an unnamed amount on a day. */}
      {!props.hasEvidence && (
        <WalCallout tone="warn" icon={<TriangleAlert size={16} />}>
          <p>
            Give a transaction ID or upload a receipt — either one lets us find your payment. Both
            is better.
          </p>
        </WalCallout>
      )}

      <div className="wal-wizard__foot">
        <Button variant="ghost" size="md" icon={<ArrowLeft size={15} />} onClick={props.onBack}>
          Back
        </Button>
        {/* Controlled: the wizard owns the real request (upload, then
            submit), so the button reads its busy flag and its refusal
            rather than running a promise of its own. */}
        <AsyncButton
          variant="primary"
          size="md"
          icon={<Send size={15} />}
          state={props.busy ? 'busy' : props.failed ? 'error' : 'idle'}
          disabled={!props.canSubmit}
          labels={{ idle: 'Submit for verification', busy: 'Submitting…' }}
          onClick={props.onSubmit}
        />
      </div>
    </>
  );
}

function Detail({
  label,
  value,
  ident = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly ident?: boolean;
}): ReactElement {
  return (
    <div className="wal-bank__line">
      <dt>{label}</dt>
      <dd className={ident ? 'sk-ident' : undefined}>{value}</dd>
    </div>
  );
}

function Submitted({ onClose }: { readonly onClose: () => void }): ReactElement {
  return (
    <div className="wal-done">
      <span className="wal-done__badge" aria-hidden>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" focusable="false">
          <path
            className="wal-done__check"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h3 className="wal-done__title">We have your top-up</h3>
      <p className="wal-done__body">
        We check every transfer against our bank statement by hand, which usually takes 24–48 hours.
        Your wallet is credited the moment it is matched, and we will email you either way.
      </p>
      {/* The state the claim is in now, in the same chip and the same
          words it carries in the Top-ups list. */}
      <StatusChip
        kind={topupStatusKind(TopupRequestStatus.PENDING)}
        label={topupStatusLabel(TopupRequestStatus.PENDING, 'payer')}
        pulse
      />
      <p className="wal-done__aside">
        Nothing has been added to your balance yet. You can follow it under Top-ups.
      </p>
      <Button variant="primary" size="md" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
