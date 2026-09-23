'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Banknote } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { useToast } from '@skydrop/ui/app/toast';
import { useRecordInvestmentReturn } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { localNow } from '@/lib/datetime-local';
import '../../treasury/_components/money.css';
import './expenses.css';

/**
 * Money coming back.
 *
 * Partial is the normal case — interest arrives before principal, a loan
 * repays in instalments — so returns accumulate and the investment stays
 * open until somebody says it is finished. Closing is a separate,
 * deliberate tick rather than something inferred from the amount
 * matching, which would close an investment the moment its interest
 * happened to equal its principal.
 */
export function InvestmentReturnModal({
  investmentId,
  onClose,
}: {
  readonly investmentId: string | null;
  readonly onClose: () => void;
}): ReactElement {
  const accounts = usePlatformBankAccounts(usePermission('money.view'));
  const record = useRecordInvestmentReturn();

  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(localNow);
  const [close, setClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The checked form waits here for a confirm that restates it.
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  // One key per opening (per investment), reused on every retry: a
  // double-click records the return ONCE.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (investmentId !== null) setIdempotencyKey(crypto.randomUUID());
  }, [investmentId]);

  const account = (accounts.data ?? []).find((a) => a.id === toAccountId);

  /** The form's own checks, unchanged; passing them opens the confirm. */
  function review(): void {
    setError(null);
    if (investmentId === null || toAccountId === '') {
      setError('Which account did it land in?');
      return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter what came back');
      return;
    }
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    if (investmentId === null) return;
    const n = Number(amount);
    try {
      await record.mutateAsync({
        investmentId,
        toAccountId,
        amount: n.toFixed(2),
        receivedAt: new Date(receivedAt).toISOString(),
        ...(close ? { close: true } : {}),
        idempotencyKey,
      });
      setAmount('');
      setClose(false);
      onClose();
      toast.success(close ? 'Return recorded; investment closed' : 'Return recorded');
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const open = investmentId !== null;

  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          if (!next) {
            setError(null);
            onClose();
          }
        }}
        icon={<Banknote size={18} />}
        title="Record a return"
        description="Partial returns accumulate. Tick to close only when it is genuinely finished."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={record.isPending}>
              {record.isPending ? 'Recording…' : 'Record return'}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <Select
            label="Into account"
            requiredMark
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
          >
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
          <div className="mo-fields" data-cols="2">
            <TextField
              label={`Amount${account ? ` (${account.currency})` : ''}`}
              requiredMark
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <DateField
              label="Received"
              requiredMark
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>
          <Checkbox
            checked={close}
            onChange={(e) => setClose(e.target.checked)}
            label="This closes the investment"
          />
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
        title={close ? 'Record this return and close the investment?' : 'Record this return?'}
        entity={account === undefined ? 'Into account' : `${account.label} · ${account.bankName}`}
        amount={
          <Money
            amount={Number(amount).toFixed(2)}
            currency={(account?.currency ?? 'INR') as 'INR' | 'BDT'}
            convert={false}
            direction="credit"
          />
        }
        consequence={
          close
            ? 'The money lands in this account and the investment is closed for good; no further return can be recorded against it.'
            : 'The money lands in this account and the investment stays open for further returns.'
        }
        confirmLabel="Record return"
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      >
        <div className="ex-confirm-lines">
          <span>
            Received: {receivedAt === '' ? '—' : new Date(receivedAt).toLocaleString('en-IN')}
          </span>
        </div>
      </ConfirmDialog>
    </>
  );
}
