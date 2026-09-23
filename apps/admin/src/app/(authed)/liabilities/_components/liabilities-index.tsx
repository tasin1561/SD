'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { TBody, THead, Table, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useLiabilities, type LedgerLineView } from '@/lib/ops-hooks';
import { MoSection, Notice } from '../../treasury/_components/money-parts';
import './liabilities.css';

/**
 * What we owe, and what is owed to us.
 *
 * Deliberately separate from the P&L: profit is about a WINDOW, this is
 * about a MOMENT. A business can be profitable and unable to pay on
 * Friday, and only one of the two reports would tell you.
 *
 * Nothing is collapsed to a single figure. A net of zero made of money
 * sellers can ask for next week against money a courier will settle next
 * month is not a business in balance, so every line says what it is and
 * what happens if it is ignored.
 */
function LineTable({
  lines,
  emptyText,
}: {
  readonly lines: readonly LedgerLineView[];
  readonly emptyText: string;
}): ReactElement {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>What</Th>
          <Th align="right">Amount</Th>
          <Th align="right">Items</Th>
        </Tr>
      </THead>
      <TBody>
        {lines.length === 0 ? (
          <TableEmpty colSpan={3}>{emptyText}</TableEmpty>
        ) : (
          lines.flatMap((l) => [
            <Tr key={l.key}>
              <Td>
                <span className="li-label">{l.label}</span>
                <span className="mo-sub">{l.meaning}</span>
              </Td>
              <Td align="right">
                <Money amount={l.amountInr} currency="INR" convert={false} />
              </Td>
              <Td align="right" className="mo-num">
                {l.count}
              </Td>
            </Tr>,
            // The halves of a line that need different responses. They add
            // up to the line above and are already inside its total.
            ...(l.parts ?? []).map((p) => (
              <Tr key={p.key} className="li-part-row">
                <Td>
                  <span className="li-part">
                    {p.key === 'courier_float_instant_pay' ? (
                      <Link href="/liabilities/instant-pay" className="mo-link">
                        {p.label} <ArrowRight size={13} aria-hidden />
                      </Link>
                    ) : (
                      p.label
                    )}
                    <span className="mo-sub">{p.meaning}</span>
                  </span>
                </Td>
                <Td align="right">
                  <Money amount={p.amountInr} currency="INR" convert={false} />
                </Td>
                <Td align="right" className="mo-num">
                  {p.count}
                </Td>
              </Tr>
            )),
          ])
        )}
      </TBody>
    </Table>
  );
}

/**
 * The ledger's own vocabulary, in words.
 *
 * Not an exhaustive mapper: this list is the debt-causing directions
 * only, and an unrecognised one falls back to its own name rather than
 * being hidden — a cause we cannot label is still a cause, and dropping
 * it would make the parts stop adding up to the total beside them.
 */
function humanCause(direction: string): string {
  switch (direction) {
    case 'ORDER_CHARGES':
      return 'Delivery fees';
    case 'RTO_FEE':
      return 'Return fees';
    case 'INBOUND_FREIGHT':
      return 'Inbound freight';
    case 'INSTANT_PAY_FEE':
      return 'Instant-pay fees';
    case 'COD_COLLECTION_FEE':
      return 'COD collection';
    case 'ADJUSTMENT_DEBIT':
      return 'Manual adjustment';
    case 'STAFF_DEBIT':
      return 'Debited by Skydrop';
    default:
      return direction.replaceAll('_', ' ').toLowerCase();
  }
}

export function LiabilitiesIndex(): ReactElement {
  const q = useLiabilities();

  if (q.isLoading) {
    return (
      <div className="mo-page">
        <div className="mo-kpis">
          <Skeleton height={112} rounded="md" />
          <Skeleton height={112} rounded="md" />
          <Skeleton height={112} rounded="md" />
        </div>
        <SkeletonRows rows={6} cols={3} />
      </div>
    );
  }
  if (q.isError || q.data === undefined) {
    return (
      <ErrorState
        message={q.error?.message ?? 'Could not read the position.'}
        retry={() => void q.refetch()}
      />
    );
  }

  const d = q.data;
  const uncovered = d.sellerDebts.filter((s) => !s.covered);

  return (
    <div className="mo-page">
      <PageHeader
        title="What we owe"
        subtitle="Our position right now — against what is owed to us, and what stands behind it."
      />

      <div className="mo-kpis">
        <KpiCard
          label="We owe"
          tone="pending"
          figure={<Money amount={d.owedTotalInr} currency="INR" convert={false} />}
          hint="Sellers and the tax authority"
        />
        <KpiCard
          label="Owed to us"
          figure={<Money amount={d.dueTotalInr} currency="INR" convert={false} />}
          hint="Couriers, sellers, freight not yet recovered"
        />
        <KpiCard
          label="Net position"
          tone={Number(d.netInr) >= 0 ? 'credit' : 'debit'}
          figure={<Money amount={d.netInr} currency="INR" convert={false} />}
          hint="A number to read alongside the lines, not instead of them"
        />
      </div>

      <Notice tone="info">
        <p>
          The two sides do not cancel. What we owe is largely callable on request; what is owed to
          us arrives on somebody else&apos;s cycle. A healthy net can still be a month that cannot
          pay.
        </p>
      </Notice>

      <MoSection title="We owe" flush>
        <LineTable lines={d.owed} emptyText="Nothing owed." />
      </MoSection>

      <MoSection title="Owed to us" flush>
        <LineTable lines={d.due} emptyText="Nothing outstanding." />
      </MoSection>

      <section className="mo-section">
        <SectionHeading title="Sellers in the red" />
        {d.sellerDebts.length === 0 ? (
          <Notice tone="good" icon={<ShieldCheck size={16} />}>
            <p>No seller is carrying a negative balance.</p>
          </Notice>
        ) : (
          <>
            {uncovered.length > 0 && (
              <Notice tone="warn" icon={<AlertTriangle size={16} />}>
                <p>
                  {uncovered.length === 1
                    ? 'One seller owes more than their stock is worth'
                    : `${uncovered.length} sellers owe more than their stock is worth`}
                  . A debt covered by goods in our building clears as they sell; an uncovered one is
                  money we may not see again.
                </p>
              </Notice>
            )}
            <Table caption="Sellers in the red">
              <THead>
                <Tr>
                  <Th>Seller</Th>
                  <Th align="right">Owes</Th>
                  <Th>What for</Th>
                  <Th align="right">Stock held (at cost)</Th>
                  <Th>Cover</Th>
                </Tr>
              </THead>
              <TBody>
                {d.sellerDebts.map((s) => (
                  <Tr key={s.sellerId}>
                    <Td>
                      <Link href={`/seller-wallets/${s.sellerId}`} className="mo-link">
                        {s.companyName}
                      </Link>
                    </Td>
                    <Td align="right">
                      <Money amount={s.owedInr} currency="INR" convert={false} direction="debit" />
                    </Td>
                    <Td>
                      {/* A total says they owe ₹9,000; this says it is
                          freight on stock that has not sold, which
                          clears itself, or delivery fees on delivered
                          orders, which do not. */}
                      {s.causes.length === 0 ? (
                        <span className="mo-faint">—</span>
                      ) : (
                        <ul className="li-causes">
                          {s.causes.map((c) => (
                            <li key={c.direction}>
                              <span className="mo-muted">{humanCause(c.direction)}</span>{' '}
                              <Money amount={c.amountInr} currency="INR" convert={false} />
                            </li>
                          ))}
                          {/* Without this the charges can add up to more
                              than the balance and read as an error. They
                              are not netted off any one cause — a top-up
                              does not pay the freight rather than the
                              fees — but the reader has to see that money
                              came in. */}
                          {(Number(s.paidSinceInr) > 0 || Number(s.openingBalanceInr) > 0) && (
                            <li className="li-causes__paid">
                              {Number(s.openingBalanceInr) > 0 && (
                                <div>
                                  started with{' '}
                                  <Money
                                    amount={s.openingBalanceInr}
                                    currency="INR"
                                    convert={false}
                                  />
                                </div>
                              )}
                              {Number(s.paidSinceInr) > 0 && (
                                <div>
                                  paid since{' '}
                                  <Money amount={s.paidSinceInr} currency="INR" convert={false} />
                                </div>
                              )}
                            </li>
                          )}
                        </ul>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={s.stockValueInr} currency="INR" convert={false} />
                    </Td>
                    <Td>
                      <StatusChip
                        kind={s.covered ? 'confirmed' : 'failed'}
                        label={s.covered ? 'Covered by stock' : 'Uncovered'}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
