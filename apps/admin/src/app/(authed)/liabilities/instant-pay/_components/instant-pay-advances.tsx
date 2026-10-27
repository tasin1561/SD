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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
        title={t('liabilitiesInstantPayInstantPayAdvances.instantPayAdvances')}
        subtitle={t('liabilitiesInstantPayInstantPayAdvances.paidToClientsAtDelivery')}
        action={
          <LinkButton href="/liabilities" variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
            {t('liabilitiesInstantPayInstantPayAdvances.whatWeOwe')}
          </LinkButton>
        }
      />

      {q.isLoading ? (
        <SkeletonRows
          rows={6}
          cols={8}
          label={t('liabilitiesInstantPayInstantPayAdvances.readingTheLedgers')}
        />
      ) : q.isError || q.data === undefined ? (
        <ErrorState
          message={
            q.error?.message ?? t('liabilitiesInstantPayInstantPayAdvances.couldNotReadTheAdvances')
          }
          retry={() => void q.refetch()}
        />
      ) : (
        <>
          <div className="mo-kpis">
            <KpiCard
              label={t('liabilitiesInstantPayInstantPayAdvances.codAwaitingTheCourier')}
              tone="pending"
              figure={<Money amount={q.data.totalCodInr} currency="INR" convert={false} />}
              hint={`${q.data.count} ${q.data.count === 1 ? 'order' : 'orders'}`}
            />
            <KpiCard
              label={t('liabilitiesInstantPayInstantPayAdvances.cashWeFronted')}
              figure={<Money amount={q.data.totalFrontedInr} currency="INR" convert={false} />}
              hint={t('liabilitiesInstantPayInstantPayAdvances.outOfCapitalLessThan')}
            />
            <KpiCard
              label={t('liabilitiesInstantPayInstantPayAdvances.creditedToClients')}
              figure={<Money amount={q.data.totalNetCreditedInr} currency="INR" convert={false} />}
              hint={t('liabilitiesInstantPayInstantPayAdvances.codLessTaxAndFees')}
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
                  label={t('liabilitiesInstantPayInstantPayAdvances.client')}
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                >
                  <option value="">
                    {t('liabilitiesInstantPayInstantPayAdvances.allClients')}
                  </option>
                  {(all.data?.bySeller ?? []).map((g) => (
                    <option key={g.key ?? ''} value={g.key ?? ''}>
                      {g.label} ({g.count})
                    </option>
                  ))}
                </Select>
              </FilterField>
              <FilterField icon={<Building2 size={16} />}>
                <Select
                  label={t('liabilitiesInstantPayInstantPayAdvances.courierAccount')}
                  value={courierAccountId}
                  onChange={(e) => setCourierAccountId(e.target.value)}
                >
                  <option value="">
                    {t('liabilitiesInstantPayInstantPayAdvances.allCourierAccounts')}
                  </option>
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
            <Table
              caption={t('liabilitiesInstantPayInstantPayAdvances.instantPayAdvancesAwaitingThe')}
            >
              <THead>
                <Tr>
                  <Th>{t('liabilitiesInstantPayInstantPayAdvances.order')}</Th>
                  <Th>{t('liabilitiesInstantPayInstantPayAdvances.client')}</Th>
                  <Th>{t('liabilitiesInstantPayInstantPayAdvances.owedBy')}</Th>
                  <SortableTh
                    label={t('liabilitiesInstantPayInstantPayAdvances.age')}
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
                  <Th align="right">{t('liabilitiesInstantPayInstantPayAdvances.credited')}</Th>
                  <SortableTh
                    label={t('liabilitiesInstantPayInstantPayAdvances.fronted')}
                    columnKey="fronted"
                    activeKey={sortKey}
                    direction={dir}
                    onSort={onSort}
                    align="right"
                  />
                  <Th>{t('liabilitiesInstantPayInstantPayAdvances.frontedFrom')}</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={8}>
                    {filtered ? (
                      <>
                        {t(
                          'liabilitiesInstantPayInstantPayAdvances.nothingOutstandingForThisFilter',
                        )}{' '}
                        <button
                          type="button"
                          className="mo-link li-inline-btn"
                          onClick={() => {
                            setSellerId('');
                            setCourierAccountId('');
                          }}
                        >
                          {t('liabilitiesInstantPayInstantPayAdvances.showAll')}
                        </button>
                      </>
                    ) : (
                      <>
                        {t('liabilitiesInstantPayInstantPayAdvances.everyInstantPayCreditHas')}{' '}
                        <Link href="/settlements" className="mo-link">
                          {t('liabilitiesInstantPayInstantPayAdvances.seeCourierPayouts')}
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
                          {t('liabilitiesInstantPayInstantPayAdvances.delivered', {
                            value: new Date(r.deliveredAt ?? r.creditedAt).toLocaleDateString(
                              'en-IN',
                            ),
                          })}
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
