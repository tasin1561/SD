'use client';

import Link from 'next/link';

import { useState, type ReactElement } from 'react';
import { HandCoins, OctagonAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { withdrawalStatusKind, withdrawalStatusLabel } from '@skydrop/ui/status';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useRequestWithdrawal,
  useSellerWithdrawals,
  useWithdrawalEligibility,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { WalCallout } from './wallet-parts';

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

  /*
    No card of its own: the table is its own card, and it sits directly
    under the wallet page's tab bar.
  */
  return (
    <>
      {list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load withdrawal requests.'}
          retry={() => void list.refetch()}
        />
      ) : list.isLoading ? (
        <SkeletonRows rows={3} cols={4} label="Loading withdrawal requests…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No withdrawal requests yet."
          description="Request one when you want your balance transferred; we will pay it to the bank account on your profile."
          action={
            <Button
              variant="primary"
              size="md"
              icon={<HandCoins size={15} />}
              onClick={() => onRequestingChange(true)}
            >
              Request a withdrawal
            </Button>
          }
        />
      ) : (
        <Table caption="Withdrawal requests">
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
                <Td className="wal-when sk-figure">
                  {new Date(w.createdAt).toLocaleDateString()}
                  <div className="wal-faint">
                    {new Date(w.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {w.requestedBy === 'SYSTEM' && <span className="wal-tag">auto</span>}
                  </div>
                </Td>
                <Td align="right">
                  <Money amount={w.amountRequested} currency={w.currency} />
                </Td>
                <Td>
                  <StatusChip
                    kind={withdrawalStatusKind(w.status)}
                    label={withdrawalStatusLabel(w.status, 'seller')}
                    size="sm"
                  />
                </Td>
                <Td className="wal-faint">
                  {w.rejectionReason ??
                    (w.resolvedAt === null
                      ? 'Awaiting review'
                      : `Paid ${new Date(w.resolvedAt).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}`)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <RequestWithdrawalModal open={requesting} onOpenChange={onRequestingChange} />
    </>
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
  /**
   * The owner's rule: money leaving is confirmed on a second screen that
   * restates the amount, where it goes and what happens next — and only
   * then does the SAME request fire. The form's own button opens that
   * screen; it never sends anything itself.
   */
  const [confirming, setConfirming] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await request.mutateAsync({
        currency,
        amount: amount.trim(),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      });
    } catch (err) {
      setError(serverVerdict(err));
      // Rethrown so the confirm screen stays open with the verdict on it.
      throw err;
    }
    toast.success('Withdrawal requested.');
    setAmount('');
    setNote('');
    setConfirming(false);
    onOpenChange(false);
  }

  const cannotRequest =
    amount.trim() === '' ||
    request.isPending ||
    eligibility.data?.hasBankAccount === false ||
    overAvailable;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setError(null);
        }}
        size="sm"
        icon={<HandCoins size={18} />}
        title="Request a withdrawal"
        description="We will review this and transfer to the bank account on your profile. Your balance changes when the transfer is recorded, not when you request it."
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={cannotRequest}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              Request withdrawal
            </Button>
          </DialogFooter>
        }
      >
        <div className="wal-form">
          {/* Without bank details there is nowhere to send the money, and
              the request would sit in the queue while the seller waited.
              The server refuses it either way (NO_BANK_ACCOUNT_ON_FILE);
              this stops them filling in a form that cannot succeed, and
              says where to go instead. */}
          {eligibility.data?.hasBankAccount === false && (
            <WalCallout tone="critical" icon={<OctagonAlert size={16} />}>
              <p>
                Add your bank details before requesting a withdrawal — without them there is nowhere
                for us to send the money. <Link href="/profile">Go to your profile</Link>.
              </p>
            </WalCallout>
          )}

          {/* The number that matters: what can actually be taken, not the
              balance. The two differ by the minimum this account must
              leave behind, and a seller who does not know that reads a
              refusal as a bug. */}
          {eligibility.data !== undefined && (
            <div className="wal-avail">
              <div className="wal-avail__head">
                <span>Available to withdraw:</span>
                <span className="wal-avail__figure sk-figure">
                  <Money amount={eligibility.data.withdrawableInr} currency="INR" convert={false} />
                </span>
              </div>
              {/* The three figures that make up the one above, so a
                  refusal is never a surprise. */}
              <dl className="wal-avail__rows">
                <div className="wal-avail__row">
                  <dt>Balance</dt>
                  <dd className="sk-figure">
                    <Money amount={eligibility.data.balanceInr} currency="INR" convert={false} />
                  </dd>
                </div>
                {Number(eligibility.data.minimumBalanceInr) > 0 && (
                  <div className="wal-avail__row">
                    <dt>Must stay in the account</dt>
                    <dd className="sk-figure">
                      <Money
                        amount={eligibility.data.minimumBalanceInr}
                        currency="INR"
                        convert={false}
                      />
                    </dd>
                  </div>
                )}
                {/* Money already asked for is HELD, not spent. The balance
                    still shows it because no transfer has been made yet,
                    but it cannot be requested a second time — otherwise
                    the same rupees go out twice. */}
                {Number(eligibility.data.pendingWithdrawalInr) > 0 && (
                  <div className="wal-avail__row">
                    <dt>On hold for a withdrawal you already requested</dt>
                    <dd className="sk-figure">
                      <Money
                        amount={eligibility.data.pendingWithdrawalInr}
                        currency="INR"
                        convert={false}
                      />
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* No currency choice: the wallet is kept in rupees, and taka is
              a conversion of that balance rather than a second pot. The
              option was always going to be refused — there is nothing to
              withdraw from a currency nothing is ever credited in. */}
          {/*
            The server refuses more than is withdrawable
            (INSUFFICIENT_WITHDRAWABLE_BALANCE) and is the authority — the
            disabled button only saves a round trip to learn something
            already printed above the field. FE-2: it is a mirror of the
            number we just showed, not of the server's policy, and a
            refusal still comes from the server verbatim.
          */}
          <TextField
            id="wd-amount"
            label="Amount (₹)"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="25000.00"
            inputClassName="sk-figure"
          />

          <TextArea
            id="wd-note"
            label="Note"
            hint="Optional."
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error !== null && !confirming && <ErrorState title="Not requested" message={error} />}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title="Request this withdrawal?"
        entity="To the bank account on your profile"
        amount={
          Number.isFinite(typed) ? (
            <Money amount={amount.trim()} currency="INR" convert={false} size="md" />
          ) : (
            amount.trim()
          )
        }
        consequence="We review the request and transfer it to that account. Your balance changes when the transfer is recorded, not now."
        confirmLabel="Request withdrawal"
        cancelLabel="Back"
        onConfirm={submit}
        error={error}
      >
        {note.trim() !== '' && <p className="wal-muted">Your note: {note.trim()}</p>}
      </ConfirmDialog>
    </>
  );
}
