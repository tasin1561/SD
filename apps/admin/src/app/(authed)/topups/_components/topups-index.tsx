'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { BankAccountsPanel } from './bank-accounts-panel';
import { usePermission } from '@/lib/use-permission';
import {
  useAcceptTopup,
  useAdminTopups,
  useRejectTopup,
  useTopupProofUrl,
  type AdminTopupView,
} from '@/lib/ops-hooks';

/**
 * The queue where money enters a seller's wallet.
 *
 * ── WAL-2 ────────────────────────────────────────────────────────────
 * A seller declaring a transfer writes nothing to the ledger. Accepting
 * here is the credit — guarded on PENDING and backed by a UNIQUE
 * wallet_entry_id, so a double-click cannot pay twice. That is why the
 * accept button is the loud one and the copy says what it does.
 *
 * ── LOOK BEFORE YOU CREDIT ───────────────────────────────────────────
 * The claim carries either a bank reference or an uploaded receipt, and
 * the whole point of the review is that a human has matched one of them
 * against the statement. The receipt link is fetched ON DEMAND rather
 * than listed: it is a presigned URL with a short life, and minting one
 * per row on every page load would both leak them into a payload and
 * expire before anyone clicked.
 *
 * Until this page existed the endpoints had no caller — a seller could
 * not claim a transfer, and nobody could accept one.
 */
const STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;

export function TopupsIndex(): ReactElement {
  const toast = useToast();
  const mayReview = usePermission('money.topups.review');
  const [status, setStatus] = useState<string>('PENDING');
  const list = useAdminTopups(status);
  const accept = useAcceptTopup();
  const reject = useRejectTopup();
  const proofUrl = useTopupProofUrl();

  const [reviewing, setReviewing] = useState<AdminTopupView | null>(null);
  const [intent, setIntent] = useState<'ACCEPT' | 'REJECT' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setReviewing(null);
    setIntent(null);
    setNote('');
    setError(null);
  }

  async function onViewProof(topupId: string): Promise<void> {
    try {
      const r = await proofUrl.mutateAsync({ topupId });
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  async function onConfirm(): Promise<void> {
    if (reviewing === null || intent === null) return;
    setError(null);
    try {
      if (intent === 'ACCEPT') {
        await accept.mutateAsync({
          topupId: reviewing.id,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        toast.success(`Credited ${reviewing.currency} ${reviewing.amount}.`);
      } else {
        await reject.mutateAsync({ topupId: reviewing.id, reason: note.trim() });
        toast.success('Rejected — the seller sees your reason.');
      }
      close();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // The server wants ≥5 characters on a rejection; mirrored so the
  // operator is told before submitting rather than after.
  const rejectTooShort = intent === 'REJECT' && note.trim().length < 5;
  const busy = accept.isPending || reject.isPending;

  return (
    <div>
      <PageHeader
        title="Wallet top-ups"
        subtitle="Sellers telling us they have sent money. Accepting one credits their wallet — check it against the statement first."
      />

      <div className="mb-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[200px]">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <LoadingState label="Loading top-ups…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load top-ups.'}
          retry={() => void list.refetch()}
        />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          title={status === 'PENDING' ? 'Nothing waiting' : `No ${status.toLowerCase()} top-ups`}
          description="Claims appear here when a seller records a transfer."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Claimed</Th>
                  <Th>Seller</Th>
                  <Th>Paid into</Th>
                  <Th align="right">Amount</Th>
                  <Th>Evidence</Th>
                  <Th>Status</Th>
                  <Th align="right">Review</Th>
                </Tr>
              </THead>
              <TBody>
                {(list.data ?? []).map((t) => (
                  <Tr key={t.id}>
                    <Td className="text-text-muted text-xs">
                      {new Date(t.createdAt).toISOString().slice(0, 10)}
                    </Td>
                    <Td className="text-text-body">{t.sellerName ?? t.sellerId.slice(0, 8)}</Td>
                    <Td className="text-text-muted">{t.bankLabel}</Td>
                    <Td align="right" className="font-mono">
                      {t.currency} {t.amount}
                    </Td>
                    <Td className="text-xs">
                      {t.transactionRef !== null && (
                        <div className="text-text-body font-mono">{t.transactionRef}</div>
                      )}
                      {t.hasProof && (
                        <button
                          type="button"
                          className="text-accent hover:underline"
                          onClick={() => void onViewProof(t.id)}
                        >
                          View receipt
                        </button>
                      )}
                      {t.transactionRef === null && !t.hasProof && (
                        <span className="text-text-faint">—</span>
                      )}
                    </Td>
                    <Td className="text-text-body text-xs">
                      {t.status}
                      {t.reviewNote !== null && t.reviewNote !== '' && (
                        <div className="text-text-faint mt-0.5">{t.reviewNote}</div>
                      )}
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
          </CardBody>
        </Card>
      )}

      <Modal
        open={reviewing !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={
          intent === 'ACCEPT'
            ? `Credit ${reviewing?.currency ?? ''} ${reviewing?.amount ?? ''}?`
            : 'Reject this claim?'
        }
        tone={intent === 'REJECT' ? 'critical' : 'default'}
      >
        <p className="text-text-muted mb-3 text-sm">
          {intent === 'ACCEPT'
            ? 'This adds the money to the seller’s wallet immediately. Only do it once you have seen the payment on our statement — it is not reversible without an adjusting entry.'
            : 'The seller sees this reason, so write something they can act on: what did not match, or what you need from them.'}
        </p>

        {error !== null && (
          <div className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] text-critical mb-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <FormField
          label={intent === 'ACCEPT' ? 'Note (optional)' : 'Reason'}
          required={intent === 'REJECT'}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </FormField>

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={intent === 'REJECT' ? 'destructive' : 'primary'}
            size="md"
            disabled={busy || rejectTooShort}
            onClick={() => void onConfirm()}
          >
            {busy ? 'Working…' : intent === 'ACCEPT' ? 'Credit the wallet' : 'Reject'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* What the seller was reading when they made the transfer above. */}
      <BankAccountsPanel />
    </div>
  );
}
