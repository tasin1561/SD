'use client';

import type { ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { Money, openExternalWhenReady } from '@skydrop/ui/components';
import { topupStatusKind, topupStatusLabel } from '@skydrop/ui/status';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TopupRequestStatus } from '@skydrop/db';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useTopupBankAccounts, useTopupProofUrl, useTopupRequests } from '@/lib/api-hooks';
import { TopupWizard } from './topup-wizard';
import './wallet.css';

/** The view type says `string`; this is what makes it safe to badge. */
function isTopupStatus(value: string): value is TopupRequestStatus {
  return (Object.values(TopupRequestStatus) as string[]).includes(value);
}

/**
 * Every top-up the seller has claimed, whatever became of it.
 *
 * The form itself is the wizard — this is only the history. Pending and
 * rejected claims live HERE and never in the ledger. That is not a
 * filter: a claim is not a payment, so no wallet entry exists until an
 * operator matches it against the statement. The ledger showing only
 * accepted top-ups is a property of when the entry is written, not
 * something this view chooses.
 */
export function TopupCard({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement | null {
  const identity = useSellerIdentity();
  const banks = useTopupBankAccounts();
  const requests = useTopupRequests();

  // Cosmetic (FE-2): the wallet page opens on wallet.view; submitting
  // needs wallet.topup, which finance and owner hold and others do not.
  if (!can(identity, 'wallet.topup')) return null;

  const rows = requests.data ?? [];

  /*
    No card of its own: the table is its own card, and it sits directly
    under the wallet page's tab bar.
  */
  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          title="No top-ups yet."
          description="Send money to one of our accounts, then record it here — we credit it once it shows on our statement, so it is not instant."
          action={
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => onOpenChange(true)}
            >
              Top-up wallet
            </Button>
          }
        />
      ) : (
        <Table caption="Top-ups">
          <THead>
            <Tr>
              <Th>Sent</Th>
              <Th>To</Th>
              <Th align="right">Amount</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="wal-when sk-figure">
                  {/* Local, not `toISOString().slice(0,10)`, which is
                        UTC: a transfer sent at 1am in Dhaka was shown
                        as the previous day. And with the time, because
                        the Status column beside it already carries one
                        — a row that dates two of its own events
                        differently reads as two different events. */}
                  {new Date(r.createdAt).toLocaleDateString()}
                  <div className="wal-faint">
                    {new Date(r.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </Td>
                <Td>
                  {/* The account, not our filing name for it. A seller
                        checking this against their bank statement needs
                        the bank and the number they typed; "Tasin City"
                        is nothing they can compare. */}
                  <div className="wal-stack">
                    <span>{r.bankName}</span>
                    <span className="wal-faint sk-ident">{r.bankAccountNumber}</span>
                    {r.bankBranchName !== null && (
                      <span className="wal-faint">{r.bankBranchName}</span>
                    )}
                  </div>
                </Td>
                <Td align="right">
                  {/* In the currency they SENT, and never converted:
                        this is a record of a bank transfer that already
                        happened, so restating it in another currency
                        would stop it matching their statement. A bare
                        1000.00 does not say whether that was taka or
                        rupees, which is the one thing they need to
                        recognise the payment. */}
                  <Money
                    amount={r.amount}
                    currency={r.currency === 'BDT' ? 'BDT' : 'INR'}
                    convert={false}
                  />
                </Td>
                <Td>
                  <div className="wal-stack">
                    {r.transactionRef !== null && (
                      <span className="wal-faint sk-ident">{r.transactionRef}</span>
                    )}
                    {r.hasProof ? (
                      <ProofLink topupId={r.id} />
                    ) : (
                      r.transactionRef === null && <span className="wal-faint">—</span>
                    )}
                  </div>
                </Td>
                <Td>
                  {/* The CHIP, not the raw enum. Spelling `PENDING` here
                        while every other list in the app renders a chip
                        is a second vocabulary for one status, which is
                        the drift FE-6 exists to stop. The payer's words
                        (`topupStatusLabel(…, 'payer')`) differ from an
                        operator's.

                        NARROWED, never cast — the view type says
                        `string`, and a cast would render an unstyled
                        chip for a value the mapper does not know. An
                        unrecognised status falls back to its own text,
                        which is what the column said before. */}
                  {isTopupStatus(r.status) ? (
                    <StatusChip
                      kind={topupStatusKind(r.status)}
                      label={topupStatusLabel(r.status, 'payer')}
                      size="sm"
                    />
                  ) : (
                    <span>{r.status}</span>
                  )}
                  {/* When it was decided. "REJECTED" with no date leaves
                        a seller unsure whether anyone has looked yet. */}
                  {r.reviewedAt !== null && (
                    <div className="wal-faint">{new Date(r.reviewedAt).toLocaleString()}</div>
                  )}
                  {/* A rejection is only useful if the reason travels
                        with it — otherwise the seller resubmits the same
                        thing. */}
                  {r.reviewNote !== null && r.reviewNote !== '' && (
                    <div className="wal-faint">{r.reviewNote}</div>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <TopupWizard
        open={open}
        onDone={() => onOpenChange(false)}
        banks={banks}
        onSubmitted={() => {
          void requests.refetch();
        }}
      />
    </>
  );
}

/**
 * Opens the receipt the seller uploaded.
 *
 * The link is minted when they ask for it: it is a presigned Spaces URL
 * with a 15-minute life, so putting one on every row of every page load
 * hands out links nobody clicked and most of which expire unused.
 *
 * Opened via a click handler rather than an <a download>: the file lives
 * behind a signed URL that does not exist until this runs.
 */
function ProofLink({ topupId }: { readonly topupId: string }): ReactElement {
  const proof = useTopupProofUrl();
  return (
    <AsyncButton
      variant="ghost"
      size="sm"
      disabled={proof.isPending}
      labels={{ idle: 'View receipt', busy: 'Opening…', done: 'Opened' }}
      minBusyMs={300}
      settleMs={1200}
      // Opened inside the click, filled when the presigned URL lands: a
      // window.open in onSuccess runs after the await and the popup
      // blocker eats it. `run()` calls this synchronously in the click.
      onAction={() => openExternalWhenReady(async () => (await proof.mutateAsync(topupId)).url)}
    />
  );
}
