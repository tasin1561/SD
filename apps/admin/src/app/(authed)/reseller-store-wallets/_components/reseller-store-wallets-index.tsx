'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { ArrowRight, Banknote, Check, ReceiptText, X } from 'lucide-react';
import { Money, formatInr, openExternalWhenReady, useToast } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { topupStatusLabel, withdrawalStatusLabel } from '@skydrop/ui/status';
import { TopupRequestStatus, WithdrawalRequestStatus } from '@skydrop/db';
import { localNow } from '@/lib/datetime-local';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import {
  useAcceptStoreTopup,
  useAdminStoreTopups,
  useAdminStoreWallet,
  useAdminStoreWithdrawals,
  useApproveStoreWithdrawal,
  usePayStoreWithdrawal,
  useRejectStoreTopup,
  useRejectStoreWithdrawal,
  useStoreTopupProofUrl,
  type AdminStoreTopup,
  type AdminStoreWithdrawal,
} from '@/lib/reseller-store-wallet-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  MkAlert,
  MkCard,
  MkSection,
  TopupChip,
  WithdrawalChip,
} from '../../seller-wallets/_components/money-parts';

function when(iso: string | null): string {
  return iso === null
    ? '—'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const TOPUP_STATUSES: readonly TopupRequestStatus[] = [
  TopupRequestStatus.PENDING,
  TopupRequestStatus.ACCEPTED,
  TopupRequestStatus.REJECTED,
];
const WITHDRAWAL_STATUSES: readonly WithdrawalRequestStatus[] = [
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
  WithdrawalRequestStatus.PAID,
  WithdrawalRequestStatus.REJECTED,
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RS-6 — the two queues a SKYDROP-managed reseller store feeds.
 *
 * A top-up claim writes nothing until it is accepted here (WAL-2), and the
 * credit it makes is posted as the SELLER's cash (decision 7: our bank book
 * knows only the seller). A withdrawal is a request; approving re-checks
 * what the store may withdraw, and recording the payout is the only thing
 * that pays it — the cash leaves as the seller's.
 */
export function ResellerStoreWalletsIndex(): ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('storeId');
  // `?storeId=` scopes both queues to one store (linked from the store's
  // wallet panel). Anything that is not a uuid is ignored rather than
  // sent — the API would refuse it, and an empty queue would read as
  // "nothing waiting" when the truth is "that link was wrong".
  const storeId = raw !== null && UUID_RE.test(raw) ? raw : null;
  const scoped = useAdminStoreWallet(storeId ?? '', storeId !== null);
  return (
    <div className="mk-page">
      <PageHeader
        title="Reseller store wallets"
        subtitle="Top-up claims and withdrawal requests from stores whose wallet Skydrop manages. The cash is the seller’s in our books."
        action={
          <Link href="/reseller-stores" className="mk-link">
            Reseller stores <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />
      {storeId !== null ? (
        <p className="mk-muted" role="status">
          Showing one store only:{' '}
          <Link href={`/reseller-stores/${storeId}`} className="mk-inline-link">
            {scoped.data?.storeName ?? 'this store'}
          </Link>{' '}
          ·{' '}
          <button type="button" className="mk-inline-link" onClick={() => router.replace(pathname)}>
            show every store
          </button>
        </p>
      ) : null}
      <TopupQueue storeId={storeId} />
      <WithdrawalQueue storeId={storeId} />
    </div>
  );
}

function TopupQueue({ storeId }: { readonly storeId: string | null }): ReactElement {
  const toast = useToast();
  const mayReview = usePermission('money.topups.review');
  const [status, setStatus] = useState<string>('PENDING');
  const list = useAdminStoreTopups(status, storeId);
  const accept = useAcceptStoreTopup();
  const reject = useRejectStoreTopup();
  const proof = useStoreTopupProofUrl();
  const [reviewing, setReviewing] = useState<AdminStoreTopup | null>(null);
  const [intent, setIntent] = useState<'ACCEPT' | 'REJECT' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setReviewing(null);
    setIntent(null);
    setNote('');
    setError(null);
  }

  async function onConfirm(): Promise<void> {
    if (reviewing === null || intent === null) return;
    setError(null);
    try {
      if (intent === 'ACCEPT') {
        await accept.mutateAsync({
          topupId: reviewing.id,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        });
        toast.success(`Credited ${formatInr(reviewing.amountInr)} to ${reviewing.storeName}.`);
      } else {
        await reject.mutateAsync({ topupId: reviewing.id, reason: note.trim() });
        toast.success('Rejected — the store reads your reason.');
      }
      close();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  async function onProof(topupId: string): Promise<void> {
    try {
      await openExternalWhenReady(async () => (await proof.mutateAsync({ topupId })).url);
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  return (
    <MkSection>
      <SectionHeading
        title="Top-up claims"
        note="A store saying it sent money to our bank. Accepting credits its wallet — check the statement first."
        action={
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {TOPUP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {topupStatusLabel(s)}
              </option>
            ))}
          </Select>
        }
      />
      {list.isPending ? (
        <SkeletonRows rows={3} cols={7} label="Loading top-up claims" />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          tone={status === 'PENDING' ? 'positive' : 'neutral'}
          title={
            status === 'PENDING'
              ? 'Nothing waiting'
              : `No claims ${topupStatusLabel(status as TopupRequestStatus).toLowerCase()}`
          }
          description="Claims appear here when a store records a transfer to us."
        />
      ) : (
        <MkCard flush>
          <Table caption="Store top-up claims">
            <THead>
              <Tr>
                <Th>Claimed</Th>
                <Th>Store · seller</Th>
                <Th>Paid into</Th>
                <Th align="right">Amount</Th>
                <Th>Evidence</Th>
                <Th>Status</Th>
                <Th align="right">Review</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((t) => (
                <Tr key={t.id}>
                  <Td className="mk-when sk-figure">{when(t.createdAt)}</Td>
                  <Td>
                    <div className="mk-cell">
                      <Link href={`/reseller-stores/${t.storeId}`} className="mk-name">
                        {t.storeName}
                      </Link>
                      <span className="mk-faint">{t.sellerCompanyName}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="mk-cell mk-small">
                      <span className="mk-body">{t.bankLabel}</span>
                      <span className="mk-faint">
                        {t.bankName} · <span className="sk-ident">{t.bankAccountNumber}</span>
                      </span>
                    </div>
                  </Td>
                  <Td align="right">
                    <Money amount={t.amountInr} />
                  </Td>
                  <Td>
                    <div className="mk-cell mk-small">
                      {t.transactionRef !== null ? (
                        <span className="sk-ident">{t.transactionRef}</span>
                      ) : null}
                      {t.hasProof ? (
                        <button
                          type="button"
                          className="mk-inline-link"
                          onClick={() => void onProof(t.id)}
                        >
                          <ReceiptText size={13} aria-hidden /> View receipt
                        </button>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="mk-cell">
                      <TopupChip status={t.status} />
                      {t.reviewNote !== null && t.reviewNote !== '' ? (
                        <span className="mk-faint">{t.reviewNote}</span>
                      ) : null}
                    </div>
                  </Td>
                  <Td align="right">
                    {t.status === 'PENDING' && mayReview ? (
                      <div className="mk-actions">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Check size={14} />}
                          onClick={() => {
                            setReviewing(t);
                            setIntent('ACCEPT');
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          icon={<X size={14} />}
                          onClick={() => {
                            setReviewing(t);
                            setIntent('REJECT');
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="mk-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MkCard>
      )}
      <Dialog
        open={reviewing !== null}
        onOpenChange={(o) => (o ? undefined : close())}
        locked={accept.isPending || reject.isPending}
        title={
          intent === 'ACCEPT'
            ? `Credit ${reviewing === null ? '' : formatInr(reviewing.amountInr)} to ${reviewing?.storeName ?? ''}?`
            : `Reject this claim?`
        }
        description={
          intent === 'ACCEPT'
            ? 'Only if the money is on our statement. It is held as the seller’s cash.'
            : 'Say why — the store reads it.'
        }
        tone={intent === 'REJECT' ? 'critical' : 'default'}
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={close}
              disabled={accept.isPending || reject.isPending}
            >
              Cancel
            </Button>
            <AsyncButton
              variant={intent === 'ACCEPT' ? 'primary' : 'destructive'}
              size="md"
              labels={{
                idle: intent === 'ACCEPT' ? 'Credit the store' : 'Reject',
                busy: 'Working…',
                done: intent === 'ACCEPT' ? 'Credited' : 'Rejected',
                error: 'Refused',
              }}
              onAction={onConfirm}
            />
          </DialogFooter>
        }
      >
        <div className="mk-stack">
          <TextArea
            id="st-note"
            label={intent === 'ACCEPT' ? 'Note (optional)' : 'Why'}
            requiredMark={intent === 'REJECT'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error !== null ? <MkAlert>{error}</MkAlert> : null}
        </div>
      </Dialog>
    </MkSection>
  );
}

function WithdrawalQueue({ storeId }: { readonly storeId: string | null }): ReactElement {
  const toast = useToast();
  const mayReview = usePermission('money.withdrawals.review');
  const mayPay = usePermission('money.remittances.manage');
  const [status, setStatus] = useState<string>('PENDING');
  const list = useAdminStoreWithdrawals(status, storeId);
  const approve = useApproveStoreWithdrawal();
  const reject = useRejectStoreWithdrawal();
  const [approving, setApproving] = useState<AdminStoreWithdrawal | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminStoreWithdrawal | null>(null);
  const [paying, setPaying] = useState<AdminStoreWithdrawal | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirmApprove(): Promise<void> {
    if (approving === null) return;
    try {
      await approve.mutateAsync({ requestId: approving.id });
      toast.success('Approved.');
      setApproving(null);
    } catch (err) {
      setApproveError(serverVerdict(err));
      throw err;
    }
  }

  async function confirmReject(): Promise<void> {
    if (rejecting === null) return;
    try {
      await reject.mutateAsync({ requestId: rejecting.id, reason: reason.trim() });
      toast.success('Rejected.');
      setRejecting(null);
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <MkSection>
      <SectionHeading
        title="Withdrawal requests"
        note="A store asking to be paid. Approving re-checks what it may withdraw; recording the payout is what pays it."
        action={
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {WITHDRAWAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {withdrawalStatusLabel(s)}
              </option>
            ))}
          </Select>
        }
      />
      {list.isPending ? (
        <SkeletonRows rows={3} cols={6} label="Loading withdrawal requests" />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          tone={status === 'PENDING' ? 'positive' : 'neutral'}
          title={
            status === 'PENDING'
              ? 'Nothing waiting'
              : `No ${withdrawalStatusLabel(status as WithdrawalRequestStatus).toLowerCase()} requests`
          }
        />
      ) : (
        <MkCard flush>
          <Table caption="Store withdrawal requests">
            <THead>
              <Tr>
                <Th>Asked</Th>
                <Th>Store · seller</Th>
                <Th>Pay to</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th align="right">Act</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((w) => (
                <Tr key={w.id}>
                  <Td className="mk-when sk-figure">{when(w.createdAt)}</Td>
                  <Td>
                    <div className="mk-cell">
                      <Link href={`/reseller-stores/${w.storeId}`} className="mk-name">
                        {w.storeName}
                      </Link>
                      <span className="mk-faint">{w.sellerCompanyName}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="mk-cell mk-small">
                      <span className="mk-body">{w.payeeName}</span>
                      <span className="mk-faint">
                        {w.payeeBankName} · <span className="sk-ident">{w.payeeAccountNumber}</span>{' '}
                        · <span className="sk-ident">{w.payeeIfsc}</span>
                      </span>
                    </div>
                  </Td>
                  <Td align="right">
                    <Money amount={w.amountInr} />
                  </Td>
                  <Td>
                    <div className="mk-cell">
                      <WithdrawalChip status={w.status} />
                      {w.bankReference !== null ? (
                        <span className="mk-faint">
                          {w.paidFromLabel ?? '—'} · {w.bankReference} · {when(w.paidAt)}
                        </span>
                      ) : null}
                      {w.rejectionReason !== null ? (
                        <span className="mk-faint">{w.rejectionReason}</span>
                      ) : null}
                    </div>
                  </Td>
                  <Td align="right">
                    <div className="mk-actions">
                      {w.status === 'PENDING' && mayReview ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Check size={14} />}
                          onClick={() => {
                            setApproving(w);
                            setApproveError(null);
                          }}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {(w.status === 'PENDING' || w.status === 'APPROVED') && mayPay ? (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Banknote size={14} />}
                          onClick={() => setPaying(w)}
                        >
                          Record payout
                        </Button>
                      ) : null}
                      {(w.status === 'PENDING' || w.status === 'APPROVED') && mayReview ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          icon={<X size={14} />}
                          onClick={() => {
                            setRejecting(w);
                            setReason('');
                            setError(null);
                          }}
                        >
                          Reject
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MkCard>
      )}
      <Dialog
        open={approving !== null}
        onOpenChange={(o) => (o ? undefined : setApproving(null))}
        locked={approve.isPending}
        title={
          approving === null
            ? 'Approve this withdrawal?'
            : `Approve paying ${approving.storeName} ${formatInr(approving.amountInr)}?`
        }
        description={
          approving === null
            ? undefined
            : `To ${approving.payeeName} · ${approving.payeeBankName} · ${approving.payeeAccountNumber} · ${approving.payeeIfsc}. Approving re-checks what the store may withdraw; nothing is paid until the payout is recorded.`
        }
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setApproving(null)}
              disabled={approve.isPending}
            >
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              labels={{
                idle: 'Approve the withdrawal',
                busy: 'Approving…',
                done: 'Approved',
                error: 'Refused',
              }}
              onAction={confirmApprove}
            />
          </DialogFooter>
        }
      >
        {approveError !== null ? <MkAlert>{approveError}</MkAlert> : undefined}
      </Dialog>
      <Dialog
        open={rejecting !== null}
        onOpenChange={(o) => (o ? undefined : setRejecting(null))}
        locked={reject.isPending}
        title="Reject this withdrawal?"
        description="Say why — the store reads it. It can ask again."
        tone="critical"
        footer={
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setRejecting(null)}
              disabled={reject.isPending}
            >
              Cancel
            </Button>
            <AsyncButton
              variant="destructive"
              size="md"
              labels={{ idle: 'Reject', busy: 'Rejecting…', done: 'Rejected', error: 'Refused' }}
              onAction={confirmReject}
            />
          </DialogFooter>
        }
      >
        <div className="mk-stack">
          <TextArea
            id="sw-reason"
            label="Why"
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error !== null ? <MkAlert>{error}</MkAlert> : null}
        </div>
      </Dialog>
      {paying !== null ? <PayModal request={paying} onClose={() => setPaying(null)} /> : null}
    </MkSection>
  );
}

function PayModal({
  request,
  onClose,
}: {
  readonly request: AdminStoreWithdrawal;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const pay = usePayStoreWithdrawal();
  const accounts = usePlatformBankAccounts();
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  // Local wall clock — the input is read back as LOCAL time (see datetime-local.ts).
  const [paidOn, setPaidOn] = useState(localNow);
  const [error, setError] = useState<string | null>(null);
  // IDEM-1: generated when the form opens, reused on a retry.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const rupeeAccounts = (accounts.data ?? []).filter((a) => a.currency === 'INR' && a.isActive);

  async function onConfirm(): Promise<void> {
    setError(null);
    try {
      await pay.mutateAsync({
        requestId: request.id,
        paidFromAccountId: accountId,
        bankReference: reference.trim(),
        paidAt: new Date(paidOn).toISOString(),
        idempotencyKey,
      });
      toast.success(`Recorded paying ${request.storeName} ${formatInr(request.amountInr)}.`);
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      locked={pay.isPending}
      title={`Record paying ${request.storeName} ${formatInr(request.amountInr)}`}
      description={`To ${request.payeeName} · ${request.payeeBankName} · ${request.payeeAccountNumber} · ${request.payeeIfsc}. The cash leaves as ${request.sellerCompanyName}’s.`}
      footer={
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={pay.isPending}
          >
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            labels={{
              idle: 'Record the payout',
              busy: 'Recording…',
              done: 'Recorded',
              error: 'Refused',
            }}
            onAction={onConfirm}
          />
        </DialogFooter>
      }
    >
      <div className="mk-stack">
        <Select
          id="sp-account"
          label="Paid from"
          requiredMark
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Choose one of our rupee accounts</option>
          {rupeeAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} — {a.bankName}
            </option>
          ))}
        </Select>
        <TextField
          id="sp-ref"
          label="Bank reference"
          requiredMark
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          inputClassName="sk-ident"
        />
        <DateField
          id="sp-when"
          label="Paid on"
          requiredMark
          type="datetime-local"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
        />
        {error !== null ? <MkAlert>{error}</MkAlert> : null}
      </div>
    </Dialog>
  );
}
