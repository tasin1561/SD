'use client';

import Link from 'next/link';

import { useState, type ReactElement } from 'react';
import { ArrowRight, Check, ReceiptText, X } from 'lucide-react';
import { TopupRequestStatus } from '@skydrop/db';
import { openExternalWhenReady, useToast } from '@skydrop/ui/components';
import { topupStatusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useAcceptTopup,
  useAdminTopups,
  useRejectTopup,
  useTopupProofUrl,
  type AdminTopupView,
} from '@/lib/ops-hooks';
import { MkAlert, MkCard, TopupChip } from '../../seller-wallets/_components/money-parts';

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
      // Opened inside the click, filled when the presigned URL lands.
      await openExternalWhenReady(async () => (await proofUrl.mutateAsync({ topupId })).url);
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  /** Rejects on a refusal, so the button shows it; the verdict is set first. */
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
      throw err;
    }
  }

  // The server wants ≥5 characters on a rejection; mirrored so the
  // operator is told before submitting rather than after.
  const rejectTooShort = intent === 'REJECT' && note.trim().length < 5;
  const busy = accept.isPending || reject.isPending;
  const rows = list.data ?? [];

  return (
    <div className="mk-page">
      <PageHeader
        title="Wallet top-ups"
        subtitle="Sellers telling us they have sent money. Accepting one credits their wallet — check it against the statement first."
        action={
          // The accounts moved to their own page. A pointer stays,
          // because with none configured nothing can ever arrive here,
          // and an empty queue would otherwise look like quiet demand
          // rather than a missing setup step.
          <Link href="/bank-accounts" className="mk-link">
            Bank accounts <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />

      <div className="mk-filters">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {topupStatusLabel(s as TopupRequestStatus)}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={4} cols={7} label="Loading top-ups…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed to load top-ups.'}
          retry={() => void list.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          tone={status === 'PENDING' ? 'positive' : 'neutral'}
          title={status === 'PENDING' ? 'Nothing waiting' : `No ${status.toLowerCase()} top-ups`}
          description="Claims appear here when a seller records a transfer."
        />
      ) : (
        <MkCard flush>
          <Table caption="Top-up claims">
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
              {rows.map((t) => (
                <Tr key={t.id}>
                  <Td className="mk-when sk-figure">
                    {new Date(t.createdAt).toISOString().slice(0, 10)}
                  </Td>
                  {/* The company, not the uuid. An operator matching
                      this against a bank statement needs the name the
                      money came from. */}
                  <Td>
                    <span className="mk-name">
                      {t.sellerCompanyName ?? t.sellerName ?? t.sellerId.slice(0, 8)}
                    </span>
                  </Td>
                  <Td>
                    {/* The label is our filing name; the account is what
                        appears on the statement being checked. Both,
                        because the label is how the account is chosen
                        and the number is how it is verified. */}
                    <div className="mk-cell mk-small">
                      <span className="mk-body">{t.bankLabel}</span>
                      <span>{t.bankName}</span>
                      <span className="mk-faint">{t.bankAccountName}</span>
                      <span className="mk-faint sk-ident">{t.bankAccountNumber}</span>
                      {t.bankBranchName !== null && (
                        <span className="mk-faint">{t.bankBranchName}</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right" className="sk-figure">
                    {t.currency} {t.amount}
                  </Td>
                  <Td>
                    <div className="mk-cell mk-small">
                      {t.transactionRef !== null && (
                        <span className="mk-body sk-ident">{t.transactionRef}</span>
                      )}
                      {t.hasProof && (
                        <button
                          type="button"
                          className="mk-inline-link"
                          onClick={() => void onViewProof(t.id)}
                        >
                          <ReceiptText size={13} aria-hidden /> View receipt
                        </button>
                      )}
                      {t.transactionRef === null && !t.hasProof && (
                        <span className="mk-faint">—</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="mk-cell">
                      <TopupChip status={t.status} />
                      {t.reviewNote !== null && t.reviewNote !== '' && (
                        <span className="mk-faint">{t.reviewNote}</span>
                      )}
                      {/* WHO and WHEN. A decision about somebody's money
                          with no name against it is one nobody can be
                          asked about later. */}
                      {t.reviewedAt !== null && (
                        <span className="mk-faint">
                          {new Date(t.reviewedAt).toLocaleString()}
                          {t.reviewedByEmail !== null ? ` · ${t.reviewedByEmail}` : ''}
                        </span>
                      )}
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
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={
          intent === 'ACCEPT'
            ? `Credit ${reviewing?.currency ?? ''} ${reviewing?.amount ?? ''}?`
            : 'Reject this claim?'
        }
        tone={intent === 'REJECT' ? 'critical' : 'default'}
        locked={busy}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <AsyncButton
              variant={intent === 'REJECT' ? 'destructive' : 'primary'}
              size="md"
              disabled={busy || rejectTooShort}
              labels={{
                idle: intent === 'ACCEPT' ? 'Credit the wallet' : 'Reject',
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
          {reviewing !== null && (
            <div className="mk-subject">
              <span className="mk-subject__label">Claimed by</span>
              <span className="mk-subject__main">
                {reviewing.sellerCompanyName ?? reviewing.sellerName ?? reviewing.sellerId}
              </span>
              <span className="mk-small">
                {reviewing.bankLabel} ·{' '}
                <span className="sk-ident">{reviewing.bankAccountNumber}</span>
                {reviewing.transactionRef !== null ? (
                  <>
                    {' '}
                    · ref <span className="sk-ident">{reviewing.transactionRef}</span>
                  </>
                ) : null}
              </span>
            </div>
          )}
          <p className="mk-muted">
            {intent === 'ACCEPT'
              ? 'This adds the money to the seller’s wallet immediately. Only do it once you have seen the payment on our statement — it is not reversible without an adjusting entry.'
              : 'The seller sees this reason, so write something they can act on: what did not match, or what you need from them.'}
          </p>

          {error !== null && <MkAlert>{error}</MkAlert>}

          <TextArea
            label={intent === 'ACCEPT' ? 'Note (optional)' : 'Reason'}
            requiredMark={intent === 'REJECT'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            showCount
          />
        </div>
      </Dialog>
    </div>
  );
}
