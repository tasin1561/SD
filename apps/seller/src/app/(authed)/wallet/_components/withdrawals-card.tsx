'use client';

import Link from 'next/link';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
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
import {
  useRequestWithdrawal,
  useSellerWithdrawals,
  useWithdrawalEligibility,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Payout requests, on the wallet page because that is where the balance
 * being drawn against is.
 *
 * A request does not move money. Skydrop records the bank transfer as a
 * remittance and links it back here — that separation is what makes it
 * impossible for a request alone to debit anything, and the copy says so
 * rather than leaving a seller to wonder why the balance has not moved.
 */
/**
 * Every payout the seller has asked for, whatever became of it.
 *
 * The action lives up in the balance row — a seller reaches for it while
 * looking at what they are owed, not while reading the history of what
 * they already asked for.
 *
 * A request never writes a wallet entry. The balance moves when the
 * remittance is actually paid, so pending and rejected requests only
 * exist here, and the ledger only ever shows money that really left.
 */
export function WithdrawalsCard({
  requesting,
  onRequestingChange,
}: {
  readonly requesting: boolean;
  readonly onRequestingChange: (open: boolean) => void;
}): ReactElement {
  const list = useSellerWithdrawals();
  const rows = list.data ?? [];

  return (
    <Card>
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

      <RequestWithdrawalModal open={requesting} onOpenChange={onRequestingChange} />
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
  const eligibility = useWithdrawalEligibility();

  // Fixed: every wallet entry is INR (see the wallet's own note), so a
  // payout is requested against the rupee balance.
  const currency = 'INR';
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
        {/* Without bank details there is nowhere to send the money, and
            the request would sit in the queue while the seller waited.
            The server refuses it either way (NO_BANK_ACCOUNT_ON_FILE);
            this stops them filling in a form that cannot succeed, and
            says where to go instead. */}
        {eligibility.data?.hasBankAccount === false && (
          <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical rounded-md border px-3 py-2 text-sm">
            Add your bank details before requesting a payout — without them there is nowhere for us
            to send the money.{' '}
            <Link href="/profile" className="underline">
              Go to your profile
            </Link>
            .
          </div>
        )}

        {/* The number that matters: what can actually be taken, not the
            balance. The two differ by the minimum this account must
            leave behind, and a seller who does not know that reads a
            refusal as a bug. */}
        {eligibility.data !== undefined && (
          <div className="border-border text-text-muted rounded-md border px-3 py-2 text-sm">
            <div>
              Available to withdraw:{' '}
              <span className="text-text-bright">
                <Money amount={eligibility.data.withdrawableInr} currency="INR" convert={false} />
              </span>
            </div>
            {Number(eligibility.data.minimumBalanceInr) > 0 && (
              <div className="text-text-faint mt-0.5 text-xs">
                Your balance is{' '}
                <Money amount={eligibility.data.balanceInr} currency="INR" convert={false} />, of
                which{' '}
                <Money amount={eligibility.data.minimumBalanceInr} currency="INR" convert={false} />{' '}
                must stay in the account.
              </div>
            )}
          </div>
        )}

        {/* No currency choice: the wallet is kept in rupees, and taka is
            a conversion of that balance rather than a second pot. The
            option was always going to be refused — there is nothing to
            withdraw from a currency nothing is ever credited in. */}
        <FormField
          label="Amount (₹)"
          htmlFor="wd-amount"
          hint="In rupees, whatever currency the page shows figures in — this is the number we pay out against your balance, so it is not converted for you."
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
          disabled={
            amount.trim() === '' || request.isPending || eligibility.data?.hasBankAccount === false
          }
          onClick={() => void submit()}
        >
          {request.isPending ? 'Requesting…' : 'Request payout'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
