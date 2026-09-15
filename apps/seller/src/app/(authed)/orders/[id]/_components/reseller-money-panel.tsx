'use client';

import type { ReactElement } from 'react';
import type { ResellerOrderMoneyView, ResellerPartyCreditView } from '@skydrop/api-client';
import { ApiError } from '@skydrop/api-client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import {
  Card,
  CardBody,
  ErrorState,
  Money,
  Section,
  SkeletonRows,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import {
  resellerCreditStatusKind,
  resellerCreditStatusLabel,
  walletDirectionLabel,
} from '@skydrop/ui/status';
import { useResellerOrderMoney } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
      <Section title="Reseller store money">
        <SkeletonRows rows={3} cols={4} />
      </Section>
    );
  }
  if (money.isError) {
    // A channel order has no reseller money — nothing to show, not an error.
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <Section title="Reseller store money">
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      </Section>
    );
  }
  const view: ResellerOrderMoneyView | undefined = money.data;
  if (view === undefined) return null;
  const mine = view.parties.find((p) => p.party === 'SELLER');
  return (
    <Section
      title="Reseller store money"
      subtitle="Your transfer price for the goods, your share of Skydrop's fees on this order, and when it reaches your wallet."
    >
      <Card>
        <CardBody>
          {mine === undefined ? (
            <p className="text-text-muted text-sm">
              Nothing planned yet — the plan is made when the order is confirmed.
            </p>
          ) : (
            <dl className="grid grid-cols-[minmax(84px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[200px_1fr] sm:gap-x-6">
              <dt className="text-text-muted">Status</dt>
              <dd>
                <StatusBadge
                  kind={resellerCreditStatusKind(mine.status)}
                  label={resellerCreditStatusLabel(mine.status)}
                />
              </dd>
              <dt className="text-text-muted">When</dt>
              <dd className="text-text-body">{mine.timing}</dd>
              <dt className="text-text-muted">Date</dt>
              <dd className="text-text-body">{when(mine)}</dd>
              {skippedReasonWords(mine.skippedReason) !== null ? (
                <>
                  <dt className="text-text-muted">Why</dt>
                  <dd className="text-text-body">{skippedReasonWords(mine.skippedReason)}</dd>
                </>
              ) : null}
              <dt className="text-text-muted">Transfer price</dt>
              <dd>
                <Money amount={mine.grossInr} direction="credit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the COD tax</dt>
              <dd>
                <Money amount={mine.taxShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the COD fee</dt>
              <dd>
                <Money amount={mine.codFeeShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted">Your share of the Instant Pay fee</dt>
              <dd>
                <Money amount={mine.instantFeeShareInr} direction="debit" convert={false} />
              </dd>
              <dt className="text-text-muted font-medium">You receive</dt>
              <dd className="font-medium">
                <Money amount={mine.netInr} convert={false} />
              </dd>
            </dl>
          )}
        </CardBody>
      </Card>

      {view.fees.length > 0 ? (
        <div className="mt-3">
          <Table>
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

      <div className="mt-3">
        <Table>
          <THead>
            <Tr>
              <Th>Your wallet on this order</Th>
              <Th>When</Th>
              <Th align="right">Amount</Th>
            </Tr>
          </THead>
          <TBody>
            {(view.sellerLines ?? []).length === 0 ? (
              <Tr>
                <Td className="text-text-muted" colSpan={3}>
                  Nothing in your wallet from this order yet.
                </Td>
              </Tr>
            ) : (
              (view.sellerLines ?? []).map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <div className="text-text-body">
                      {walletDirectionLabel(l.direction as WalletEntryDirection)}
                    </div>
                    {l.note !== null ? (
                      <div className="text-text-faint text-xs">{l.note}</div>
                    ) : null}
                  </Td>
                  <Td className="text-text-muted text-xs">
                    {new Date(l.createdAt).toLocaleString()}
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
        {view.sellerNetInr !== null ? (
          <p className="text-text-muted mt-2 text-right text-sm">
            Net to you so far: <Money amount={view.sellerNetInr} convert={false} />
          </p>
        ) : null}
      </div>
    </Section>
  );
}
