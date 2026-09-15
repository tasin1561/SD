'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Section,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  TopupStatusBadge,
  Tr,
  WithdrawalStatusBadge,
  formatInr,
  openExternalWhenReady,
  useToast,
} from '@skydrop/ui/components';
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
    <div className="space-y-6">
      <PageHeader
        title="Reseller store wallets"
        subtitle="Top-up claims and withdrawal requests from stores whose wallet Skydrop manages. The cash is the seller’s in our books."
        action={
          <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
            Reseller stores →
          </Link>
        }
      />
      {storeId !== null ? (
        <p className="text-text-muted text-sm" role="status">
          Showing one store only:{' '}
          <Link href={`/reseller-stores/${storeId}`} className="text-accent hover:underline">
            {scoped.data?.storeName ?? 'this store'}
          </Link>{' '}
          ·{' '}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => router.replace(pathname)}
          >
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
    <Section
      title="Top-up claims"
      subtitle="A store saying it sent money to our bank. Accepting credits its wallet — check the statement first."
      action={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {TOPUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {topupStatusLabel(s)}
            </option>
          ))}
        </Select>
      }
    >
      {list.isPending ? (
        <LoadingState label="Loading top-up claims" rows={3} />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={
            status === 'PENDING'
              ? 'Nothing waiting'
              : `No claims ${topupStatusLabel(status as TopupRequestStatus).toLowerCase()}`
          }
          description="Claims appear here when a store records a transfer to us."
        />
      ) : (
        <Table>
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
                <Td className="text-text-muted text-xs">{when(t.createdAt)}</Td>
                <Td>
                  <Link href={`/reseller-stores/${t.storeId}`} className="text-accent">
                    {t.storeName}
                  </Link>
                  <div className="text-text-faint text-xs">{t.sellerCompanyName}</div>
                </Td>
                <Td className="text-xs">
                  {t.bankLabel}
                  <div className="text-text-faint">
                    {t.bankName} · {t.bankAccountNumber}
                  </div>
                </Td>
                <Td align="right">
                  <Money amount={t.amountInr} />
                </Td>
                <Td className="text-xs">
                  {t.transactionRef !== null ? (
                    <div className="font-mono">{t.transactionRef}</div>
                  ) : null}
                  {t.hasProof ? (
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => void onProof(t.id)}
                    >
                      View receipt
                    </button>
                  ) : null}
                </Td>
                <Td className="text-xs">
                  <TopupStatusBadge status={t.status} />
                  {t.reviewNote !== null && t.reviewNote !== '' ? (
                    <div className="text-text-faint">{t.reviewNote}</div>
                  ) : null}
                </Td>
                <Td align="right">
                  {t.status === 'PENDING' && mayReview ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="primary"
                        size="sm"
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
                        onClick={() => {
                          setReviewing(t);
                          setIntent('REJECT');
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-text-faint text-xs">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <Modal
        open={reviewing !== null}
        onOpenChange={(o) => (o ? undefined : close())}
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
      >
        <div className="space-y-4">
          <FormField
            label={intent === 'ACCEPT' ? 'Note (optional)' : 'Why'}
            htmlFor="st-note"
            required={intent === 'REJECT'}
          >
            <Textarea id="st-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={intent === 'ACCEPT' ? 'primary' : 'destructive'}
              size="md"
              disabled={accept.isPending || reject.isPending}
              onClick={() => void onConfirm()}
            >
              {intent === 'ACCEPT' ? 'Credit the store' : 'Reject'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Section>
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

  return (
    <Section
      title="Withdrawal requests"
      subtitle="A store asking to be paid. Approving re-checks what it may withdraw; recording the payout is what pays it."
      action={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {WITHDRAWAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {withdrawalStatusLabel(s)}
            </option>
          ))}
        </Select>
      }
    >
      {list.isPending ? (
        <LoadingState label="Loading withdrawal requests" rows={3} />
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={
            status === 'PENDING'
              ? 'Nothing waiting'
              : `No ${withdrawalStatusLabel(status as WithdrawalRequestStatus).toLowerCase()} requests`
          }
        />
      ) : (
        <Table>
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
                <Td className="text-text-muted text-xs">{when(w.createdAt)}</Td>
                <Td>
                  <Link href={`/reseller-stores/${w.storeId}`} className="text-accent">
                    {w.storeName}
                  </Link>
                  <div className="text-text-faint text-xs">{w.sellerCompanyName}</div>
                </Td>
                <Td className="text-xs">
                  {w.payeeName}
                  <div className="text-text-faint font-mono">
                    {w.payeeBankName} · {w.payeeAccountNumber} · {w.payeeIfsc}
                  </div>
                </Td>
                <Td align="right">
                  <Money amount={w.amountInr} />
                </Td>
                <Td className="text-xs">
                  <WithdrawalStatusBadge status={w.status} />
                  {w.bankReference !== null ? (
                    <div className="text-text-faint">
                      {w.paidFromLabel ?? '—'} · {w.bankReference} · {when(w.paidAt)}
                    </div>
                  ) : null}
                  {w.rejectionReason !== null ? (
                    <div className="text-text-faint">{w.rejectionReason}</div>
                  ) : null}
                </Td>
                <Td align="right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {w.status === 'PENDING' && mayReview ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setApproving(w);
                          setApproveError(null);
                        }}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {(w.status === 'PENDING' || w.status === 'APPROVED') && mayPay ? (
                      <Button variant="primary" size="sm" onClick={() => setPaying(w)}>
                        Record payout
                      </Button>
                    ) : null}
                    {(w.status === 'PENDING' || w.status === 'APPROVED') && mayReview ? (
                      <Button
                        variant="destructive"
                        size="sm"
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
      )}
      <Modal
        open={approving !== null}
        onOpenChange={(o) => (o ? undefined : setApproving(null))}
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
      >
        <div className="space-y-4">
          {approveError !== null ? (
            <p role="alert" className="text-critical text-sm">
              {approveError}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={approve.isPending}
              onClick={() => {
                if (approving === null) return;
                approve.mutate(
                  { requestId: approving.id },
                  {
                    onSuccess: () => {
                      toast.success('Approved.');
                      setApproving(null);
                    },
                    onError: (err) => setApproveError(serverVerdict(err)),
                  },
                );
              }}
            >
              {approve.isPending ? 'Approving…' : 'Approve the withdrawal'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
      <Modal
        open={rejecting !== null}
        onOpenChange={(o) => (o ? undefined : setRejecting(null))}
        title="Reject this withdrawal?"
        description="Say why — the store reads it. It can ask again."
        tone="critical"
      >
        <div className="space-y-4">
          <FormField label="Why" htmlFor="sw-reason" required>
            <Textarea id="sw-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button type="button" variant="secondary" size="md" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="md"
              disabled={reject.isPending}
              onClick={() => {
                if (rejecting === null) return;
                reject.mutate(
                  { requestId: rejecting.id, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast.success('Rejected.');
                      setRejecting(null);
                    },
                    onError: (err) => setError(serverVerdict(err)),
                  },
                );
              }}
            >
              Reject
            </Button>
          </ModalFooter>
        </div>
      </Modal>
      {paying !== null ? <PayModal request={paying} onClose={() => setPaying(null)} /> : null}
    </Section>
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
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={`Record paying ${request.storeName} ${formatInr(request.amountInr)}`}
      description={`To ${request.payeeName} · ${request.payeeBankName} · ${request.payeeAccountNumber} · ${request.payeeIfsc}. The cash leaves as ${request.sellerCompanyName}’s.`}
    >
      <div className="space-y-4">
        <FormField label="Paid from" htmlFor="sp-account" required>
          <Select id="sp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose one of our rupee accounts</option>
            {rupeeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.bankName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Bank reference" htmlFor="sp-ref" required>
          <Input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <FormField label="Paid on" htmlFor="sp-when" required>
          <Input
            id="sp-when"
            type="datetime-local"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </FormField>
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={pay.isPending}
            onClick={() => void onConfirm()}
          >
            {pay.isPending ? 'Recording…' : 'Record the payout'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
