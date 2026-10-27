'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Clock,
  Gauge,
  HandCoins,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { storeWalletDirectionLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { buttonClassName } from '@skydrop/ui/app/button';
import { Accordion, AccordionItem } from '@skydrop/ui/app/accordion';
import { Select } from '@skydrop/ui/app/select';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { istDateLabel, istDayRange, lastDays, monthLabel } from '@/lib/ist-day';
import {
  useStorePnl,
  useStorePnlMonth,
  useStorePnlMonths,
  useStorePosition,
  type StoreCarryView,
  type StorePnlLine,
  type StorePnlReport,
} from '@/lib/report-hooks';
import { richMessage, useLocale, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { RmCallout, RmSection } from '../wallet/_components/rm-parts';

/** The month select's value for "pick your own dates". */
const CUSTOM = 'custom';

/** An order number names an order the store can open (search pre-fills /orders). */
function orderLink(ref: string): string | null {
  return /^SD-/.test(ref) ? `/orders?search=${encodeURIComponent(ref)}` : null;
}

/**
 * The store's profit and loss by month (RS-8), or over any dates. A month
 * is FROZEN once it closes and never changes; anything that moves later is
 * carried into the month open at the time and shown there, with its
 * reason. A custom range is computed live and is never frozen. Money comes
 * from the store's own wallet ledger and expense book — never recomputed
 * here.
 */
export default function StoreReportsPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const months = useStorePnlMonths();
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? months.data?.[0]?.month ?? null;
  const custom = month === CUSTOM;
  const view = useStorePnlMonth(custom ? null : month);
  const initial = lastDays(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const window = useMemo(() => istDayRange(from, to), [from, to]);
  const range = useStorePnl(window, custom);

  return (
    <div className="rm-page">
      <PageHeader
        title={t('rep.title')}
        subtitle={t('rep.subtitle')}
        action={
          <Link href="/reports/analysis" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__label">{t('rep.analysis')}</span>
            <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
              <ArrowRight size={15} />
            </span>
          </Link>
        }
      />

      <PositionTiles />

      {months.isPending ? (
        <SkeletonRows rows={6} cols={4} label={t('rep.monthsLoading')} />
      ) : months.isError ? (
        <ErrorState message={verdict(months.error, t)} retry={() => void months.refetch()} />
      ) : (
        <>
          <RmSection>
            <SectionHeading title={t('rep.period')} />
            <div className="rm-filters rm-filters--wide">
              <Select
                id="pnl-month"
                label={t('rep.month')}
                value={month ?? ''}
                onChange={(e) => setPicked(e.target.value)}
              >
                {months.data.map((m) => (
                  <option key={m.month} value={m.month}>
                    {monthLabel(m.month, locale)} —{' '}
                    {m.status === 'closed' ? t('rep.closed') : t('rep.open')}
                  </option>
                ))}
                <option value={CUSTOM}>{t('rep.custom')}</option>
              </Select>
              {custom ? (
                <>
                  <DateField
                    id="pnl-from"
                    label={t('rep.from')}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <DateField
                    id="pnl-to"
                    label={t('rep.to')}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </>
              ) : null}
            </div>
            {custom ? <p className="rm-muted rm-faint">{t('rep.customNote')}</p> : null}
          </RmSection>

          {custom ? (
            range.isPending ? (
              <SkeletonRows rows={6} cols={4} label={t('rep.rangeLoading')} />
            ) : range.isError ? (
              <ErrorState message={verdict(range.error, t)} retry={() => void range.refetch()} />
            ) : (
              <>
                <div className="rm-kpis rm-kpis--3">
                  <KpiCard
                    label={t('rep.revenue')}
                    icon={<TrendingUp size={14} />}
                    figure={<Money amount={range.data.revenueInr} size="lg" />}
                  />
                  <KpiCard
                    label={t('rep.costs')}
                    icon={<TrendingDown size={14} />}
                    figure={<Money amount={range.data.costInr} size="lg" />}
                  />
                  <KpiCard
                    label={t('rep.net')}
                    icon={<Scale size={14} />}
                    tone={range.data.netInr.startsWith('-') ? 'debit' : 'credit'}
                    figure={<Money amount={range.data.netInr} size="lg" />}
                  />
                </div>
                <ReportBody report={range.data} />
              </>
            )
          ) : month === null ? (
            <EmptyState
              icon={<CalendarClock size={22} />}
              title={t('rep.noMonths')}
              description={t('rep.noMonthsBody')}
            />
          ) : view.isPending ? (
            <SkeletonRows rows={6} cols={4} label={t('rep.monthLoading')} />
          ) : view.isError ? (
            <ErrorState message={verdict(view.error, t)} retry={() => void view.refetch()} />
          ) : (
            <>
              <div className="rm-kpis rm-kpis--3">
                <KpiCard
                  label={t('rep.revenue')}
                  icon={<TrendingUp size={14} />}
                  figure={<Money amount={view.data.report.revenueInr} size="lg" />}
                />
                <KpiCard
                  label={t('rep.costs')}
                  icon={<TrendingDown size={14} />}
                  figure={<Money amount={view.data.report.costInr} size="lg" />}
                />
                <KpiCard
                  label={view.data.status === 'closed' ? t('rep.netReported') : t('rep.netSoFar')}
                  icon={<Scale size={14} />}
                  tone={view.data.asReportedNetInr.startsWith('-') ? 'debit' : 'credit'}
                  figure={<Money amount={view.data.asReportedNetInr} size="lg" />}
                  hint={
                    view.data.carriedInNetInr === '0.00'
                      ? view.data.status === 'closed'
                        ? `${t('rep.closedPlain')}${view.data.closedAt === null ? '' : istDateLabel(view.data.closedAt, locale)}`
                        : t('rep.stillOpen')
                      : richMessage(t('rep.carriedIn'), {
                          amount: <Money amount={view.data.carriedInNetInr} />,
                        })
                  }
                />
              </div>
              <ReportBody report={view.data.report} />
              <CarryTable
                title={t('rep.carryIn.title')}
                subtitle={t('rep.carryIn.sub')}
                rows={view.data.carriedIn}
              />
              <CarryTable
                title={t('rep.carryOut.title')}
                subtitle={t('rep.carryOut.sub')}
                rows={view.data.carriedOut}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Where the wallet stands now — independent of the period chosen below. */
function PositionTiles(): ReactElement {
  const t = useT();
  const position = useStorePosition();
  if (position.isPending) {
    return (
      <div className="rm-kpis" role="status" aria-busy="true" aria-label={t('rep.pos.loading')}>
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
        <Skeleton className="rm-kpi-skel" height={104} rounded="md" />
      </div>
    );
  }
  if (position.isError) {
    return (
      <ErrorState message={verdict(position.error, t)} retry={() => void position.refetch()} />
    );
  }
  const p = position.data;
  return (
    <div className="rm-kpis">
      <KpiCard
        label={t('rep.pos.balance')}
        icon={<Wallet size={14} />}
        figure={<Money amount={p.balanceInr} size="lg" />}
      />
      <KpiCard
        label={t('rep.pos.owed')}
        icon={<ArrowDownLeft size={14} />}
        tone="credit"
        figure={<Money amount={p.owedToStoreInr} size="lg" />}
      />
      <KpiCard
        label={t('rep.pos.owe')}
        icon={<ArrowUpRight size={14} />}
        tone={p.owedByStoreInr === '0.00' ? 'neutral' : 'pending'}
        figure={<Money amount={p.owedByStoreInr} size="lg" />}
      />
      {p.withdrawableInr !== null ? (
        <KpiCard
          label={t('rep.pos.withdraw')}
          icon={<HandCoins size={14} />}
          figure={<Money amount={p.withdrawableInr} size="lg" />}
          hint={t('rep.pos.withdrawHint')}
        />
      ) : null}
      <KpiCard
        label={t('rep.pos.wWaiting')}
        icon={<Clock size={14} />}
        figure={<Money amount={p.pendingWithdrawals.amountInr} size="lg" />}
        hint={t(
          p.pendingWithdrawals.count === 1 ? 'rep.pos.request.one' : 'rep.pos.request.other',
          {
            n: p.pendingWithdrawals.count,
          },
        )}
      />
      <KpiCard
        label={t('rep.pos.tWaiting')}
        icon={<Landmark size={14} />}
        figure={<Money amount={p.pendingTopups.amountInr} size="lg" />}
        hint={t(p.pendingTopups.count === 1 ? 'rep.pos.claim.one' : 'rep.pos.claim.other', {
          n: p.pendingTopups.count,
        })}
      />
      <KpiCard
        label={t('rep.pos.negative')}
        icon={<Gauge size={14} />}
        figure={<Money amount={p.negativeLimit.effectiveInr} size="lg" />}
        hint={t('rep.pos.negativeHint')}
      />
    </div>
  );
}

/** The lines, expenses by category and cash movements of one report. */
function ReportBody({ report }: { report: StorePnlReport }): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const sellerName = me?.seller.companyName ?? t('rep.clientFallback');
  return (
    <>
      <RmSection>
        <SectionHeading title={t('rep.pnl.title')} note={t('rep.pnl.note')} />
        <Accordion type="multiple">
          {report.lines.map((l) => (
            <PnlLine key={l.key} line={l} />
          ))}
        </Accordion>
      </RmSection>

      {report.expensesByCategory.length > 0 ? (
        <RmSection>
          <SectionHeading title={t('rep.exp.title')} note={t('rep.exp.note')} />
          <Table caption={t('rep.exp.title')}>
            <THead>
              <Tr>
                <Th>{t('rep.exp.category')}</Th>
                <Th align="right">{t('rep.exp.spent')}</Th>
              </Tr>
            </THead>
            <TBody>
              {report.expensesByCategory.map((c) => (
                <Tr key={c.category}>
                  <Td>{c.label}</Td>
                  <Td align="right">
                    <Money amount={c.amountInr} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </RmSection>
      ) : null}

      <RmSection>
        <SectionHeading title={t('rep.cash.title')} note={t('rep.cash.note')} />
        <p className="rm-cash">
          <span className="rm-cash__fact">
            <ArrowDownLeft size={14} aria-hidden />
            {richMessage(t('rep.cash.in'), {
              amount: <Money amount={report.cash.inInr} direction="credit" />,
            })}
          </span>
          <span className="rm-cash__fact">
            <ArrowUpRight size={14} aria-hidden />
            {richMessage(t('rep.cash.out'), {
              amount: <Money amount={report.cash.outInr} direction="debit" />,
            })}
          </span>
        </p>
        {report.cash.byDirection.length > 0 ? (
          <Table caption={t('rep.cash.title')}>
            <THead>
              <Tr>
                <Th>{t('rep.cash.what')}</Th>
                <Th align="right">{t('rep.cash.times')}</Th>
                <Th align="right">{t('rep.cash.amount')}</Th>
              </Tr>
            </THead>
            <TBody>
              {report.cash.byDirection.map((d) => (
                <Tr key={d.direction}>
                  <Td>{storeWalletDirectionLabel(d.direction, sellerName)}</Td>
                  <Td align="right" className="sk-figure">
                    {d.count}
                  </Td>
                  <Td align="right">
                    <Money amount={d.amountInr} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : null}
      </RmSection>

      {report.warnings.map((w) => (
        <RmCallout key={w} tone="warn" icon={<TriangleAlert size={16} />}>
          <p>{w}</p>
        </RmCallout>
      ))}
    </>
  );
}

function PnlLine({ line }: { line: StorePnlLine }): ReactElement {
  const t = useT();
  const locale = useLocale();
  const revenue = line.side === 'revenue';
  return (
    <AccordionItem
      value={line.key}
      icon={revenue ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      title={
        <>
          {line.label} <span className="rm-count">({line.count})</span>
        </>
      }
      meta={<Money amount={line.amountInr} direction={revenue ? 'credit' : 'debit'} />}
    >
      <div className="rm-stack">
        <p className="rm-muted rm-faint">{line.note}</p>
        {line.rows.length === 0 ? (
          <p className="rm-muted">{t('rep.line.empty')}</p>
        ) : (
          <Table caption={line.label}>
            <THead>
              <Tr>
                <Th>{t('rep.line.date')}</Th>
                <Th>{t('rep.line.item')}</Th>
                <Th>{t('rep.line.what')}</Th>
                <Th align="right">{t('rep.line.amount')}</Th>
              </Tr>
            </THead>
            <TBody>
              {line.rows.map((r) => {
                const href = orderLink(r.ref);
                return (
                  <Tr key={r.id}>
                    <Td className="rm-when sk-figure">{istDateLabel(r.at, locale)}</Td>
                    <Td>
                      {href === null ? (
                        r.ref
                      ) : (
                        <Link href={href} className="rm-ref sk-ident">
                          {r.ref}
                        </Link>
                      )}
                    </Td>
                    <Td>
                      {r.subRef}
                      {r.context !== undefined && (
                        <span className="rm-faint rm-block">
                          {richMessage(t('rep.line.soldFor'), {
                            retail: <Money amount={r.context.retailInr} />,
                            transfer: <Money amount={r.context.transferInr} />,
                          })}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Money amount={r.amountInr} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </AccordionItem>
  );
}

function CarryTable({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: readonly StoreCarryView[];
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  return (
    <RmSection>
      <SectionHeading title={title} note={subtitle} />
      {rows.length === 0 ? (
        <EmptyState bare title={t('rep.carry.none')} description={t('rep.carry.noneBody')} />
      ) : (
        <Table caption={title}>
          <THead>
            <Tr>
              <Th>{t('rep.carry.month')}</Th>
              <Th>{t('rep.carry.line')}</Th>
              <Th>{t('rep.carry.why')}</Th>
              <Th align="right">{t('rep.carry.effect')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td>
                  {monthLabel(c.originMonth, locale)} → {monthLabel(c.landedMonth, locale)}
                </Td>
                <Td>{c.lineLabel}</Td>
                <Td>{c.reason}</Td>
                <Td align="right">
                  <Money amount={c.netEffectInr} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </RmSection>
  );
}
