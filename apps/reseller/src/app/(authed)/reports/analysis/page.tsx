'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import {
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
import { istDayRange, lastDays } from '@/lib/ist-day';
import { useStoreAnalysis, useStoreCashFlow } from '@/lib/report-hooks';

const pct = (v: string | null): string => (v === null ? '—' : `${v}%`);

/**
 * The store's analysis (RS-9): its confirmation, cancel and return rates,
 * profit per product (retail − transfer on delivered units, before fee
 * shares), returns by pincode, return on ad spend, and the credits it
 * expects and when. Rates count only orders whose outcome is known.
 */
export default function StoreAnalysisPage(): ReactElement {
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const analysis = useStoreAnalysis(window);
  const cash = useStoreCashFlow();

  return (
    <>
      <PageHeader
        title="Analysis"
        subtitle="How your orders are doing, what each product earns, where parcels come back from, and what you can expect to be credited."
        action={
          <Link href="/reports" className="text-sm underline">
            Profit and loss
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <FormField label="From" htmlFor="from">
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="To" htmlFor="to">
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>

      {analysis.isPending && <LoadingState rows={6} />}
      {analysis.isError && (
        <ErrorState message={analysis.error.message} retry={() => void analysis.refetch()} />
      )}
      {analysis.data !== undefined && (
        <>
          <Section
            title="Orders placed in the window"
            subtitle="Rates leave out orders whose outcome is not known yet."
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Placed" value={analysis.data.rates.placed} />
              <Stat
                label="Confirmed"
                value={pct(analysis.data.rates.confirmationRatePct)}
                hint={`${analysis.data.rates.confirmed} of ${analysis.data.rates.decided} decided`}
              />
              <Stat
                label="Cancelled"
                tone="warn"
                value={pct(analysis.data.rates.cancelRatePct)}
                hint={`${analysis.data.rates.calledOff} orders`}
              />
              <Stat
                label="Returned"
                tone="bad"
                value={pct(analysis.data.rates.returnRatePct)}
                hint={`${analysis.data.rates.returned} of ${analysis.data.rates.delivered + analysis.data.rates.returned + analysis.data.rates.lost}`}
              />
            </div>
          </Section>

          <Section
            title="Return on ad spend"
            subtitle="Retail of orders delivered in the window, divided by the advertising you recorded for it."
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Ad spend" value={<Money amount={analysis.data.roas.adSpendInr} />} />
              <Stat
                label="Delivered sales"
                value={<Money amount={analysis.data.roas.deliveredRetailInr} />}
                hint={`${analysis.data.roas.deliveredOrders} orders`}
              />
              <Stat
                label="ROAS"
                value={analysis.data.roas.roas === null ? '—' : `${analysis.data.roas.roas}×`}
              />
              <Stat
                label="Margin ROAS"
                value={
                  analysis.data.roas.marginRoas === null ? '—' : `${analysis.data.roas.marginRoas}×`
                }
                hint="Retail − transfer, per rupee of ads"
              />
            </div>
          </Section>

          <Section
            title="Profit per product"
            subtitle="Retail − transfer price on delivered units. Fee shares are per order and sit in the P&L."
          >
            {analysis.data.products.length === 0 ? (
              <EmptyState
                bare
                title="No delivered or returned orders yet"
                description="Widen the window."
              />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Product</Th>
                    <Th align="right">Delivered</Th>
                    <Th align="right">Returned</Th>
                    <Th align="right">Sales</Th>
                    <Th align="right">Margin</Th>
                  </Tr>
                </THead>
                <TBody>
                  {analysis.data.products.map((p) => (
                    <Tr key={p.variantId}>
                      <Td>
                        {p.productName}
                        <span className="text-text-muted block text-xs">{p.skuCode}</span>
                      </Td>
                      <Td align="right">{p.unitsDelivered}</Td>
                      <Td align="right">
                        {p.unitsReturned}{' '}
                        <span className="text-text-muted text-xs">{pct(p.returnRatePct)}</span>
                      </Td>
                      <Td align="right">
                        <Money amount={p.retailInr} />
                      </Td>
                      <Td align="right">
                        <Money amount={p.grossMarginInr} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>

          <Section
            title="Returns by pincode"
            subtitle="The 50 pincodes with the most parcels back."
          >
            {analysis.data.pincodes.length === 0 ? (
              <EmptyState bare title="No outcomes yet" />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Pincode</Th>
                    <Th align="right">Delivered</Th>
                    <Th align="right">Returned</Th>
                    <Th align="right">Return rate</Th>
                  </Tr>
                </THead>
                <TBody>
                  {analysis.data.pincodes.map((p) => (
                    <Tr key={p.postalCode}>
                      <Td>{p.postalCode}</Td>
                      <Td align="right">{p.delivered}</Td>
                      <Td align="right">{p.returned}</Td>
                      <Td align="right">{pct(p.returnRatePct)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </>
      )}

      <Section
        title="Cash-flow forecast"
        subtitle="COD orders not yet credited to you: retail − transfer, before your fee shares and COD tax share, by when your terms credit them."
      >
        {cash.isPending && <LoadingState rows={3} />}
        {cash.isError && (
          <ErrorState message={cash.error.message} retry={() => void cash.refetch()} />
        )}
        {cash.data !== undefined &&
          (cash.data.rows.length === 0 ? (
            <EmptyState bare title="Nothing waiting to be credited" />
          ) : (
            <>
              <p className="mb-2 text-sm">
                Expected in total: <Money amount={cash.data.totalInr} direction="credit" />
              </p>
              <Table>
                <THead>
                  <Tr>
                    <Th>When</Th>
                    <Th align="right">Orders</Th>
                    <Th align="right">Expected</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cash.data.weeks.map((w) => (
                    <Tr key={w.weekStart}>
                      <Td>Week of {w.weekStart}</Td>
                      <Td align="right">{w.count}</Td>
                      <Td align="right">
                        <Money amount={w.amountInr} />
                      </Td>
                    </Tr>
                  ))}
                  {cash.data.waiting.map((w) => (
                    <Tr key={w.bucket}>
                      <Td>{w.label}</Td>
                      <Td align="right">{w.count}</Td>
                      <Td align="right">
                        <Money amount={w.amountInr} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          ))}
      </Section>
    </>
  );
}
