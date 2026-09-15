'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Num,
  PageHeader,
  ProductThumb,
  Section,
  StatusBadge,
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
 */
export default function ResellerStockForecastPage(): ReactElement {
  const forecast = useResellerStockForecast();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock forecast"
        subtitle="Days of stock left for every product your reseller stores may sell, at the rate it sold recently."
        action={
          <Link href="/reseller-stores/reports" className="text-accent text-sm hover:underline">
            Store reports
          </Link>
        }
      />
      {forecast.isPending && <LoadingState label="Loading the stock forecast" rows={6} />}
      {forecast.isError && (
        <ErrorState message={serverVerdict(forecast.error)} retry={() => void forecast.refetch()} />
      )}
      {forecast.data !== undefined && (
        <Section
          title={`Sales over the last ${forecast.data.windowDays} days`}
          subtitle={`Flagged when stock lasts fewer than ${forecast.data.reorderDays} days — both numbers are in your settings.`}
        >
          {forecast.data.rows.length === 0 ? (
            <EmptyState
              title="No products enabled for a reseller store"
              action={<Link href="/reseller-stores">Your reseller stores</Link>}
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
                {forecast.data.rows.map((r) => (
                  <Tr key={r.variantId}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <ProductThumb src={r.imageUrl} size={40} alt={r.productName} />
                        <div className="min-w-0">
                          <div className="text-text-body">{r.productName}</div>
                          <div className="text-text-faint font-mono text-xs">
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
                      {r.daysOfStock === null ? 'Not selling' : <Num value={r.daysOfStock} />}
                    </Td>
                    <Td>{r.reorder && <StatusBadge kind="failed" label="Reorder" />}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}
    </div>
  );
}
