'use client';

import type { ReactElement } from 'react';
import { Card, CardBody, TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/components';
import { useSellerIdentity } from '@skydrop/auth/client';
import { can } from '@/lib/page-access';
import { useTopupBankAccounts, useTopupProofUrl, useTopupRequests } from '@/lib/api-hooks';
import { TopupWizard } from './topup-wizard';

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

  return (
    <Card>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-text-muted py-2 text-sm">
            No top-ups yet. Send money to one of our accounts, then record it here — we credit it
            once it shows on our statement, so it is not instant.
          </p>
        ) : (
          <Table>
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
                  <Td className="text-text-muted text-xs">
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </Td>
                  <Td className="text-text-body">
                    {/* The account, not our filing name for it. A seller
                        checking this against their bank statement needs
                        the bank and the number they typed; "Tasin City"
                        is nothing they can compare. */}
                    <div>{r.bankName}</div>
                    <div className="text-text-faint font-mono text-xs">{r.bankAccountNumber}</div>
                    {r.bankBranchName !== null && (
                      <div className="text-text-faint text-xs">{r.bankBranchName}</div>
                    )}
                  </Td>
                  <Td align="right" className="font-mono">
                    {r.amount}
                  </Td>
                  <Td className="text-xs">
                    {r.transactionRef !== null && (
                      <div className="text-text-faint font-mono">{r.transactionRef}</div>
                    )}
                    {r.hasProof ? (
                      <ProofLink topupId={r.id} />
                    ) : (
                      r.transactionRef === null && <span className="text-text-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-text-body text-xs">{r.status}</span>
                    {/* A rejection is only useful if the reason travels
                        with it — otherwise the seller resubmits the same
                        thing. */}
                    {r.reviewNote !== null && r.reviewNote !== '' && (
                      <div className="text-text-faint mt-0.5 text-xs">{r.reviewNote}</div>
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
      </CardBody>
    </Card>
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
    <button
      type="button"
      className="text-accent min-h-[28px] underline"
      disabled={proof.isPending}
      onClick={() => {
        proof.mutate(topupId, {
          onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer'),
        });
      }}
    >
      {proof.isPending ? 'Opening…' : 'View receipt'}
    </button>
  );
}
