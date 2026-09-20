'use client';

import Link from 'next/link';
import { useMemo, type ReactElement } from 'react';
import { CalendarClock, Boxes, TriangleAlert } from 'lucide-react';
import {
  BandBody,
  Crumbs,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaChip,
  Num,
  PageHeader,
  ProductThumb,
  SectionBand,
  Stat,
  StatusBadge,
  StripFact,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { useResellerStockForecast } from '@/lib/reseller-report-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Reselling' },
              { label: 'Stock forecast' },
            ]}
            Link={Link}
          />
        }
        title="Stock forecast"
        subtitle="Days of stock left for every product your reseller stores may sell, at the rate it sold recently."
        meta={
          !loaded ? undefined : (
            <>
              <MetaChip tone={reorder > 0 ? 'bad' : 'good'} dot={reorder > 0}>
                {reorder === 0 ? 'Nothing to reorder' : `${reorder} to reorder`}
              </MetaChip>
              <MetaChip>Last {forecast.data.windowDays} days</MetaChip>
              <MetaChip>Flagged under {forecast.data.reorderDays} days</MetaChip>
            </>
          )
        }
      />

      {/* ── What the shelves hold ───────────────────────────────────
             Three tiles counted off the rows below. Every figure is a
             UNIT count: this endpoint carries no cost, so there is no
             honest money figure to put here. */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="To reorder"
          icon={<TriangleAlert size={13} aria-hidden />}
          value={loaded ? reorder : <span className="text-text-faint">—</span>}
          unit={loaded ? (reorder === 1 ? 'product' : 'products') : undefined}
          tone={loaded && reorder > 0 ? 'bad' : 'neutral'}
          hint={
            loaded
              ? `Fewer than ${forecast.data.reorderDays} days of stock left at the recent rate.`
              : undefined
          }
        />
        <Stat
          label="Selling"
          icon={<CalendarClock size={13} aria-hidden />}
          value={loaded ? selling : <span className="text-text-faint">—</span>}
          unit={loaded ? `of ${rows.length}` : undefined}
          tone="neutral"
          hint="A product with no recent sales has no days-left figure at all."
        />
        <Stat
          label="Units available"
          icon={<Boxes size={13} aria-hidden />}
          value={loaded ? <Num value={available} /> : <span className="text-text-faint">—</span>}
          unit={loaded ? 'units' : undefined}
          tone="neutral"
          hint="Across every product a reseller store may sell."
        />
      </div>

      {forecast.isPending && <LoadingState label="Loading the stock forecast" rows={6} />}
      {forecast.isError && (
        <ErrorState message={serverVerdict(forecast.error)} retry={() => void forecast.refetch()} />
      )}

      {loaded && (
        <>
          <SectionBand
            index="01"
            title={`Sales over the last ${forecast.data.windowDays} days`}
            note={`Flagged under ${forecast.data.reorderDays} days — both numbers are in your settings.`}
          />
          <BandBody flush>
            {rows.length === 0 ? (
              <EmptyState
                bare
                title="No products enabled for a reseller store"
                description="Give a product a reseller price and switch it on for a store, and it appears here."
                action={
                  <Link href="/reseller-stores" className="text-accent text-sm hover:underline">
                    Your reseller stores
                  </Link>
                }
              />
            ) : (
              <Table>
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
                        <div className="flex items-center gap-3">
                          <ProductThumb src={r.imageUrl} size={36} alt={r.productName} />
                          <div className="min-w-0">
                            <div className="text-text-bright truncate font-medium">
                              {r.productName}
                            </div>
                            <div className="text-text-faint truncate font-mono text-xs">
                              {r.skuCode}
                              {r.label !== null ? ` · ${r.label}` : ''}
                            </div>
                          </div>
                        </div>
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
                          <span className="text-text-faint text-xs">Not selling</span>
                        ) : (
                          <Num value={r.daysOfStock} />
                        )}
                      </Td>
                      <Td>{r.reorder && <StatusBadge kind="failed" label="Reorder" />}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </BandBody>

          {rows.length > 0 && (
            <div className="text-text-faint border-border mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 font-mono text-[11px]">
              <StripFact label="To reorder" value={reorder} tone={reorder > 0 ? 'warn' : 'good'} />
              <StripFact label="Products" value={rows.length} />
              <StripFact label="Window" value={`${forecast.data.windowDays} days`} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
