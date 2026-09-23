'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Banknote, Plus } from 'lucide-react';
import { Ident, Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { useToast } from '@skydrop/ui/app/toast';
import { useRemittancesList } from '@/lib/api-hooks';
import { useWithdrawalsList } from '@/lib/ops-hooks';
import { RemittanceFormModal } from './remittance-form-modal';
import { usePermission } from '@/lib/use-permission';
import { MkCard, MkSection } from '../../seller-wallets/_components/money-parts';

/**
 * Paginated list of recorded remittances. Each row links to the
 * seller detail page. The Record button opens the form modal.
 */
export function RemittancesIndex(): ReactElement {
  const [creating, setCreating] = useState(false);
  // The REQUEST being paid, not just its seller: recording the payment
  // and closing the request it settles is one act, and making an
  // operator copy a remittance id back to another screen is how a paid
  // seller stays "awaiting review" for a week.
  const [paying, setPaying] = useState<{
    sellerId: string;
    requestId: string;
    amountInr: string;
  } | null>(null);
  const canWrite = usePermission('money.remittances.manage');
  const toast = useToast();
  const list = useRemittancesList({ page: 1, pageSize: 50 });
  // Approved and unpaid: exactly the people owed money right now. It
  // belongs HERE rather than only on Withdrawals, because this is the
  // page somebody opens when they are about to make transfers — a
  // to-do list is worth little on a screen nobody visits to do the
  // work.
  // Paying one of these does TWO things — records the remittance and
  // closes the withdrawal — so it needs both permissions. Gated rather
  // than shown-and-refused: the page itself only asks for `money.view`,
  // so without this an operator saw a Pay button that 403s.
  const canCloseWithdrawals = usePermission('money.withdrawals.review');
  const canPayApproved = canWrite && canCloseWithdrawals;
  const owed = useWithdrawalsList(
    { status: 'APPROVED', page: 1, pageSize: 50 },
    { enabled: canPayApproved },
  );
  const owedItems = owed.data?.items ?? [];

  return (
    <div className="mk-page">
      <PageHeader
        title="Remittances"
        subtitle="Recorded withdrawals to sellers. Each entry debits the seller's wallet (and writes a paired FX credit for cross-currency)."
        action={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setCreating(true)}
            >
              Record remittance
            </Button>
          ) : null
        }
      />

      {canPayApproved && owedItems.length > 0 && (
        <MkSection>
          <SectionHeading title="Approved, waiting to be paid" />
          <MkCard flush>
            <Table caption="Approved, waiting to be paid">
              <THead>
                <Tr>
                  <Th>Seller</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">They receive</Th>
                  <Th align="right">Wallet balance</Th>
                  <Th>Waiting</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {owedItems.map((w) => (
                  <Tr key={w.id}>
                    <Td>
                      <Link href={`/sellers/${w.sellerId}`} className="mk-name">
                        {w.sellerName ?? <Ident value={`${w.sellerId.slice(0, 8)}…`} />}
                      </Link>
                    </Td>
                    <Td align="right">
                      <Money amount={w.amountRequested} currency={w.currency} />
                    </Td>
                    {/* What this is worth in the currency they are paid
                        in, at the rate frozen WHEN THEY ASKED. Not
                        today's: the FX table is editable, and a request
                        sitting here for two days would otherwise read as
                        a different amount each morning. A request with
                        no snapshot shows nothing rather than a figure
                        nobody quoted. */}
                    <Td align="right">
                      {w.amountInHomeCurrency === null || w.homeCurrency === null ? (
                        <span className="mk-faint">—</span>
                      ) : (
                        <span
                          title={`At the rate when requested: 1 ${w.currency} = ${w.fxRateSnapshot ?? '?'} ${w.homeCurrency}`}
                        >
                          <Money
                            amount={w.amountInHomeCurrency}
                            currency={w.homeCurrency}
                            convert={false}
                          />
                        </span>
                      )}
                    </Td>
                    {/* The balance this payment comes out of. Five
                        headers had only four cells, so this column had
                        no cell at all: the waiting time rendered under
                        "Wallet balance" and every value sat one column
                        left of its own name. */}
                    <Td align="right">
                      {w.sellerBalanceInr === null ? (
                        <span className="mk-faint">—</span>
                      ) : (
                        <Money amount={w.sellerBalanceInr} currency="INR" />
                      )}
                    </Td>
                    <Td
                      className="mk-text mk-small sk-figure"
                      data-tone={w.slaBreached ? 'critical' : undefined}
                    >
                      {w.waitingHours ?? 0}h
                    </Td>
                    <Td align="right">
                      {/* Prefills the seller; the amount stays typed,
                          because what leaves the bank is the operator's
                          fact and a remittance can legitimately differ
                          from the request. Linking it back to the
                          request is still done on Withdrawals. */}
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Banknote size={14} />}
                        onClick={() =>
                          setPaying({
                            sellerId: w.sellerId,
                            requestId: w.id,
                            amountInr: w.amountRequested,
                          })
                        }
                      >
                        Pay
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </MkCard>
        </MkSection>
      )}

      {list.isLoading ? (
        <SkeletonRows rows={5} cols={7} label="Loading remittances…" />
      ) : list.isError ? (
        <ErrorState message={list.error?.message ?? 'Failed.'} retry={() => void list.refetch()} />
      ) : !list.data || list.data.items.length === 0 ? (
        <EmptyState
          title="No remittances yet"
          description="Record one to debit a seller's wallet and reflect the bank transfer in their ledger."
          action={
            canWrite ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                Record remittance
              </Button>
            ) : null
          }
        />
      ) : (
        <MkCard flush>
          <Table caption="Recorded remittances">
            <THead>
              <Tr>
                <Th>Paid at</Th>
                <Th>Seller</Th>
                <Th align="right">Source</Th>
                <Th align="right">Destination</Th>
                <Th>Paid from</Th>
                <Th>Bank ref</Th>
                <Th align="right">FX</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.items.map((r) => (
                <Tr key={r.id}>
                  <Td className="mk-when sk-figure">{new Date(r.paidAt).toLocaleString()}</Td>
                  <Td>
                    <Link href={`/sellers/${r.sellerId}`} className="mk-name">
                      {r.sellerName ?? <Ident value={`${r.sellerId.slice(0, 8)}…`} />}
                    </Link>
                  </Td>
                  <Td align="right">
                    {/* The seller's wallet is debited by this leg — sign AND
                        colour say so, never colour alone. */}
                    <Money
                      amount={r.sourceAmount}
                      currency={r.sourceCurrency === 'BDT' ? 'BDT' : 'INR'}
                      direction="debit"
                    />
                  </Td>
                  <Td align="right">
                    <Money
                      amount={r.amount}
                      currency={r.currency === 'BDT' ? 'BDT' : 'INR'}
                      direction="credit"
                    />
                  </Td>
                  <Td>
                    {/* Without this a payout says money went out and not
                        where from, which is the one thing needed to
                        match it against a statement. */}
                    {r.paidFromLabel === null ? (
                      <span className="mk-faint">Not recorded</span>
                    ) : (
                      <div className="mk-cell mk-small">
                        <span className="mk-body">{r.paidFromLabel}</span>
                        {r.paidFromBank !== null && (
                          <span className="mk-faint">{r.paidFromBank}</span>
                        )}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="mk-cell">
                      <Ident value={r.bankReference} />
                      {r.recordedByName !== null && (
                        <span className="mk-faint">by {r.recordedByName}</span>
                      )}
                    </div>
                  </Td>
                  <Td align="right" className="mk-small sk-figure">
                    {r.sourceCurrency === r.currency ? '—' : Number(r.fxRateSnapshot).toFixed(4)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MkCard>
      )}

      {creating && (
        <RemittanceFormModal
          onClose={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            toast.success('Remittance recorded.');
          }}
        />
      )}

      {paying !== null && (
        <RemittanceFormModal
          initialSellerId={paying.sellerId}
          settling={{ requestId: paying.requestId, amountInr: paying.amountInr }}
          onClose={() => setPaying(null)}
          onSuccess={() => {
            setPaying(null);
            void owed.refetch();
            // The SERVER links it. Doing it here as well would be a
            // second caller of the same rule, and the two would drift —
            // it now happens however the remittance was created, not
            // only when it came from this button.
            toast.success('Paid. The request closes itself when the amounts match.');
          }}
        />
      )}
    </div>
  );
}
