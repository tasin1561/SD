'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Ident,
  Money,
  PageHeader,
  Section,
  SkeletonRows,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { useRemittancesList } from '@/lib/api-hooks';
import { useWithdrawalsList } from '@/lib/ops-hooks';
import { RemittanceFormModal } from './remittance-form-modal';
import { usePermission } from '@/lib/use-permission';

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
    <div>
      <PageHeader
        title="Remittances"
        subtitle="Recorded withdrawals to sellers. Each entry debits the seller's wallet (and writes a paired FX credit for cross-currency)."
        action={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setCreating(true)}>
              Record remittance
            </Button>
          ) : null
        }
      />

      {canPayApproved && owedItems.length > 0 && (
        <Section title="Approved, waiting to be paid">
          <Card>
            <Table>
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
                      <Link href={`/sellers/${w.sellerId}`} className="text-accent hover:underline">
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
                        <span className="text-text-faint text-xs">—</span>
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
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <Money amount={w.sellerBalanceInr} currency="INR" />
                      )}
                    </Td>
                    <Td
                      className={
                        w.slaBreached
                          ? 'text-[var(--color-critical)] text-xs'
                          : 'text-text-muted text-xs'
                      }
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
          </Card>
        </Section>
      )}

      {list.isLoading ? (
        <Card>
          <SkeletonRows rows={5} cols={6} />
        </Card>
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
        <Card>
          <Table wrapperClassName="rounded-none border-0 bg-transparent">
            <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Paid at</th>
                <th className="text-left px-3 py-2 font-medium">Seller</th>
                <th className="text-right px-3 py-2 font-medium">Source</th>
                <th className="text-right px-3 py-2 font-medium">Destination</th>
                <th className="text-left px-3 py-2 font-medium">Bank ref</th>
                <th className="text-right px-3 py-2 font-medium">FX</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-text-body font-mono text-xs">
                    {new Date(r.paidAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-text-body">
                    <Link href={`/sellers/${r.sellerId}`} className="text-accent hover:underline">
                      {r.sellerName ?? <Ident value={`${r.sellerId.slice(0, 8)}…`} />}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* The seller's wallet is debited by this leg — sign AND
                        colour say so, never colour alone. */}
                    <Money
                      amount={r.sourceAmount}
                      currency={r.sourceCurrency === 'BDT' ? 'BDT' : 'INR'}
                      direction="debit"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Money
                      amount={r.amount}
                      currency={r.currency === 'BDT' ? 'BDT' : 'INR'}
                      direction="credit"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Ident value={r.bankReference} />
                  </td>
                  <td className="px-3 py-2 text-right text-text-muted skydrop-tabular text-xs">
                    {r.sourceCurrency === r.currency ? '—' : Number(r.fxRateSnapshot).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
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
