'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Megaphone,
  PackageCheck,
  ShoppingBag,
  Target,
  Undo2,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { buttonClassName } from '@skydrop/ui/app/button';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { istDayRange, lastDays } from '@/lib/ist-day';
import { useStoreAnalysis, useStoreCashFlow } from '@/lib/report-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RmSection } from '../../wallet/_components/rm-parts';

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
    <div className="rm-page">
      <PageHeader
        title="Analysis"
        subtitle="How your orders are doing, what each product earns, where parcels come back from, and what you can expect to be credited."
        action={
          <Link href="/reports" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__icon" aria-hidden>
              <ArrowLeft size={15} />
            </span>
            <span className="sk-btn__label">Profit and loss</span>
          </Link>
        }
      />
      <div className="rm-filters">
        <DateField id="from" label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <DateField id="to" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {analysis.isPending && <SkeletonRows rows={6} cols={4} label="Loading the analysis" />}
      {analysis.isError && (
        <ErrorState message={serverVerdict(analysis.error)} retry={() => void analysis.refetch()} />
      )}
      {analysis.data !== undefined && (
        <>
          <RmSection>
            <SectionHeading
              title="Orders placed in the window"
              note="Rates leave out orders whose outcome is not known yet."
            />
            <div className="rm-kpis">
              <KpiCard
                label="Placed"
                icon={<ShoppingBag size={14} />}
                value={analysis.data.rates.placed}
                format={(n) => `${n}`}
              />
              <KpiCard
                label="Confirmed"
                icon={<CheckCircle2 size={14} />}
                figure={pct(analysis.data.rates.confirmationRatePct)}
                hint={`${analysis.data.rates.confirmed} of ${analysis.data.rates.decided} decided`}
              />
              <KpiCard
                label="Cancelled"
                icon={<Ban size={14} />}
                tone="pending"
                figure={pct(analysis.data.rates.cancelRatePct)}
                hint={`${analysis.data.rates.calledOff} orders`}
              />
              <KpiCard
                label="Returned"
                icon={<Undo2 size={14} />}
                tone="debit"
                figure={pct(analysis.data.rates.returnRatePct)}
                hint={`${analysis.data.rates.returned} of ${analysis.data.rates.delivered + analysis.data.rates.returned + analysis.data.rates.lost}`}
              />
            </div>
          </RmSection>

          <RmSection>
            <SectionHeading
              title="Return on ad spend"
              note="Retail of orders delivered in the window, divided by the advertising you recorded for it."
            />
            <div className="rm-kpis">
              <KpiCard
                label="Ad spend"
                icon={<Megaphone size={14} />}
                figure={<Money amount={analysis.data.roas.adSpendInr} />}
              />
              <KpiCard
                label="Delivered sales"
                icon={<PackageCheck size={14} />}
                figure={<Money amount={analysis.data.roas.deliveredRetailInr} />}
                hint={`${analysis.data.roas.deliveredOrders} orders`}
              />
              <KpiCard
                label="ROAS"
                icon={<Target size={14} />}
                figure={analysis.data.roas.roas === null ? '—' : `${analysis.data.roas.roas}×`}
              />
              <KpiCard
                label="Margin ROAS"
                icon={<Target size={14} />}
                figure={
                  analysis.data.roas.marginRoas === null ? '—' : `${analysis.data.roas.marginRoas}×`
                }
                hint="Retail − transfer, per rupee of ads"
              />
            </div>
          </RmSection>

          <RmSection>
            <SectionHeading
              title="Profit per product"
              note="Retail − transfer price on delivered units. Fee shares are per order and sit in the P&L."
            />
            {analysis.data.products.length === 0 ? (
              <EmptyState
                bare
                title="No delivered or returned orders yet"
                description="Widen the window."
              />
            ) : (
              <Table caption="Profit per product">
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
                        <span className="rm-faint rm-block sk-ident">{p.skuCode}</span>
                      </Td>
                      <Td align="right" className="sk-figure">
                        {p.unitsDelivered}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {p.unitsReturned} <span className="rm-faint">{pct(p.returnRatePct)}</span>
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
          </RmSection>

          <RmSection>
            <SectionHeading
              title="Returns by pincode"
              note="The 50 pincodes with the most parcels back."
            />
            {analysis.data.pincodes.length === 0 ? (
              <EmptyState bare title="No outcomes yet" />
            ) : (
              <Table caption="Returns by pincode">
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
                      <Td className="sk-figure">{p.postalCode}</Td>
                      <Td align="right" className="sk-figure">
                        {p.delivered}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {p.returned}
                      </Td>
                      <Td align="right" className="sk-figure">
                        {pct(p.returnRatePct)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </RmSection>
        </>
      )}

      <RmSection>
        <SectionHeading
          title="Cash-flow forecast"
          note="COD orders not yet credited to you: retail − transfer, before your fee shares and COD tax share, by when your terms credit them."
        />
        {cash.isPending && <SkeletonRows rows={3} cols={3} label="Loading the forecast" />}
        {cash.isError && (
          <ErrorState message={serverVerdict(cash.error)} retry={() => void cash.refetch()} />
        )}
        {cash.data !== undefined &&
          (cash.data.rows.length === 0 ? (
            <EmptyState bare tone="positive" title="Nothing waiting to be credited" />
          ) : (
            <>
              <p className="rm-muted">
                Expected in total: <Money amount={cash.data.totalInr} direction="credit" />
              </p>
              <Table caption="Expected by week">
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
                      <Td align="right" className="sk-figure">
                        {w.count}
                      </Td>
                      <Td align="right">
                        <Money amount={w.amountInr} />
                      </Td>
                    </Tr>
                  ))}
                  {cash.data.waiting.map((w) => (
                    <Tr key={w.bucket}>
                      <Td>{w.label}</Td>
                      <Td align="right" className="sk-figure">
                        {w.count}
                      </Td>
                      <Td align="right">
                        <Money amount={w.amountInr} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <h3 className="rm-sub-heading">Order by order</h3>
              <Table caption="Order by order">
                <THead>
                  <Tr>
                    <Th>Order</Th>
                    <Th>Credited</Th>
                    <Th align="right">Expected</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cash.data.rows.map((r) => (
                    <Tr key={r.orderId}>
                      <Td>
                        <Link href={`/orders/${r.orderId}`} className="rm-ref sk-ident">
                          {r.orderNumber}
                        </Link>
                      </Td>
                      <Td className="rm-small">
                        {r.expectedOn === null ? (
                          'Waiting for the order to move on'
                        ) : r.overdue ? (
                          <span className="rm-overdue">
                            <Clock size={12} aria-hidden />
                            {'Due since '}
                            {r.expectedOn}
                          </span>
                        ) : (
                          <span>
                            {'Around '}
                            {r.expectedOn}
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <Money amount={r.expectedInr} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </>
          ))}
      </RmSection>
    </div>
  );
}
