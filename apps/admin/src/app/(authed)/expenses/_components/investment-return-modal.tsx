'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, Select } from '@skydrop/ui/components';
import { useRecordInvestmentReturn } from '@/lib/ops-hooks';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

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

  const account = (accounts.data ?? []).find((a) => a.id === toAccountId);

  async function save(): Promise<void> {
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
    try {
      await record.mutateAsync({
        investmentId,
        toAccountId,
        amount: n.toFixed(2),
        receivedAt: new Date(receivedAt).toISOString(),
        ...(close ? { close: true } : {}),
      });
      setAmount('');
      setClose(false);
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={investmentId !== null}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
      title="Record a return"
      description="Partial returns accumulate. Tick to close only when it is genuinely finished."
    >
      <div className="space-y-3">
        <FormField label="Into account" required>
          <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">Select an account…</option>
            {(accounts.data ?? [])
              .filter((a) => a.isActive)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.bankName} · {a.currency}
                </option>
              ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label={`Amount${account ? ` (${account.currency})` : ''}`} required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
          <FormField label="Received" required>
            <Input
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
          This closes the investment
        </label>
      </div>
      {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={record.isPending}>
          {record.isPending ? 'Recording…' : 'Record return'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
