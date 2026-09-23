'use client';

import Link from 'next/link';
import { useMemo, type ReactElement } from 'react';
import { Boxes, CalendarClock, TriangleAlert } from 'lucide-react';
import { Num, ProductThumb } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useResellerStockForecast } from '@/lib/reseller-report-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  RsFact,
  RsFacts,
  RsLink,
  RsProduct,
  RsSection,
  RsStrip,
  RsStripFact,
} from '../_components/rs-parts';

/**
 * How long the stock your reseller stores sell will last (RS-9), at the
 * rate it sold recently — every confirmed order counts, your own channel
 * included, because they draw on the same stock. You are told in-app once
 * a week while a product stays below your reorder threshold.
 *
 * ── WHAT THE CONSOLE COMPS SHOW THAT IS NOT HERE ────────────────────
 *   A RESTOCK DATE / LEAD TIME   nothing records how long a consignment
 *       takes from Dhaka for a given product, so "order by the 4th"
 *       would be a date we made up about somebody else's supply chain.
 *       Days of stock left is what IS measured, and the reorder flag is
 *       the threshold the seller themselves set.
 *   VALUE AT RISK                the forecast carries units, not cost.
 *       A rupee figure here would have to be invented.
 */
export default function ResellerStockForecastPage(): ReactElement {
  const forecast = useResellerStockForecast();

  const rows = useMemo(() => forecast.data?.rows ?? [], [forecast.data]);
  const reorder = rows.filter((r) => r.reorder).length;
  const selling = rows.filter((r) => r.daysOfStock !== null).length;
  const available = rows.reduce((sum, r) => sum + r.available, 0);
  const loaded = forecast.data !== undefined;
  const dash = <span className="rs-faint">—</span>;

  return (
    <div className="rs-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Reselling' },
          { label: 'Stock forecast' },
        ]}
        Link={Link}
        title="Stock forecast"
        subtitle="Days of stock left for every product your reseller stores may sell, at the rate it sold recently."
        meta={
          !loaded ? undefined : (
            <RsFacts>
              <RsFact tone={reorder > 0 ? 'bad' : 'good'} dot={reorder > 0}>
                {reorder === 0 ? 'Nothing to reorder' : `${reorder} to reorder`}
              </RsFact>
              <RsFact>Last {forecast.data.windowDays} days</RsFact>
              <RsFact>Flagged under {forecast.data.reorderDays} days</RsFact>
            </RsFacts>
          )
        }
      />

      {/* ── What the shelves hold ───────────────────────────────────
             Three cards counted off the rows below. Every figure is a
             UNIT count: this endpoint carries no cost, so there is no
             honest money figure to put here. The two plain counts roll
             up once; the unit total keeps its `<Num>`. While loading they
             are skeletons; if the forecast failed they read "—". */}
      {forecast.isPending ? (
        <div className="rs-kpis">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="rs-kpi-skel" height={104} rounded="md" />
          ))}
        </div>
      ) : (
        <div className="rs-kpis">
          {loaded ? (
            <KpiCard
              label="To reorder"
              icon={<TriangleAlert size={14} />}
              value={reorder}
              unit={reorder === 1 ? 'product' : 'products'}
              tone={reorder > 0 ? 'debit' : 'neutral'}
              hint={`Fewer than ${forecast.data.reorderDays} days of stock left at the recent rate.`}
            />
          ) : (
            <KpiCard
              label="To reorder"
              icon={<TriangleAlert size={14} />}
              figure={dash}
              tone="neutral"
            />
          )}
          {loaded ? (
            <KpiCard
              label="Selling"
              icon={<CalendarClock size={14} />}
              value={selling}
              unit={`of ${rows.length}`}
              tone="neutral"
              hint="A product with no recent sales has no days-left figure at all."
            />
          ) : (
            <KpiCard
              label="Selling"
              icon={<CalendarClock size={14} />}
              figure={dash}
              tone="neutral"
              hint="A product with no recent sales has no days-left figure at all."
            />
          )}
          <KpiCard
            label="Units available"
            icon={<Boxes size={14} />}
            figure={loaded ? <Num value={available} /> : dash}
            unit={loaded ? 'units' : undefined}
            tone="neutral"
            hint="Across every product a reseller store may sell."
          />
        </div>
      )}

      {forecast.isPending && <SkeletonRows rows={6} cols={6} label="Loading the stock forecast" />}
      {forecast.isError && (
        <ErrorState message={serverVerdict(forecast.error)} retry={() => void forecast.refetch()} />
      )}

      {loaded && (
        <>
          <RsSection
            title={`Sales over the last ${forecast.data.windowDays} days`}
            note={`Flagged under ${forecast.data.reorderDays} days — both numbers are in your settings.`}
            flush
          >
            {rows.length === 0 ? (
              <EmptyState
                bare
                title="No products enabled for a reseller store"
                description="Give a product a reseller price and switch it on for a store, and it appears here."
                action={<RsLink href="/reseller-stores">Your reseller stores</RsLink>}
              />
            ) : (
              <Table caption="Stock forecast">
                <THead>
                  <Tr>
                    <Th>Product</Th>
                    <Th align="right">Available</Th>
                    <Th align="right">Sold</Th>
                    <Th align="right">Per day</Th>
                    <Th align="right">Days left</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <Tr key={r.variantId}>
                      <Td>
                        <RsProduct
                          thumb={<ProductThumb src={r.imageUrl} size={36} alt={r.productName} />}
                          name={r.productName}
                          sku={r.skuCode}
                          extra={r.label !== null ? ` · ${r.label}` : ''}
                        />
                      </Td>
                      <Td align="right">
                        <Num value={r.available} />
                      </Td>
                      <Td align="right">
                        <Num value={r.unitsSold} />
                      </Td>
                      <Td align="right">
                        <Num value={r.dailyRate} />
                      </Td>
                      <Td align="right">
                        {r.daysOfStock === null ? (
                          <span className="rs-faint">Not selling</span>
                        ) : (
                          <Num value={r.daysOfStock} />
                        )}
                      </Td>
                      <Td>
                        {r.reorder && <StatusChip kind="failed" label="Reorder" size="sm" pulse />}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </RsSection>

          {rows.length > 0 && (
            <RsStrip>
              <RsStripFact
                label="To reorder"
                value={reorder}
                tone={reorder > 0 ? 'warn' : 'good'}
              />
              <RsStripFact label="Products" value={rows.length} />
              <RsStripFact label="Window" value={`${forecast.data.windowDays} days`} />
            </RsStrip>
          )}
        </>
      )}
    </div>
  );
}
