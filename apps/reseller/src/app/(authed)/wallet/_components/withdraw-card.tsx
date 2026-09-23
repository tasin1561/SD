'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { HandCoins } from 'lucide-react';
// The legacy toaster: this card's test mounts only the legacy `<Toaster>`
// (and the app layout mounts both), so the call stays on the legacy hook.
import { Money, useToast } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { useRequestStoreWithdrawal, type StoreWalletSummary } from '@/lib/store-wallet-hooks';
import { RmAlert } from './rm-parts';

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

  const amountShown = amount.trim() === '' ? '0' : amount.trim();

  return (
    <section className="rm-card" aria-labelledby="wd-title">
      <div className="rm-card__head">
        <span className="rm-card__chip" aria-hidden>
          <HandCoins size={18} />
        </span>
        <div className="rm-card__titles">
          <h2 id="wd-title" className="rm-card__title">
            Withdraw
          </h2>
          <div className="rm-card__sub">
            {summary.withdrawableInr === null ? (
              'Ask Skydrop to pay out your balance.'
            ) : (
              <>
                Ask Skydrop to pay out up to{' '}
                <Money amount={summary.withdrawableInr} convert={false} />. Nothing leaves the
                wallet until they pay it.
              </>
            )}
          </div>
        </div>
      </div>
      <form onSubmit={onSubmit} className="rm-form">
        <TextField
          id="wd-amount"
          label="Amount (₹)"
          inputMode="decimal"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          id="wd-name"
          label="Name on the account"
          required
          value={payeeName}
          onChange={(e) => setPayeeName(e.target.value)}
        />
        <TextField
          id="wd-account"
          label="Account number"
          required
          inputMode="numeric"
          inputClassName="sk-ident"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
        <TextField
          id="wd-ifsc"
          label="IFSC"
          required
          inputClassName="sk-ident"
          value={ifsc}
          onChange={(e) => setIfsc(e.target.value)}
        />
        <TextField
          id="wd-bank"
          label="Bank"
          required
          value={bank}
          onChange={(e) => setBank(e.target.value)}
        />
        <TextField
          id="wd-note"
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null ? <RmAlert>{error}</RmAlert> : null}
        <div className="rm-form__full rm-form__actions">
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<HandCoins size={15} />}
            state={request.isPending ? 'busy' : 'idle'}
            labels={{ idle: 'Ask to withdraw', busy: 'Asking…' }}
          />
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          <>
            Ask Skydrop to pay <Money amount={amountShown} convert={false} /> to {payeeName.trim()}{' '}
            · {account.trim()}?
          </>
        }
        entity={`${payeeName.trim()} · ${account.trim()}`}
        entityIsIdentifier={false}
        amount={<Money amount={amountShown} convert={false} />}
        consequence={`${bank.trim()} · IFSC ${ifsc.trim()}. Check the account number — money sent to the wrong one is very hard to get back.`}
        confirmLabel="Ask to withdraw"
        onConfirm={send}
      />
    </section>
  );
}
