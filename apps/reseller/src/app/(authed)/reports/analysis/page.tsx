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
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { RmSection } from '../../wallet/_components/rm-parts';

const pct = (v: string | null): string => (v === null ? '—' : `${v}%`);

/**
 * The store's analysis (RS-9): its confirmation, cancel and return rates,
 * profit per product (retail − transfer on delivered units, before fee
 * shares), returns by pincode, return on ad spend, and the credits it
 * expects and when. Rates count only orders whose outcome is known.
 */
export default function StoreAnalysisPage(): ReactElement {
  const t = useT();
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const analysis = useStoreAnalysis(window);
  const cash = useStoreCashFlow();

  return (
    <div className="rm-page">
      <PageHeader
        title={t('repa.title')}
        subtitle={t('repa.subtitle')}
        action={
          <Link href="/reports" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__icon" aria-hidden>
              <ArrowLeft size={15} />
            </span>
            <span className="sk-btn__label">{t('repa.back')}</span>
          </Link>
        }
      />
      <div className="rm-filters">
        <DateField
          id="from"
          label={t('repa.from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <DateField
          id="to"
          label={t('repa.to')}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {analysis.isPending && <SkeletonRows rows={6} cols={4} label={t('repa.loading')} />}
      {analysis.isError && (
        <ErrorState message={verdict(analysis.error, t)} retry={() => void analysis.refetch()} />
      )}
      {analysis.data !== undefined && (
        <>
          <RmSection>
            <SectionHeading title={t('repa.orders.title')} note={t('repa.orders.note')} />
            <div className="rm-kpis">
              <KpiCard
                label={t('repa.placed')}
                icon={<ShoppingBag size={14} />}
                value={analysis.data.rates.placed}
                format={(n) => `${n}`}
              />
              <KpiCard
                label={t('repa.confirmed')}
                icon={<CheckCircle2 size={14} />}
                figure={pct(analysis.data.rates.confirmationRatePct)}
                hint={t('repa.confirmedHint', {
                  confirmed: analysis.data.rates.confirmed,
                  decided: analysis.data.rates.decided,
                })}
              />
              <KpiCard
                label={t('repa.cancelled')}
                icon={<Ban size={14} />}
                tone="pending"
                figure={pct(analysis.data.rates.cancelRatePct)}
                hint={t('repa.cancelledHint', { n: analysis.data.rates.calledOff })}
              />
              <KpiCard
                label={t('repa.returned')}
                icon={<Undo2 size={14} />}
                tone="debit"
                figure={pct(analysis.data.rates.returnRatePct)}
                hint={t('repa.returnedHint', {
                  returned: analysis.data.rates.returned,
                  total:
                    analysis.data.rates.delivered +
                    analysis.data.rates.returned +
                    analysis.data.rates.lost,
                })}
              />
            </div>
          </RmSection>

          <RmSection>
            <SectionHeading title={t('repa.roas.title')} note={t('repa.roas.note')} />
            <div className="rm-kpis">
              <KpiCard
                label={t('repa.adSpend')}
                icon={<Megaphone size={14} />}
                figure={<Money amount={analysis.data.roas.adSpendInr} />}
              />
              <KpiCard
                label={t('repa.deliveredSales')}
                icon={<PackageCheck size={14} />}
                figure={<Money amount={analysis.data.roas.deliveredRetailInr} />}
                hint={t('repa.deliveredSalesHint', { n: analysis.data.roas.deliveredOrders })}
              />
              <KpiCard
                label={t('repa.roas')}
                icon={<Target size={14} />}
                figure={analysis.data.roas.roas === null ? '—' : `${analysis.data.roas.roas}×`}
              />
              <KpiCard
                label={t('repa.marginRoas')}
                icon={<Target size={14} />}
                figure={
                  analysis.data.roas.marginRoas === null ? '—' : `${analysis.data.roas.marginRoas}×`
                }
                hint={t('repa.marginRoasHint')}
              />
            </div>
          </RmSection>

          <RmSection>
            <SectionHeading title={t('repa.products.title')} note={t('repa.products.note')} />
            {analysis.data.products.length === 0 ? (
              <EmptyState
                bare
                title={t('repa.products.empty')}
                description={t('repa.products.emptyBody')}
              />
            ) : (
              <Table caption={t('repa.products.title')}>
                <THead>
                  <Tr>
                    <Th>{t('repa.products.col.product')}</Th>
                    <Th align="right">{t('repa.products.col.delivered')}</Th>
                    <Th align="right">{t('repa.products.col.returned')}</Th>
                    <Th align="right">{t('repa.products.col.sales')}</Th>
                    <Th align="right">{t('repa.products.col.margin')}</Th>
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
            <SectionHeading title={t('repa.pin.title')} note={t('repa.pin.note')} />
            {analysis.data.pincodes.length === 0 ? (
              <EmptyState bare title={t('repa.pin.empty')} />
            ) : (
              <Table caption={t('repa.pin.title')}>
                <THead>
                  <Tr>
                    <Th>{t('repa.pin.col.pin')}</Th>
                    <Th align="right">{t('repa.pin.col.delivered')}</Th>
                    <Th align="right">{t('repa.pin.col.returned')}</Th>
                    <Th align="right">{t('repa.pin.col.rate')}</Th>
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
        <SectionHeading title={t('repa.cash.title')} note={t('repa.cash.note')} />
        {cash.isPending && <SkeletonRows rows={3} cols={3} label={t('repa.cash.loading')} />}
        {cash.isError && (
          <ErrorState message={verdict(cash.error, t)} retry={() => void cash.refetch()} />
        )}
        {cash.data !== undefined &&
          (cash.data.rows.length === 0 ? (
            <EmptyState bare tone="positive" title={t('repa.cash.empty')} />
          ) : (
            <>
              <p className="rm-muted">
                {richMessage(t('repa.cash.total'), {
                  amount: <Money amount={cash.data.totalInr} direction="credit" />,
                })}
              </p>
              <Table caption={t('repa.cash.byWeek')}>
                <THead>
                  <Tr>
                    <Th>{t('repa.cash.col.when')}</Th>
                    <Th align="right">{t('repa.cash.col.orders')}</Th>
                    <Th align="right">{t('repa.cash.col.expected')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {cash.data.weeks.map((w) => (
                    <Tr key={w.weekStart}>
                      <Td>{t('repa.cash.weekOf', { date: w.weekStart })}</Td>
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
              <h3 className="rm-sub-heading">{t('repa.cash.byOrder')}</h3>
              <Table caption={t('repa.cash.byOrder')}>
                <THead>
                  <Tr>
                    <Th>{t('repa.cash.col.order')}</Th>
                    <Th>{t('repa.cash.col.credited')}</Th>
                    <Th align="right">{t('repa.cash.col.expected')}</Th>
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
                          t('repa.cash.waiting')
                        ) : r.overdue ? (
                          <span className="rm-overdue">
                            <Clock size={12} aria-hidden />
                            {t('repa.cash.dueSince', { date: r.expectedOn })}
                          </span>
                        ) : (
                          <span>{t('repa.cash.around', { date: r.expectedOn })}</span>
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
