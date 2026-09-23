'use client';

import type { ReactElement } from 'react';
import type {
  ResellerMoneyLineView,
  ResellerOrderMoneyView,
  ResellerPartyCreditView,
} from '@skydrop/api-client';
import { ApiError } from '@skydrop/api-client';
import type { StoreWalletEntryDirection, WalletEntryDirection } from '@skydrop/db';
import { Money } from '@skydrop/ui/components';
import { Table, TableEmpty, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Facts, OoCard, OoSection } from './order-ops-parts';
import './order-core.css';
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
    <OoCard flush>
      <Table caption={title}>
        <THead>
          <Tr>
            <Th>{title}</Th>
            <Th>When</Th>
            <Th align="right">Amount</Th>
          </Tr>
        </THead>
        <TBody>
          {lines.length === 0 ? (
            <TableEmpty colSpan={3}>No lines yet.</TableEmpty>
          ) : (
            lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <span className="oo-body">{label(l)}</span>
                  {l.note !== null ? <span className="oo-sub">{l.note}</span> : null}
                </Td>
                <Td className="oo-muted">
                  <span className="sk-figure">{new Date(l.createdAt).toLocaleString()}</span>
                </Td>
                <Td align="right">{signed(l.amountInr)}</Td>
              </Tr>
            ))
          )}
        </TBody>
      </Table>
    </OoCard>
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
      <OoSection title="Reseller order money">
        <SkeletonRows rows={4} cols={5} label="Loading the reseller split…" />
      </OoSection>
    );
  }
  if (money.isError) {
    if (money.error instanceof ApiError && money.error.status === 404) return null;
    return (
      <OoSection title="Reseller order money">
        <ErrorState message={serverVerdict(money.error)} retry={() => void money.refetch()} />
      </OoSection>
    );
  }
  const v: ResellerOrderMoneyView | undefined = money.data;
  if (v === undefined) return null;
  return (
    <section className="oo-section">
      <OoSection
        title="Reseller order money"
        note="Each party's credit at its own trigger, every Skydrop fee split by the order's snapshot, and both wallets' lines. Skydrop's take is the same as an identical channel order's."
      >
        <Facts
          items={[
            { label: 'Payment', value: v.paymentMode },
            {
              label: 'COD',
              value: v.codInr === null ? '—' : <Money amount={v.codInr} convert={false} />,
            },
            { label: 'Retail total', value: <Money amount={v.retailTotalInr} convert={false} /> },
            {
              label: 'Transfer total',
              value: <Money amount={v.transferTotalInr} convert={false} />,
            },
            { label: 'Terms version', value: <span className="sk-ident">{v.termsVersionId}</span> },
            {
              label: 'Store pays',
              value: (
                <span className="oo-muted">
                  {Object.entries(v.storePercents)
                    .map(([k, pct]) => `${k.replace(/StorePercent$/, '')} ${pct}%`)
                    .join(' · ')}
                </span>
              ),
            },
          ]}
        />
      </OoSection>

      <OoCard flush>
        <Table caption="Credits by party">
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
              <TableEmpty colSpan={9}>
                Not planned yet — the plan is made when the order is confirmed.
              </TableEmpty>
            ) : (
              v.parties.map((p) => (
                <Tr key={p.party}>
                  <Td>
                    <span className="oo-body">{p.party === 'STORE' ? 'Store' : 'Seller'}</span>
                    <span className="oo-sub">{p.timing}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={resellerCreditStatusKind(p.status)}
                      label={resellerCreditStatusLabel(p.status)}
                      size="sm"
                    />
                    {p.skippedReason !== null ? (
                      <span className="oo-sub sk-ident">{p.skippedReason}</span>
                    ) : null}
                  </Td>
                  <Td className="oo-muted">{when(p)}</Td>
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
      </OoCard>

      {v.fees.length > 0 ? (
        <OoCard flush>
          <Table caption="Fees billed">
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
        </OoCard>
      ) : null}

      <div className="oo-split">
        <div className="oo-stack oo-stack--tight">
          <Lines
            title="Store wallet"
            lines={v.storeLines ?? []}
            label={(l) => storeWalletDirectionLabel(l.direction as StoreWalletEntryDirection)}
          />
          {v.storeNetInr !== null ? (
            <p className="oo-muted oo-row oo-row--end">
              Store net: <Money amount={v.storeNetInr} convert={false} />
            </p>
          ) : null}
        </div>
        <div className="oo-stack oo-stack--tight">
          <Lines
            title="Seller wallet"
            lines={v.sellerLines ?? []}
            label={(l) => walletDirectionLabel(l.direction as WalletEntryDirection)}
          />
          {v.sellerNetInr !== null ? (
            <p className="oo-muted oo-row oo-row--end">
              Seller net: <Money amount={v.sellerNetInr} convert={false} />
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
