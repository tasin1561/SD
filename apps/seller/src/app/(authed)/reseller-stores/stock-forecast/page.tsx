'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
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

/**
 * How long the stock your reseller stores sell will last (RS-9), at the
 * rate it sold recently — every confirmed order counts, your own channel
 * included, because they draw on the same stock. You are told in-app once
 * a week while a product stays below your reorder threshold.
 */
export default function ResellerStockForecastPage(): ReactElement {
  const forecast = useResellerStockForecast();
  return (
    <>
      <PageHeader
        title="Stock forecast"
        subtitle="Days of stock left for every product your reseller stores may sell, at the rate it sold recently."
        action={
          <Link href="/reseller-stores/reports" className="text-sm underline">
            Store reports
          </Link>
        }
      />
      {forecast.isPending && <LoadingState rows={6} />}
      {forecast.isError && (
        <ErrorState message={forecast.error.message} retry={() => void forecast.refetch()} />
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
                      {r.skuCode}
                      {r.label !== null && (
                        <span className="text-text-muted block text-xs">{r.label}</span>
                      )}
                    </Td>
                    <Td align="right">{r.available}</Td>
                    <Td align="right">{r.unitsSold}</Td>
                    <Td align="right">{r.dailyRate}</Td>
                    <Td align="right">{r.daysOfStock ?? 'Not selling'}</Td>
                    <Td>{r.reorder && <StatusBadge kind="failed" label="Reorder" />}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}
    </>
  );
}
