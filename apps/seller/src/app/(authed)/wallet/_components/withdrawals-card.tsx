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
 * Withdrawal requests, on the wallet page because that is where the balance
 * being drawn against is.
 *
 * A request does not move money. Skydrop records the bank transfer as a
 * remittance and links it back here — that separation is what makes it
 * impossible for a request alone to debit anything, and the copy says so
 * rather than leaving a seller to wonder why the balance has not moved.
 */
/**
 * Every withdrawal the seller has asked for, whatever became of it.
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
            message={list.error?.message ?? 'Failed to load withdrawal requests.'}
            retry={() => void list.refetch()}
          />
        ) : list.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : rows.length === 0 ? (
          <p className="text-text-muted py-2 text-sm">
            No withdrawal requests yet. Request one when you want your balance transferred; we will
            pay it to the bank account on your profile.
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
                    <WithdrawalStatusBadge status={w.status} audience="seller" />
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
  // withdrawal is requested against the rupee balance.
  const currency = 'INR';
  const [amount, setAmount] = useState('');
  // A typed amount above what the page already says is available. Only
  // true for a parseable number: an unparseable one is the server's to
  // refuse, and blocking on it would fight the user mid-keystroke.
  const typed = Number(amount);
  const overAvailable =
    amount.trim() !== '' &&
    Number.isFinite(typed) &&
    eligibility.data !== undefined &&
    typed > Number(eligibility.data.withdrawableInr);
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
      toast.success('Withdrawal requested.');
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
      title="Request a withdrawal"
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
            Add your bank details before requesting a withdrawal — without them there is nowhere for
            us to send the money.{' '}
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
            {/* The three figures that make up the one above, so a
                refusal is never a surprise. */}
            <div className="text-text-faint mt-1 space-y-0.5 text-xs">
              <div>
                Balance{' '}
                <Money amount={eligibility.data.balanceInr} currency="INR" convert={false} />
              </div>
              {Number(eligibility.data.minimumBalanceInr) > 0 && (
                <div>
                  Must stay in the account{' '}
                  <Money
                    amount={eligibility.data.minimumBalanceInr}
                    currency="INR"
                    convert={false}
                  />
                </div>
              )}
              {/* Money already asked for is HELD, not spent. The balance
                  still shows it because no transfer has been made yet,
                  but it cannot be requested a second time — otherwise the
                  same rupees go out twice. */}
              {Number(eligibility.data.pendingWithdrawalInr) > 0 && (
                <div>
                  On hold for a withdrawal you already requested{' '}
                  <Money
                    amount={eligibility.data.pendingWithdrawalInr}
                    currency="INR"
                    convert={false}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* No currency choice: the wallet is kept in rupees, and taka is
            a conversion of that balance rather than a second pot. The
            option was always going to be refused — there is nothing to
            withdraw from a currency nothing is ever credited in. */}
        {/* No hint: the ₹ in the label and the rupee figure in the
            availability box above already say which currency this is,
            and a sentence explaining it a third time is noise on a form
            with two fields. */}
        {/*
          The server refuses more than is withdrawable
          (INSUFFICIENT_WITHDRAWABLE_BALANCE) and is the authority — this
          only saves a round trip to learn something already printed two
          inches above the field. FE-2: it is a mirror of the number we
          just showed, not of the server's policy, and the button stays
          enabled for everything else so a refusal still comes from the
          server verbatim.
        */}
        <FormField label="Amount (₹)" htmlFor="wd-amount" required>
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
            amount.trim() === '' ||
            request.isPending ||
            eligibility.data?.hasBankAccount === false ||
            overAvailable
          }
          onClick={() => void submit()}
        >
          {request.isPending ? 'Requesting…' : 'Request withdrawal'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
