'use client';

import type { ReactElement } from 'react';
import type {
  ResellerMoneyLineView,
  ResellerOrderMoneyView,
  ResellerPartyCreditView,
} from '@skydrop/api-client';
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
  storeWalletDirectionLabel,
  walletDirectionLabel,
} from '@skydrop/ui/status';
import { useResellerOrderMoney } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

function feeLabel(fee: string): string {
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

function signed(amount: string): ReactElement {
  return (
    <Money
      amount={amount.replace(/^-/, '')}
      direction={amount.startsWith('-') ? 'debit' : 'credit'}
      convert={false}
    />
  );
}

function when(p: ResellerPartyCreditView): string {
  if (p.reversedAt !== null) return `Taken back ${new Date(p.reversedAt).toLocaleString()}`;
  if (p.creditedAt !== null) return `Credited ${new Date(p.creditedAt).toLocaleString()}`;
  if (p.dueAt !== null) return `Due ${new Date(p.dueAt).toLocaleString()}`;
  return '—';
}

function Lines({
  title,
  lines,
  label,
}: {
  readonly title: string;
  readonly lines: readonly ResellerMoneyLineView[];
  readonly label: (l: ResellerMoneyLineView) => string;
}): ReactElement {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>{title}</Th>
          <Th>When</Th>
          <Th align="right">Amount</Th>
        </Tr>
      </THead>
      <TBody>
        {lines.length === 0 ? (
          <Tr>
            <Td className="text-text-muted" colSpan={3}>
              No lines yet.
            </Td>
          </Tr>
        ) : (
          lines.map((l) => (
            <Tr key={l.id}>
              <Td>
                <div className="text-text-body">{label(l)}</div>
                {l.note !== null ? <div className="text-text-faint text-xs">{l.note}</div> : null}
              </Td>
              <Td className="text-text-muted text-xs">{new Date(l.createdAt).toLocaleString()}</Td>
              <Td align="right">{signed(l.amountInr)}</Td>
            </Tr>
          ))
        )}
      </TBody>
    </Table>
  );
}

/**
 * RS-6 phase 3c — staff see the full split of a reseller order: each
 * party's credit (plan, status, when), every carriage fee split between
 * store and seller, and both wallets' lines on the order. Read-only.
 * Renders nothing for a channel order (the API answers 404 there).
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
      <Section title="Reseller order money">
        <SkeletonRows rows={4} cols={5} />
      </Section>
    );
  }
  if (money.isError) {
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <Section title="Reseller order money">
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      </Section>
    );
  }
  const v: ResellerOrderMoneyView | undefined = money.data;
  if (v === undefined) return null;
  return (
    <Section
      title="Reseller order money"
      subtitle="Each party's credit at its own trigger, every Skydrop fee split by the order's snapshot, and both wallets' lines. Skydrop's take is the same as an identical channel order's."
    >
      <Card>
        <CardBody>
          <dl className="grid grid-cols-[minmax(84px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[200px_1fr] sm:gap-x-6">
            <dt className="text-text-muted">Payment</dt>
            <dd className="text-text-body">{v.paymentMode}</dd>
            <dt className="text-text-muted">COD</dt>
            <dd>{v.codInr === null ? '—' : <Money amount={v.codInr} convert={false} />}</dd>
            <dt className="text-text-muted">Retail total</dt>
            <dd>
              <Money amount={v.retailTotalInr} convert={false} />
            </dd>
            <dt className="text-text-muted">Transfer total</dt>
            <dd>
              <Money amount={v.transferTotalInr} convert={false} />
            </dd>
            <dt className="text-text-muted">Terms version</dt>
            <dd className="text-text-body font-mono text-xs">{v.termsVersionId}</dd>
            <dt className="text-text-muted">Store pays</dt>
            <dd className="text-text-body text-xs">
              {Object.entries(v.storePercents)
                .map(([k, pct]) => `${k.replace(/StorePercent$/, '')} ${pct}%`)
                .join(' · ')}
            </dd>
          </dl>
        </CardBody>
      </Card>

      <div className="mt-3">
        <Table>
          <THead>
            <Tr>
              <Th>Party</Th>
              <Th>Status</Th>
              <Th>When</Th>
              <Th align="right">Gross</Th>
              <Th align="right">Transfer</Th>
              <Th align="right">Tax share</Th>
              <Th align="right">COD fee</Th>
              <Th align="right">Instant Pay</Th>
              <Th align="right">Net</Th>
            </Tr>
          </THead>
          <TBody>
            {v.parties.length === 0 ? (
              <Tr>
                <Td className="text-text-muted" colSpan={9}>
                  Not planned yet — the plan is made when the order is confirmed.
                </Td>
              </Tr>
            ) : (
              v.parties.map((p) => (
                <Tr key={p.party}>
                  <Td>
                    <div className="text-text-body">{p.party === 'STORE' ? 'Store' : 'Seller'}</div>
                    <div className="text-text-faint text-xs">{p.timing}</div>
                  </Td>
                  <Td>
                    <StatusBadge
                      kind={resellerCreditStatusKind(p.status)}
                      label={resellerCreditStatusLabel(p.status)}
                    />
                    {p.skippedReason !== null ? (
                      <div className="text-text-faint font-mono text-xs">{p.skippedReason}</div>
                    ) : null}
                  </Td>
                  <Td className="text-text-muted text-xs">{when(p)}</Td>
                  <Td align="right">
                    <Money amount={p.grossInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.transferInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.taxShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.codFeeShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.instantFeeShareInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={p.netInr} convert={false} />
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </div>

      {v.fees.length > 0 ? (
        <div className="mt-3">
          <Table>
            <THead>
              <Tr>
                <Th>Fee billed</Th>
                <Th align="right">Store</Th>
                <Th align="right">Seller</Th>
                <Th align="right">Total</Th>
              </Tr>
            </THead>
            <TBody>
              {v.fees.map((f) => (
                <Tr key={f.fee}>
                  <Td>{feeLabel(f.fee)}</Td>
                  <Td align="right">
                    <Money amount={f.storeInr} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={f.sellerInr} convert={false} />
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

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <Lines
            title="Store wallet"
            lines={v.storeLines ?? []}
            label={(l) => storeWalletDirectionLabel(l.direction as StoreWalletEntryDirection)}
          />
          {v.storeNetInr !== null ? (
            <p className="text-text-muted mt-2 text-right text-sm">
              Store net: <Money amount={v.storeNetInr} convert={false} />
            </p>
          ) : null}
        </div>
        <div>
          <Lines
            title="Seller wallet"
            lines={v.sellerLines ?? []}
            label={(l) => walletDirectionLabel(l.direction as WalletEntryDirection)}
          />
          {v.sellerNetInr !== null ? (
            <p className="text-text-muted mt-2 text-right text-sm">
              Seller net: <Money amount={v.sellerNetInr} convert={false} />
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
