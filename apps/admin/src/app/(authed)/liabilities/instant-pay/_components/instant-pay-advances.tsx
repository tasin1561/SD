'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  Select,
  SortableTh,
  Stat,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Toolbar,
  Tr,
  type SortDirection,
} from '@skydrop/ui/components';
import { useInstantPayAdvances, type InstantPayAdvanceRowView } from '@/lib/ops-hooks';

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
    <div className="space-y-4">
      <PageHeader
        title="Instant Pay advances"
        subtitle="Paid to sellers at delivery out of our money, not yet paid to us by the courier."
        action={
          <Link href="/liabilities" className="text-accent text-sm hover:underline">
            ← What we owe
          </Link>
        }
      />

      {q.isLoading ? (
        <LoadingState label="Reading the ledgers…" />
      ) : q.isError || q.data === undefined ? (
        <ErrorState
          message={q.error?.message ?? 'Could not read the advances.'}
          retry={() => void q.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="COD awaiting the courier"
              tone="warn"
              value={<Money amount={q.data.totalCodInr} currency="INR" convert={false} />}
              hint={`${q.data.count} ${q.data.count === 1 ? 'order' : 'orders'}`}
            />
            <Stat
              label="Cash we fronted"
              value={<Money amount={q.data.totalFrontedInr} currency="INR" convert={false} />}
              hint="Out of capital — less than the COD where it cleared a seller's debt"
            />
            <Stat
              label="Credited to sellers"
              value={<Money amount={q.data.totalNetCreditedInr} currency="INR" convert={false} />}
              hint="COD less tax and fees"
            />
          </div>

          <div>
            <Toolbar>
              <Select
                aria-label="Seller"
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
                className="sm:w-60"
              >
                <option value="">All sellers</option>
                {(all.data?.bySeller ?? []).map((g) => (
                  <option key={g.key ?? ''} value={g.key ?? ''}>
                    {g.label} ({g.count})
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Courier account"
                value={courierAccountId}
                onChange={(e) => setCourierAccountId(e.target.value)}
                className="sm:w-60"
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
            </Toolbar>
            <Table>
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
                          className="text-accent hover:underline"
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
                        <Link href="/settlements" className="text-accent hover:underline">
                          See courier payouts
                        </Link>
                      </>
                    )}
                  </TableEmpty>
                ) : (
                  rows.map((r) => (
                    <Tr key={r.orderId}>
                      <Td>
                        <Link
                          href={`/orders/${r.orderId}`}
                          className="text-accent font-mono hover:underline"
                        >
                          {r.orderNumber}
                        </Link>
                        <div className="text-text-faint text-xs">
                          delivered{' '}
                          {new Date(r.deliveredAt ?? r.creditedAt).toLocaleDateString('en-IN')}
                        </div>
                      </Td>
                      <Td>
                        <Link
                          href={`/seller-wallets/${r.sellerId}`}
                          className="text-accent hover:underline"
                        >
                          {r.sellerName}
                        </Link>
                      </Td>
                      <Td className="text-xs">
                        {r.courierAccountLabel ?? r.courierCode ?? '—'}
                        {r.courierAccountLabel !== null && r.courierCode !== null && (
                          <div className="text-text-faint">{r.courierCode}</div>
                        )}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {r.ageDays} {r.ageDays === 1 ? 'day' : 'days'}
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
                      <Td className="text-text-muted text-xs">{r.frontAccountLabel ?? '—'}</Td>
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
