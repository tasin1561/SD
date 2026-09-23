'use client';

import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Check, Landmark, X } from 'lucide-react';
import { Ident } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useApproveBankChange,
  useBankChangeRequests,
  useRejectBankChange,
  type BankChangeRequestView,
  type BankDetailsView,
} from '@/lib/ops-hooks';
import { MkAlert, MkCard } from '../../seller-wallets/_components/money-parts';

/**
 * The review queue for a seller's withdrawal destination.
 *
 * ── WHAT THE HUMAN IS ACTUALLY FOR ───────────────────────────────────
 * A seller's bank details are where their money is sent, so anyone who
 * gets into a seller account could redirect the withdrawals by editing six
 * fields. The first add writes straight through; every edit after that
 * stops HERE, and the live details do not move until somebody on this
 * page says so. Withdrawals keep flowing to the old account in the
 * meantime — a pending change is not yet a fact.
 *
 * That makes this screen's whole job the COMPARISON. An admin scanning
 * six pairs of values hunting for one altered digit is how a fraudulent
 * change gets waved through, so the diff is computed rather than left
 * to the eye: the count is in the card header, every changed field
 * carries a badge, and the untouched ones are dimmed out of the way.
 *
 * Same shape as the top-ups queue (`../topups`) because it is the same
 * job — a person weighing a submitted claim against what they can
 * verify, then accepting or refusing with a reason the other side
 * reads.
 */

/**
 * The six fields, ordered by how much they decide where money lands.
 *
 * Account name and number first: those two ARE the destination. Bank
 * and branch are context, routing and SWIFT are how it gets routed.
 */
const FIELDS: ReadonlyArray<readonly [key: keyof BankDetailsView, label: string, mono: boolean]> = [
  ['bankAccountName', 'Account name', false],
  ['bankAccountNumber', 'Account number', true],
  ['bankName', 'Bank', false],
  ['bankBranchName', 'Branch', false],
  ['bankRoutingNumber', 'Routing number', true],
  ['bankSwiftCode', 'SWIFT', true],
];

function changedKeys(req: BankChangeRequestView): ReadonlySet<keyof BankDetailsView> {
  const out = new Set<keyof BankDetailsView>();
  for (const [key] of FIELDS) {
    if (req.current[key] !== req.proposed[key]) out.add(key);
  }
  return out;
}

function renderValue(value: string, mono: boolean): ReactNode {
  if (value === '') return <span className="mk-faint">—</span>;
  return mono ? <Ident value={value} /> : value;
}

type Intent = 'APPROVE' | 'REJECT';

export function BankChangesIndex(): ReactElement {
  const toast = useToast();
  const mayReview = usePermission('sellers.bank_change.approve');
  // The empty state's way out is the seller records — but reviewing
  // bank changes and browsing sellers are separate permissions, so
  // offer the link only to somebody the boundary would let through.
  const maySeeSellers = usePermission('sellers.view');
  const list = useBankChangeRequests('PENDING');
  const approve = useApproveBankChange();
  const reject = useRejectBankChange();

  const [reviewing, setReviewing] = useState<BankChangeRequestView | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setReviewing(null);
    setIntent(null);
    setReason('');
    setError(null);
  }

  function open(req: BankChangeRequestView, next: Intent): void {
    setReviewing(req);
    setIntent(next);
    setReason('');
    setError(null);
  }

  /** Rejects on a refusal (after setting the verdict) so the button shows it. */
  async function onConfirm(): Promise<void> {
    if (reviewing === null || intent === null) return;
    setError(null);
    try {
      if (intent === 'APPROVE') {
        await approve.mutateAsync({ requestId: reviewing.id });
        toast.success(`${reviewing.companyName} is now paid to the new account.`);
      } else {
        await reject.mutateAsync({ requestId: reviewing.id, reason: reason.trim() });
        toast.success('Rejected — the seller reads your reason.');
      }
      close();
    } catch (err) {
      // FE-2: the server's refusal, in its own words. A
      // BANK_CHANGE_ALREADY_DECIDED lands here when a second reviewer
      // got to the same request first, and that is exactly what the
      // operator needs told.
      setError(serverVerdict(err));
      throw err;
    }
  }

  // The server wants 10..500 on a rejection. Mirrored so the operator
  // learns it while typing rather than after submitting — the refusal
  // itself still comes from the server, verbatim, if it disagrees.
  const trimmed = reason.trim();
  const reasonTooShort = intent === 'REJECT' && trimmed.length < 10;
  const busy = approve.isPending || reject.isPending;
  const requests = list.data ?? [];

  return (
    <div className="mk-page">
      <PageHeader
        title="Bank detail changes"
        subtitle="Sellers asking us to send their withdrawals somewhere new. Their money keeps going to the account already on file until you approve one."
      />

      {list.isLoading ? (
        <SkeletonRows rows={3} cols={3} label="Loading bank change requests…" />
      ) : list.isError ? (
        <ErrorState
          message={serverVerdict(list.error, 'Failed to load bank change requests.')}
          retry={() => void list.refetch()}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          tone="positive"
          title="Nothing waiting"
          description="A request appears here when a seller edits bank details they already had on file. A seller adding theirs for the first time does not need approval — check their profile on the seller record instead."
          action={
            maySeeSellers ? (
              <Link href="/sellers" className={buttonClassName('secondary', 'sm')}>
                <span className="sk-btn__label">Open the seller records</span>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="mk-stack">
          {requests.map((req) => {
            const changed = changedKeys(req);
            // Masking is applied to BOTH sides, and two different
            // accounts can mask to the same string. So equal masks are
            // not evidence the account is unchanged, and saying so is
            // better than letting an admin infer it.
            const accountNumberUnchanged =
              req.current.bankAccountNumber === req.proposed.bankAccountNumber;

            return (
              <MkCard
                key={req.id}
                flush
                icon={<Landmark size={18} />}
                title={req.companyName}
                subtitle={`Submitted ${new Date(req.submittedAt).toISOString().slice(0, 10)} · ${
                  // Zero is possible and is NOT a no-op request: the
                  // account number is shown in full on both sides, so a
                  // change confined to it shows up as no visible
                  // difference. Saying that is better than a bare
                  // "0 of 6" the reader has to explain to themselves.
                  changed.size === 0
                    ? 'nothing visibly different — read the note below'
                    : `${changed.size} of ${FIELDS.length} fields changed`
                }`}
                aside={
                  mayReview ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check size={14} />}
                        onClick={() => open(req, 'APPROVE')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        icon={<X size={14} />}
                        onClick={() => open(req, 'REJECT')}
                      >
                        Reject
                      </Button>
                    </>
                  ) : undefined
                }
              >
                <Table caption={`Bank details for ${req.companyName}`}>
                  <THead>
                    <Tr>
                      <Th>Field</Th>
                      <Th>On file now</Th>
                      <Th>Proposed</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {FIELDS.map(([key, label, mono]) => {
                      const isChanged = changed.has(key);
                      return (
                        <Tr key={key} className="mk-diff-row" data-changed={isChanged ? '1' : '0'}>
                          <Td>{label}</Td>
                          <Td>{renderValue(req.current[key], mono)}</Td>
                          <Td>
                            <span className="mk-balances">
                              {renderValue(req.proposed[key], mono)}
                              {isChanged && <StatusChip kind="pending" label="changed" size="sm" />}
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
                {accountNumberUnchanged && (
                  <div className="mk-card__foot">
                    The account number is unchanged — this request moves something else. Check what
                    is marked changed above.
                  </div>
                )}
              </MkCard>
            );
          })}
        </div>
      )}

      <Dialog
        open={reviewing !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        tone={intent === 'REJECT' ? 'critical' : 'default'}
        locked={busy}
        title={
          intent === 'APPROVE'
            ? `Pay ${reviewing?.companyName ?? 'this seller'} into the new account?`
            : `Reject ${reviewing?.companyName ?? 'this'} bank change?`
        }
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <AsyncButton
              variant={intent === 'REJECT' ? 'destructive' : 'primary'}
              size="md"
              disabled={reasonTooShort}
              labels={{
                idle: intent === 'APPROVE' ? 'Approve the new account' : 'Reject the change',
                busy: 'Working…',
                done: intent === 'APPROVE' ? 'Approved' : 'Rejected',
                error: 'Refused',
              }}
              onAction={onConfirm}
            />
          </DialogFooter>
        }
      >
        <div className="mk-stack">
          {intent === 'APPROVE' ? (
            <>
              <p className="mk-muted">
                From this moment every withdrawal to {reviewing?.companyName ?? 'this seller'} goes
                to the account below, and the one they had before stops receiving money. Undoing it
                takes another change request and another approval — so approve it because you
                recognise the account, not because the form was filled in.
              </p>
              {reviewing !== null && (
                <div className="mk-subject">
                  <span className="mk-subject__label">New destination</span>
                  <span className="mk-subject__main">{reviewing.proposed.bankAccountName}</span>
                  <span>
                    <Ident value={reviewing.proposed.bankAccountNumber} />
                  </span>
                  <span className="mk-small">
                    {reviewing.proposed.bankName}
                    {reviewing.proposed.bankBranchName !== ''
                      ? ` · ${reviewing.proposed.bankBranchName}`
                      : ''}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mk-muted">
                Nothing moves — their withdrawals carry on to the account already on file. The
                seller reads your reason word for word, so write what did not match or what you need
                from them; “rejected” on its own just sends the same request back.
              </p>
              <TextArea
                label="Reason the seller will read"
                requiredMark
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={500}
                showCount
                hint="At least 10 characters."
                placeholder="e.g. The account name does not match the business name we have on file. Send a bank statement header showing the account holder."
              />
            </>
          )}

          {error !== null && <MkAlert>{error}</MkAlert>}
        </div>
      </Dialog>
    </div>
  );
}
