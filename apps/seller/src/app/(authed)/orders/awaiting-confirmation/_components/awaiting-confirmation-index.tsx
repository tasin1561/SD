'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, Clock, PhoneCall, Settings2 } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import {
  SelectAllTh,
  SelectTd,
  Table,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  useRowSelection,
} from '@skydrop/ui/app/data-table';
import { Money } from '@skydrop/ui/components';
import {
  tallyOutcomes,
  useAwaitingConfirmation,
  useCallConfirmationSetting,
  useSendConfirmationCalls,
  type AwaitingConfirmationRow,
  type ConfirmationCallOutcome,
} from '@/lib/call-confirmation-hooks';
import { verdict } from '@/i18n/verdict';
import { useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { MetaFact, LinkButton } from '../../_components/orders-parts';
import { msLeft, partsOf, urgencyOf, type Urgency } from './time-left';
import './awaiting.css';

const PAGE_SIZE = 25;

/** The clock the countdowns read. One minute is as fine as the text gets. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

interface Report {
  readonly sent: number;
  readonly already: number;
  readonly refused: ReadonlyArray<ConfirmationCallOutcome>;
}

function TimeLeft({ row, now }: { row: AwaitingConfirmationRow; now: number }): ReactElement {
  const t = useT();
  const locale = useLocale();
  if (row.confirmationDeadlineAt === null) {
    return <span className="cc-faint">{t('callConfirm.noClock')}</span>;
  }
  const ms = msLeft(row.confirmationDeadlineAt, now);
  const urgency: Urgency = urgencyOf(ms);
  const p = partsOf(ms);
  const time =
    p.d > 0
      ? `${t('callConfirm.dayUnit', { n: p.d })} ${t('callConfirm.hourUnit', { n: p.h })}`
      : p.h > 0
        ? `${t('callConfirm.hourUnit', { n: p.h })} ${t('callConfirm.minUnit', { n: p.m })}`
        : t('callConfirm.minUnit', { n: p.m });
  const text = urgency === 'expired' ? t('callConfirm.autoNow') : t('callConfirm.autoIn', { time });
  const absolute = t('callConfirm.deadlineAt', {
    when: formatDateTime(row.confirmationDeadlineAt, locale),
  });
  // Urgency is a word AND an icon as well as a colour (WCAG 1.4.1).
  const Icon = urgency === 'urgent' || urgency === 'expired' ? AlertTriangle : Clock;
  return (
    <time
      className="cc-left"
      data-urgency={urgency}
      dateTime={row.confirmationDeadlineAt}
      title={absolute}
      aria-label={`${text}. ${absolute}`}
      tabIndex={0}
    >
      <Icon size={14} aria-hidden className="cc-left__icon" />
      <span>{text}</span>
      {(urgency === 'urgent' || urgency === 'soon') && (
        <span className="cc-left__tag">
          {urgency === 'urgent' ? t('callConfirm.urgent') : t('callConfirm.soon')}
        </span>
      )}
    </time>
  );
}

export function AwaitingConfirmationIndex(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const [page, setPage] = useState(1);
  const list = useAwaitingConfirmation(page, PAGE_SIZE);
  const setting = useCallConfirmationSetting();
  const send = useSendConfirmationCalls();
  const [report, setReport] = useState<Report | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const selection = useRowSelection(ids);
  const total = list.data?.total ?? rows.length;
  const refreshing = list.isFetching && !list.isLoading;

  async function onSend(): Promise<void> {
    setReport(null);
    setFailure(null);
    const orderIds = [...selection.selected];
    try {
      const res = await send.mutateAsync({ orderIds });
      const tally = tallyOutcomes(res.results);
      setReport(tally);
      selection.clear();
      // Nothing went anywhere: the control must say so on itself.
      if (tally.sent === 0 && tally.already === 0) throw new Error('none sent');
    } catch (e) {
      if (!(e instanceof Error && e.message === 'none sent')) setFailure(verdict(e, t));
      throw e;
    }
  }

  const callsOn = setting.data?.callsRequired === true;
  const settled = !list.isLoading && !setting.isLoading;
  const empty = settled && list.isSuccess && rows.length === 0;

  const summary =
    report === null
      ? null
      : [
          report.sent > 0 ? t('callConfirm.resultSent', { n: report.sent }) : null,
          report.already > 0 ? t('callConfirm.resultAlready', { n: report.already }) : null,
          report.refused.length > 0
            ? t('callConfirm.resultRefused', { n: report.refused.length })
            : null,
        ]
          .filter((x): x is string => x !== null)
          .join(', ');
  const tone: 'good' | 'warn' | 'bad' =
    report === null
      ? 'good'
      : report.refused.length === 0
        ? 'good'
        : report.sent + report.already > 0
          ? 'warn'
          : 'bad';

  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: t('callConfirm.clientConsole') },
          { label: t('callConfirm.fulfilment') },
          { label: t('callConfirm.orders'), href: '/orders' },
          { label: t('callConfirm.pageTitle') },
        ]}
        Link={Link}
        title={t('callConfirm.pageTitle')}
        subtitle={t('callConfirm.pageSubtitle')}
        meta={
          list.isLoading || total === 0 ? undefined : (
            <span className="ord-meta">
              <MetaFact tone="warn">{t('callConfirm.waiting', { n: total })}</MetaFact>
            </span>
          )
        }
        action={
          <LinkButton href="/settings/orders" variant="ghost" icon={<Settings2 size={15} />}>
            {t('callConfirm.openSettings')}
          </LinkButton>
        }
      />

      {/* Polite, always mounted, so a result is announced when it appears. */}
      <div className="cc-result-slot" aria-live="polite" role="status">
        {(report !== null || failure !== null) && (
          <div className="cc-result" data-tone={failure !== null ? 'bad' : tone}>
            {failure !== null ? (
              <p>{failure}</p>
            ) : (
              <>
                <p className="cc-result__summary">{summary}</p>
                {report !== null && report.refused.length > 0 && (
                  <ul className="cc-result__list">
                    {report.refused.map((r) => (
                      <li key={r.orderId}>
                        <span className="sk-ident">{orderLabel(rows, r.orderId)}</span>{' '}
                        {r.code !== undefined || r.message !== undefined
                          ? `[${r.code ?? r.outcome}] ${r.message ?? ''}`.trim()
                          : r.outcome}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {list.isLoading || setting.isLoading ? (
        <SkeletonRows rows={5} label={t('callConfirm.loading')} />
      ) : list.isError ? (
        <ErrorState
          title={t('callConfirm.loadFailed')}
          message={verdict(list.error, t)}
          retry={() => void list.refetch()}
        />
      ) : empty ? (
        <EmptyState
          icon={<PhoneCall size={22} />}
          tone={callsOn ? 'neutral' : 'positive'}
          title={callsOn ? t('callConfirm.emptyOnTitle') : t('callConfirm.emptyOffTitle')}
          description={callsOn ? t('callConfirm.emptyOnBody') : t('callConfirm.emptyOffBody')}
          action={
            <LinkButton href="/settings/orders" variant="primary" icon={<Settings2 size={15} />}>
              {t('callConfirm.openSettings')}
            </LinkButton>
          }
        />
      ) : (
        <div className="cc-list" data-refreshing={refreshing || undefined}>
          <div className="cc-bar" data-active={selection.count > 0 || undefined}>
            <span className="cc-bar__count">
              {t('callConfirm.selected', { n: selection.count })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={selection.clear}
              disabled={selection.count === 0}
            >
              {t('callConfirm.clear')}
            </Button>
            <AsyncButton
              variant="primary"
              icon={<PhoneCall size={15} />}
              labels={{
                idle: t('callConfirm.send'),
                busy: t('callConfirm.sending'),
                done: t('callConfirm.sentLabel'),
                error: t('callConfirm.sendFailed'),
              }}
              disabled={selection.count === 0 || send.isPending}
              onAction={onSend}
            />
          </div>
          <Table caption={t('callConfirm.tableCaption')} className="cc-table">
            <THead>
              <Tr>
                <SelectAllTh selection={selection} label={t('callConfirm.selectAll')} />
                <Th>{t('callConfirm.colOrder')}</Th>
                <Th>{t('callConfirm.colCustomer')}</Th>
                <Th align="right">{t('callConfirm.colCod')}</Th>
                <Th align="right">{t('callConfirm.colItems')}</Th>
                <Th>{t('callConfirm.colPlaced')}</Th>
                <Th>{t('callConfirm.colTimeLeft')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id} selected={selection.isSelected(r.id)}>
                  <SelectTd
                    selection={selection}
                    id={r.id}
                    label={t('callConfirm.selectRow', { order: r.orderNumber })}
                  />
                  <Td>
                    <Link href={`/orders/${r.id}`} className="ord-link sk-ident">
                      {r.orderNumber}
                    </Link>
                  </Td>
                  <Td>
                    <span className="cc-name">{r.recipientName}</span>
                    <span className="cc-faint">{r.recipientCity}</span>
                  </Td>
                  <Td align="right">
                    <Money amount={r.codAmountInr} />
                  </Td>
                  <Td align="right">{r.itemCount}</Td>
                  <Td>{formatDateTime(r.createdAt, locale)}</Td>
                  <Td>
                    <TimeLeft row={r} now={now} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

function orderLabel(rows: ReadonlyArray<AwaitingConfirmationRow>, id: string): string {
  return rows.find((r) => r.id === id)?.orderNumber ?? id;
}
