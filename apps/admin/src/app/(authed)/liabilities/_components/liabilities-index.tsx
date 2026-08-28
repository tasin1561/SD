'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  Card,
  CardBody,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useLiabilities, type LedgerLineView } from '@/lib/ops-hooks';

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
          lines.map((l) => (
            <Tr key={l.key}>
              <Td>
                <div className="font-medium">{l.label}</div>
                <div className="text-text-muted mt-0.5 text-xs">{l.meaning}</div>
              </Td>
              <Td align="right">
                <Money amount={l.amountInr} currency="INR" convert={false} />
              </Td>
              <Td align="right" className="tabular-nums">
                {l.count}
              </Td>
            </Tr>
          ))
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
    default:
      return direction.replaceAll('_', ' ').toLowerCase();
  }
}

export function LiabilitiesIndex(): ReactElement {
  const q = useLiabilities();

  if (q.isLoading) return <LoadingState />;
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
    <div className="space-y-4">
      <PageHeader
        title="What we owe"
        subtitle="Our position right now — against what is owed to us, and what stands behind it."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="We owe"
          tone="warn"
          value={<Money amount={d.owedTotalInr} currency="INR" convert={false} />}
          hint="Sellers and the tax authority"
        />
        <Stat
          label="Owed to us"
          value={<Money amount={d.dueTotalInr} currency="INR" convert={false} />}
          hint="Couriers, sellers, freight not yet recovered"
        />
        <Stat
          label="Net position"
          tone={Number(d.netInr) >= 0 ? 'good' : 'bad'}
          value={<Money amount={d.netInr} currency="INR" convert={false} />}
          hint="A number to read alongside the lines, not instead of them"
        />
      </div>

      <Card>
        <CardBody>
          <p className="text-text-muted text-sm">
            The two sides do not cancel. What we owe is largely callable on request; what is owed to
            us arrives on somebody else&apos;s cycle. A healthy net can still be a month that cannot
            pay.
          </p>
        </CardBody>
      </Card>

      <Section title="We owe">
        <LineTable lines={d.owed} emptyText="Nothing owed." />
      </Section>

      <Section title="Owed to us">
        <LineTable lines={d.due} emptyText="Nothing outstanding." />
      </Section>

      <Section title="Sellers in the red">
        {d.sellerDebts.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex gap-2 text-sm">
                <ShieldCheck className="text-success mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>No seller is carrying a negative balance.</p>
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
            {uncovered.length > 0 && (
              <Card>
                <CardBody>
                  <div className="text-warning flex gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <p>
                      {uncovered.length === 1
                        ? 'One seller owes more than their stock is worth'
                        : `${uncovered.length} sellers owe more than their stock is worth`}
                      . A debt covered by goods in our building clears as they sell; an uncovered
                      one is money we may not see again.
                    </p>
                  </div>
                </CardBody>
              </Card>
            )}
            <Table>
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
                      <Link
                        href={`/seller-wallets/${s.sellerId}`}
                        className="text-accent hover:underline"
                      >
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
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {s.causes.map((c) => (
                            <li key={c.direction} className="text-xs">
                              <span className="text-text-muted">{humanCause(c.direction)}</span>{' '}
                              <Money amount={c.amountInr} currency="INR" convert={false} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={s.stockValueInr} currency="INR" convert={false} />
                    </Td>
                    <Td>
                      <StatusBadge
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
      </Section>
    </div>
  );
}
