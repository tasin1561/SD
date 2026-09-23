'use client';

import { useState, type ReactElement } from 'react';
import type { ResellerOrderMoneyView, ResellerPartyCreditView } from '@skydrop/api-client';
import { ApiError } from '@skydrop/api-client';
import { useSellerIdentity } from '@skydrop/auth/client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { Scale } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Facts, OrdSection } from '../../_components/orders-parts';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  walletDirectionLabel,
} from '@skydrop/ui/status';
import { useResellerOrderMoney } from '@/lib/api-hooks';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { DisputeFiguresModal } from './dispute-figures-modal';

/** The fee a split line is a share of, in words. */
export function feeLabel(fee: WalletEntryDirection | StoreWalletEntryDirection | string): string {
  switch (fee) {
    case 'ORDER_CHARGES':
      return 'Delivery fee';
    case 'RTO_FEE':
      return 'Return fee';
    case 'CUSTOMER_RETURN_FEE':
      return 'Customer return fee';
    default:
      return fee.toLowerCase().replace(/_/g, ' ');
  }
}

/** Why a credit was not written, in words a seller reads. */
export function skippedReasonWords(reason: string | null): string | null {
  if (reason === null) return null;
  if (reason === 'ORDER_LOST_IN_TRANSIT') return 'The parcel was lost in transit.';
  if (reason.startsWith('ORDER_')) return 'The order was called off.';
  switch (reason) {
    case 'RETURNED_UNDELIVERED':
      return 'It came back without being delivered.';
    case 'RETURNED':
      return 'The goods came back.';
    case 'NOT_DELIVERED':
      return 'Not delivered yet — a courier payout will release it.';
    case 'COURIER_HAS_NOT_PAID':
      return 'The courier has not paid for it yet.';
    case 'COURIER_REVERSED':
      return 'The courier took the COD back.';
    case 'PREPAID_NOT_PAID_BY_STORE':
      return 'The store has not paid for this prepaid order.';
    default:
      return reason;
  }
}

function when(p: ResellerPartyCreditView): string {
  const d = p.reversedAt ?? p.creditedAt ?? p.dueAt;
  if (d === null) return '—';
  const label = p.reversedAt !== null ? 'Taken back' : p.creditedAt !== null ? 'Credited' : 'Due';
  return `${label} ${new Date(d).toLocaleString()}`;
}

/**
 * RS-7 (2026-09-19) — "Raise with the store", beside the figures it is
 * about.
 *
 * Here rather than on the tickets page because this is where the numbers
 * somebody is disagreeing with are on screen, and because the order is
 * then not something they have to go and look up. Cosmetic gating only
 * (FE-2): `tickets.create` is what the server checks.
 */
function DisputeFiguresAction({ orderId }: { readonly orderId: string }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const identity = useSellerIdentity();
  if (!can(identity, 'tickets.create')) return null;
  return (
    <>
      <Button variant="ghost" size="sm" icon={<Scale size={14} />} onClick={() => setOpen(true)}>
        Raise with the store
      </Button>
      <DisputeFiguresModal open={open} onOpenChange={setOpen} orderId={orderId} />
    </>
  );
}

/**
 * RS-6 phase 3c — what one of your reseller stores' orders earns YOU:
 * the transfer price, your share of each fee, and when it lands. The
 * figures come from the API (the plan is decided there, never here).
 * Rendered only for a reseller order; hidden from a VIEWER, whom the
 * endpoint refuses (cosmetic — the server is the boundary).
 */
export function ResellerMoneyPanel({
  orderId,
  enabled,
}: {
  readonly orderId: string;
  readonly enabled: boolean;
}): ReactElement | null {
  const money = useResellerOrderMoney(orderId, enabled);
  if (!enabled) return null;
  if (money.isLoading) {
    return (
      <OrdSection title="Reseller store money">
        <SkeletonRows rows={3} cols={4} label="Loading the store money…" />
      </OrdSection>
    );
  }
  if (money.isError) {
    // A channel order has no reseller money — nothing to show, not an error.
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <OrdSection title="Reseller store money">
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      </OrdSection>
    );
  }
  const view: ResellerOrderMoneyView | undefined = money.data;
  if (view === undefined) return null;
  const mine = view.parties.find((p) => p.party === 'SELLER');
  return (
    <OrdSection
      title="Reseller store money"
      note="Your transfer price for the goods, your share of Skydrop's fees on this order, and when it reaches your wallet."
      action={<DisputeFiguresAction orderId={orderId} />}
    >
      <div className="ord-stack">
        {mine === undefined ? (
          <p className="ord-p">
            Nothing planned yet — the plan is made when the order is confirmed.
          </p>
        ) : (
          <Facts
            items={[
              {
                label: 'Status',
                value: (
                  <StatusChip
                    kind={resellerCreditStatusKind(mine.status)}
                    label={resellerCreditStatusLabel(mine.status)}
                    size="sm"
                  />
                ),
              },
              { label: 'When', value: mine.timing },
              { label: 'Date', value: when(mine) },
              ...(skippedReasonWords(mine.skippedReason) !== null
                ? [{ label: 'Why', value: skippedReasonWords(mine.skippedReason) }]
                : []),
              {
                label: 'Transfer price',
                value: <Money amount={mine.grossInr} direction="credit" convert={false} />,
              },
              {
                label: 'Your share of the COD tax',
                value: <Money amount={mine.taxShareInr} direction="debit" convert={false} />,
              },
              {
                label: 'Your share of the COD fee',
                value: <Money amount={mine.codFeeShareInr} direction="debit" convert={false} />,
              },
              {
                label: 'Your share of the Instant Pay fee',
                value: <Money amount={mine.instantFeeShareInr} direction="debit" convert={false} />,
              },
              {
                label: 'You receive',
                value: <Money amount={mine.netInr} convert={false} />,
                total: true,
              },
            ]}
          />
        )}

        {view.fees.length > 0 ? (
          <div className="ord-card" data-flush="1">
            <Table caption="Fees on this order">
              <THead>
                <Tr>
                  <Th>Fee billed</Th>
                  <Th align="right">Yours</Th>
                  <Th align="right">Paid by the store</Th>
                  <Th align="right">Total</Th>
                </Tr>
              </THead>
              <TBody>
                {view.fees.map((f) => (
                  <Tr key={f.fee}>
                    <Td>{feeLabel(f.fee)}</Td>
                    <Td align="right">
                      <Money amount={f.sellerInr} convert={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={f.storeInr} convert={false} />
                    </Td>
                    <Td align="right">
                      <Money amount={f.totalInr} convert={false} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}

        <div className="ord-card" data-flush="1">
          <Table caption="Your wallet on this order">
            <THead>
              <Tr>
                <Th>Your wallet on this order</Th>
                <Th>When</Th>
                <Th align="right">Amount</Th>
              </Tr>
            </THead>
            <TBody>
              {(view.sellerLines ?? []).length === 0 ? (
                <TableEmpty colSpan={3}>Nothing in your wallet from this order yet.</TableEmpty>
              ) : (
                (view.sellerLines ?? []).map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <div>{walletDirectionLabel(l.direction as WalletEntryDirection)}</div>
                      {l.note !== null ? <span className="ord-sub">{l.note}</span> : null}
                    </Td>
                    <Td>
                      <span className="sk-figure ord-muted">
                        {new Date(l.createdAt).toLocaleString()}
                      </span>
                    </Td>
                    <Td align="right">
                      <Money
                        amount={l.amountInr.replace(/^-/, '')}
                        direction={l.amountInr.startsWith('-') ? 'debit' : 'credit'}
                        convert={false}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </div>
        {view.sellerNetInr !== null ? (
          <p className="ord-p ord-row ord-row--end">
            Net to you so far: <Money amount={view.sellerNetInr} convert={false} />
          </p>
        ) : null}
      </div>
    </OrdSection>
  );
}
