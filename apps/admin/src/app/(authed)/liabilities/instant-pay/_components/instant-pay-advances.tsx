'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Store } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import {
  SortableTh,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
  type SortDirection,
} from '@skydrop/ui/app/data-table';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { Select } from '@skydrop/ui/app/select';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useInstantPayAdvances, type InstantPayAdvanceRowView } from '@/lib/ops-hooks';
import { AgeChip, LinkButton } from '../../../treasury/_components/money-parts';
import '../../_components/liabilities.css';

/**
 * Money we advanced to sellers under Instant Pay, still owed to us by
 * the courier.
 *
 * Instant Pay credits the seller at delivery and fronts the cash from our
 * own money; the courier's payout later repays us. Until then each row is
 * our cash sitting with a courier, so the page leads with the oldest —
 * the one they have held longest is the one to chase.
 *
 * "Fronted" can be less than the credit: when part of a COD repaid a debt
 * the seller already owed, that part cleared a receivable and needed no
 * cash. The courier still owes the whole COD.
 */
export function InstantPayAdvances({
  initialSellerId,
  initialCourierAccountId,
}: {
  readonly initialSellerId: string;
  readonly initialCourierAccountId: string;
}): ReactElement {
  const [sellerId, setSellerId] = useState(initialSellerId);
  const [courierAccountId, setCourierAccountId] = useState(initialCourierAccountId);
  const [sortKey, setSortKey] = useState<string | null>('age');
  const [dir, setDir] = useState<SortDirection>('desc');

  const filter = {
    ...(sellerId === '' ? {} : { sellerId }),
    ...(courierAccountId === '' ? {} : { courierAccountId }),
  };
  const q = useInstantPayAdvances(filter);
  // The unfiltered set supplies the filter options, so choosing a seller
  // does not empty the other dropdown. Same query when nothing is chosen.
  const all = useInstantPayAdvances({});

  const rows = useMemo(() => sortRows(q.data?.rows ?? [], sortKey, dir), [q.data, sortKey, dir]);

  const onSort = (key: string): void => {
    if (key === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setDir('desc');
    }
  };
  const filtered = sellerId !== '' || courierAccountId !== '';

  return (
    <div className="mo-page">
      <PageHeader
        title="Instant Pay advances"
        subtitle="Paid to sellers at delivery out of our money, not yet paid to us by the courier."
        action={
          <LinkButton href="/liabilities" variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
            What we owe
          </LinkButton>
        }
      />

      {q.isLoading ? (
        <SkeletonRows rows={6} cols={8} label="Reading the ledgers…" />
      ) : q.isError || q.data === undefined ? (
        <ErrorState
          message={q.error?.message ?? 'Could not read the advances.'}
          retry={() => void q.refetch()}
        />
      ) : (
        <>
          <div className="mo-kpis">
            <KpiCard
              label="COD awaiting the courier"
              tone="pending"
              figure={<Money amount={q.data.totalCodInr} currency="INR" convert={false} />}
              hint={`${q.data.count} ${q.data.count === 1 ? 'order' : 'orders'}`}
            />
            <KpiCard
              label="Cash we fronted"
              figure={<Money amount={q.data.totalFrontedInr} currency="INR" convert={false} />}
              hint="Out of capital — less than the COD where it cleared a seller's debt"
            />
            <KpiCard
              label="Credited to sellers"
              figure={<Money amount={q.data.totalNetCreditedInr} currency="INR" convert={false} />}
              hint="COD less tax and fees"
            />
          </div>

          <div className="mo-stack">
            <FilterBar
              activeCount={(sellerId === '' ? 0 : 1) + (courierAccountId === '' ? 0 : 1)}
              onReset={() => {
                setSellerId('');
                setCourierAccountId('');
              }}
            >
              <FilterField icon={<Store size={16} />}>
                <Select
                  label="Seller"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                >
                  <option value="">All sellers</option>
                  {(all.data?.bySeller ?? []).map((g) => (
                    <option key={g.key ?? ''} value={g.key ?? ''}>
                      {g.label} ({g.count})
                    </option>
                  ))}
                </Select>
              </FilterField>
              <FilterField icon={<Building2 size={16} />}>
                <Select
                  label="Courier account"
                  value={courierAccountId}
                  onChange={(e) => setCourierAccountId(e.target.value)}
                >
                  <option value="">All courier accounts</option>
                  {(all.data?.byCourierAccount ?? [])
                    .filter((g) => g.key !== null)
                    .map((g) => (
                      <option key={g.key ?? ''} value={g.key ?? ''}>
                        {g.label} ({g.count})
                      </option>
                    ))}
                </Select>
              </FilterField>
            </FilterBar>
            <Table caption="Instant Pay advances awaiting the courier">
              <THead>
                <Tr>
                  <Th>Order</Th>
                  <Th>Seller</Th>
                  <Th>Owed by</Th>
                  <SortableTh
                    label="Age"
                    columnKey="age"
                    activeKey={sortKey}
                    direction={dir}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableTh
                    label="COD"
                    columnKey="cod"
                    activeKey={sortKey}
                    direction={dir}
                    onSort={onSort}
                    align="right"
                  />
                  <Th align="right">Credited</Th>
                  <SortableTh
                    label="Fronted"
                    columnKey="fronted"
                    activeKey={sortKey}
                    direction={dir}
                    onSort={onSort}
                    align="right"
                  />
                  <Th>Fronted from</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={8}>
                    {filtered ? (
                      <>
                        Nothing outstanding for this filter.{' '}
                        <button
                          type="button"
                          className="mo-link li-inline-btn"
                          onClick={() => {
                            setSellerId('');
                            setCourierAccountId('');
                          }}
                        >
                          Show all
                        </button>
                      </>
                    ) : (
                      <>
                        Every Instant Pay credit has been paid by its courier.{' '}
                        <Link href="/settlements" className="mo-link">
                          See courier payouts
                        </Link>
                      </>
                    )}
                  </TableEmpty>
                ) : (
                  rows.map((r) => (
                    <Tr key={r.orderId}>
                      <Td>
                        <Link href={`/orders/${r.orderId}`} className="mo-link sk-ident">
                          {r.orderNumber}
                        </Link>
                        <span className="mo-sub">
                          delivered{' '}
                          {new Date(r.deliveredAt ?? r.creditedAt).toLocaleDateString('en-IN')}
                        </span>
                      </Td>
                      <Td>
                        <Link href={`/seller-wallets/${r.sellerId}`} className="mo-link">
                          {r.sellerName}
                        </Link>
                      </Td>
                      <Td>
                        <span className="mo-muted">
                          {r.courierAccountLabel ?? r.courierCode ?? '—'}
                        </span>
                        {r.courierAccountLabel !== null && r.courierCode !== null && (
                          <span className="mo-sub">{r.courierCode}</span>
                        )}
                      </Td>
                      <Td align="right">
                        <AgeChip>
                          {r.ageDays} {r.ageDays === 1 ? 'day' : 'days'}
                        </AgeChip>
                      </Td>
                      <Td align="right">
                        <Money amount={r.codInr} currency="INR" convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={r.netCreditedInr} currency="INR" convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={r.frontedInr} currency="INR" convert={false} />
                      </Td>
                      <Td>
                        <span className="mo-muted">{r.frontAccountLabel ?? '—'}</span>
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function sortRows(
  rows: readonly InstantPayAdvanceRowView[],
  key: string | null,
  dir: SortDirection,
): InstantPayAdvanceRowView[] {
  const value = (r: InstantPayAdvanceRowView): number =>
    key === 'cod' ? Number(r.codInr) : key === 'fronted' ? Number(r.frontedInr) : r.ageDays;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (value(a) - value(b)));
}
