'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  Select,
  SkeletonRows,
  TBody,
  Table,
  Td,
  Textarea,
  THead,
  Th,
  Tr,
  useToast,
  WithdrawalStatusBadge,
} from '@skydrop/ui/components';
import { useRequestWithdrawal, useSellerWithdrawals } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

/**
 * Payout requests, on the wallet page because that is where the balance
 * being drawn against is.
 *
 * A request does not move money. Skydrop records the bank transfer as a
 * remittance and links it back here — that separation is what makes it
 * impossible for a request alone to debit anything, and the copy says so
 * rather than leaving a seller to wonder why the balance has not moved.
 */
export function WithdrawalsCard(): ReactElement {
  const canWrite = can(useSellerIdentity(), 'wallet.withdraw');
  const [requesting, setRequesting] = useState(false);
  const list = useSellerWithdrawals();
  const rows = list.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Payout requests"
        action={
          canWrite ? (
            <Button variant="primary" size="sm" onClick={() => setRequesting(true)}>
              Request a payout
            </Button>
          ) : null
        }
      />
      <CardBody>
        {list.isError ? (
          <ErrorNote
            message={list.error?.message ?? 'Failed to load payout requests.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : rows.length === 0 ? (
          <p className="text-text-muted py-2 text-sm">
            No payout requests yet. Request one when you want your balance transferred; we will pay
            it to the bank account on your profile.
          </p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Requested</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Outcome</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((w) => (
                <Tr key={w.id}>
                  <Td className="text-text-muted whitespace-nowrap">
                    {new Date(w.createdAt).toLocaleDateString()}
                    {w.requestedBy === 'SYSTEM' && (
                      <span className="text-text-faint ml-1.5 text-xs">auto</span>
                    )}
                  </Td>
                  <Td align="right">
                    <Money amount={w.amountRequested} currency={w.currency} />
                  </Td>
                  <Td>
                    <WithdrawalStatusBadge status={w.status} />
                  </Td>
                  <Td className="text-text-muted text-xs">
                    {w.rejectionReason ??
                      (w.resolvedAt === null
                        ? 'Awaiting review'
                        : `Paid ${new Date(w.resolvedAt).toLocaleDateString()}`)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>

      <RequestWithdrawalModal open={requesting} onOpenChange={setRequesting} />
    </Card>
  );
}

function RequestWithdrawalModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const request = useRequestWithdrawal();

  const [currency, setCurrency] = useState('INR');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await request.mutateAsync({
        currency,
        amount: amount.trim(),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
      toast.success('Payout requested.');
      setAmount('');
      setNote('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      size="sm"
      title="Request a payout"
      description="We will review this and transfer to the bank account on your profile. Your balance changes when the transfer is recorded, not when you request it."
    >
      <div className="space-y-3">
        <FormField label="Currency" htmlFor="wd-currency" required>
          <Select id="wd-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="INR">INR</option>
            <option value="BDT">BDT</option>
          </Select>
        </FormField>

        <FormField
          label="Amount"
          htmlFor="wd-amount"
          hint="Cannot exceed your available balance in that currency."
          required
        >
          <Input
            id="wd-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="25000.00"
          />
        </FormField>

        <FormField label="Note" htmlFor="wd-note" hint="Optional.">
          <Textarea id="wd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={amount.trim() === '' || request.isPending}
          onClick={() => void submit()}
        >
          {request.isPending ? 'Requesting…' : 'Request payout'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
