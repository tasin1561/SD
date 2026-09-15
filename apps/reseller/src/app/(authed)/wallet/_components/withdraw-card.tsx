'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  FormField,
  Input,
  Money,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useRequestStoreWithdrawal, type StoreWalletSummary } from '@/lib/store-wallet-hooks';

/**
 * Ask Skydrop to pay out (RS-6). The form is checked by a person before it
 * is sent: the confirm names the amount, the payee and the account, since
 * a mistyped account number is money sent to a stranger.
 *
 * IDEM-1: the key is minted when the card mounts and reused on every retry
 * of the same request, so a double click or a flaky network asks once; a
 * fresh key is minted only after a request lands.
 */
export function WithdrawCard({ summary }: { readonly summary: StoreWalletSummary }): ReactElement {
  const toast = useToast();
  const request = useRequestStoreWithdrawal();
  const [amount, setAmount] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bank, setBank] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setConfirming(true);
  }

  async function send(): Promise<void> {
    setError(null);
    try {
      await request.mutateAsync({
        amountInr: amount.trim(),
        payeeName: payeeName.trim(),
        payeeAccountNumber: account.trim(),
        payeeIfsc: ifsc.trim(),
        payeeBankName: bank.trim(),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        idempotencyKey,
      });
      toast.success('Asked. Skydrop pays it and the wallet shows it when they do.');
      setAmount('');
      setNote('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      setError(serverVerdict(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Withdraw"
        subtitle={
          summary.withdrawableInr === null ? (
            'Ask Skydrop to pay out your balance.'
          ) : (
            <>
              Ask Skydrop to pay out up to{' '}
              <Money amount={summary.withdrawableInr} convert={false} />. Nothing leaves the wallet
              until they pay it.
            </>
          )
        }
      />
      <CardBody>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Amount (₹)" htmlFor="wd-amount" required>
            <Input
              id="wd-amount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Name on the account" htmlFor="wd-name" required>
            <Input
              id="wd-name"
              required
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
            />
          </FormField>
          <FormField label="Account number" htmlFor="wd-account" required>
            <Input
              id="wd-account"
              required
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
          </FormField>
          <FormField label="IFSC" htmlFor="wd-ifsc" required>
            <Input id="wd-ifsc" required value={ifsc} onChange={(e) => setIfsc(e.target.value)} />
          </FormField>
          <FormField label="Bank" htmlFor="wd-bank" required>
            <Input id="wd-bank" required value={bank} onChange={(e) => setBank(e.target.value)} />
          </FormField>
          <FormField label="Note (optional)" htmlFor="wd-note">
            <Input id="wd-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm md:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="md:col-span-2">
            <Button type="submit" variant="primary" size="md" disabled={request.isPending}>
              {request.isPending ? 'Asking…' : 'Ask to withdraw'}
            </Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          <>
            Ask Skydrop to pay{' '}
            <Money amount={amount.trim() === '' ? '0' : amount.trim()} convert={false} /> to{' '}
            {payeeName.trim()} · {account.trim()}?
          </>
        }
        description={`${bank.trim()} · IFSC ${ifsc.trim()}. Check the account number — money sent to the wrong one is very hard to get back.`}
        confirmLabel="Ask to withdraw"
        disabled={request.isPending}
        onConfirm={() => void send()}
      />
    </Card>
  );
}
