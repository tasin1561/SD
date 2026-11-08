'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlarmClock, Clock, Hourglass, PhoneOutgoing, TriangleAlert, X } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton, type AsyncPhase } from '@skydrop/ui/app/async-button';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip, type StatusChipKind } from '@skydrop/ui/app/status-chip';
import {
  SelectAllTh,
  SelectTd,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Tr,
  useRowSelection,
} from '@skydrop/ui/app/data-table';
import { useSellersList } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  CONFIRMATION_PERMISSION,
  MAX_SEND_BATCH,
  remainingUntil,
  useAwaitingConfirmation,
  useSendForConfirmationCall,
  type AwaitingConfirmationRow,
  type Remaining,
  type SendResult,
} from '@/lib/confirmation-hooks';
import { formatDateTime } from '@/i18n/format';
import { useLocale, useT } from '@/i18n/client';
import './awaiting-confirmation.css';

const PAGE_SIZES = [20, 50, MAX_SEND_BATCH] as const;
const TICK_MS = 30_000;

/**
 * Orders waiting because their client switched the confirmation call off,
 * across every client. Staff can send any of them for a call now instead
 * of letting the clock run out.
 *
 * The permission only decides what is drawn (FE-2); the API refuses a send
 * regardless, and its `[CODE] message` is shown as written.
 */
export function AwaitingConfirmationIndex(): ReactElement | null {
  const allowed = usePermission(CONFIRMATION_PERMISSION);
  if (!allowed) return null;
  return <Page />;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const LEVEL_ICON = {
  calm: Clock,
  soon: Hourglass,
  urgent: AlarmClock,
  overdue: TriangleAlert,
} as const;

const LEVEL_KIND: Record<Remaining['level'], StatusChipKind> = {
  calm: 'draft',
  soon: 'pending',
  urgent: 'failed',
  overdue: 'failed',
};

function Page(): ReactElement {
  const t = useT();
  const [sellerId, setSellerId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const now = useNow();

  const sellers = useSellersList({ page: 1, pageSize: 100 });
  const list = useAwaitingConfirmation({ sellerId: sellerId || undefined, page, pageSize });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const ids = useMemo(() => rows.map((r) => r.orderId), [rows]);
  const selection = useRowSelection(ids);

  const send = useSendForConfirmationCall();
  const [results, setResults] = useState<readonly SendResult[] | null>(null);
  const [phase, setPhase] = useState<AsyncPhase>('idle');

  const sellerOptions = sellers.data?.items ?? [];
  const sellerMissing = sellerId !== '' && !sellerOptions.some((s) => s.id === sellerId);
  const numberById = new Map(rows.map((r) => [r.orderId, r.orderNumber]));

  const sent = results?.filter((r) => r.kind === 'sent').length ?? 0;
  const already = results?.filter((r) => r.kind === 'already').length ?? 0;
  const failed = results?.filter((r) => r.kind === 'failed') ?? [];

  async function onSend(): Promise<void> {
    const picked = rows.filter((r) => selection.isSelected(r.orderId)).map((r) => r.orderId);
    if (picked.length === 0) return;
    setPhase('busy');
    setResults(null);
    try {
      const out = await send.mutateAsync(picked);
      setResults(out);
      setPhase(out.some((o) => o.kind === 'sent') ? 'success' : 'error');
    } catch {
      // The request itself was refused; `send.error` carries the server's words.
      setPhase('error');
    }
  }

  const doneLabel =
    results === null
      ? t('awaiting.sendDone')
      : sent === results.length
        ? t('awaiting.sendDone')
        : t('awaiting.sentOf', { sent, total: results.length });

  return (
    <div className="oo-page aw-page">
      <PageHeader
        breadcrumbs={[{ label: t('awaiting.crumbOps') }, { label: t('awaiting.title') }]}
        Link={Link}
        title={t('awaiting.title')}
        subtitle={t('awaiting.subtitle')}
        meta={
          list.data === undefined ? undefined : (
            <span className="aw-count">{t('awaiting.count', { total: list.data.total })}</span>
          )
        }
      />

      <FilterBar
        activeCount={sellerId === '' ? 0 : 1}
        onReset={() => {
          setSellerId('');
          setPage(1);
        }}
      >
        <FilterField>
          <Select
            label={t('awaiting.clientFilter')}
            value={sellerId}
            onChange={(e) => {
              setSellerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('awaiting.allClients')}</option>
            {sellerMissing && <option value={sellerId}>{t('awaiting.thisClient')}</option>}
            {sellerOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <div className="aw-bar" data-active={selection.count > 0 ? '1' : '0'}>
        <div className="aw-bar__text">
          {selection.count > 0 ? (
            <>
              <strong>{t('awaiting.selected', { n: selection.count })}</strong>
              <Button
                variant="ghost"
                size="sm"
                icon={<X size={14} />}
                onClick={() => selection.clear()}
              >
                {t('awaiting.clear')}
              </Button>
            </>
          ) : (
            <span className="aw-bar__hint">{t('awaiting.pickFirst')}</span>
          )}
        </div>
        <AsyncButton
          size="md"
          icon={<PhoneOutgoing size={16} />}
          state={phase}
          labels={{
            idle: t('awaiting.send'),
            busy: t('awaiting.sending'),
            done: doneLabel,
            error: results === null ? t('awaiting.sendFailed') : t('awaiting.nothingSent'),
          }}
          disabled={selection.count === 0}
          onClick={() => void onSend()}
        />
      </div>

      <div className="aw-live" role="status" aria-live="polite">
        {send.error !== null && phase === 'error' && (
          <div className="aw-result" data-tone="bad">
            <strong>{t('awaiting.result.refused')}</strong>
            <span>{serverVerdict(send.error)}</span>
          </div>
        )}
        {results !== null && (
          <div className="aw-result" data-tone={failed.length + already > 0 ? 'mixed' : 'good'}>
            <strong>
              {failed.length + already === 0
                ? t('awaiting.result.allSent', { sent })
                : sent === 0
                  ? t('awaiting.result.noneSent', { already, failed: failed.length })
                  : t('awaiting.result.mixed', { sent, already, failed: failed.length })}
            </strong>
            {failed.length > 0 && (
              <ul className="aw-result__list">
                {failed.map((f) => (
                  <li key={f.orderId}>
                    <span className="sk-ident">{numberById.get(f.orderId) ?? f.orderId}</span>{' '}
                    {f.detail}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="ghost" size="sm" onClick={() => setResults(null)}>
              {t('awaiting.result.dismiss')}
            </Button>
          </div>
        )}
      </div>

      {list.isLoading ? (
        <SkeletonRows rows={5} cols={6} label={t('awaiting.loading')} />
      ) : list.error !== null ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        sellerId === '' ? (
          <EmptyState
            tone="positive"
            icon={<PhoneOutgoing size={20} />}
            title={t('awaiting.emptyTitle')}
            description={t('awaiting.emptyDesc')}
          />
        ) : (
          <EmptyState
            icon={<PhoneOutgoing size={20} />}
            title={t('awaiting.emptyFilteredTitle')}
            description={t('awaiting.emptyFilteredDesc')}
            action={
              <Button variant="ghost" size="sm" onClick={() => setSellerId('')}>
                {t('awaiting.allClients')}
              </Button>
            }
          />
        )
      ) : (
        <>
          <Table caption={t('awaiting.caption')}>
            <THead>
              <Tr>
                <SelectAllTh selection={selection} label={t('awaiting.selectAll')} />
                <Th>{t('awaiting.colOrder')}</Th>
                <Th>{t('awaiting.colClient')}</Th>
                <Th>{t('awaiting.colRecipient')}</Th>
                <Th align="right">{t('awaiting.colCod')}</Th>
                <Th align="right">{t('awaiting.colItems')}</Th>
                <Th>{t('awaiting.colRemaining')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Row key={r.orderId} row={r} now={now} selection={selection} />
              ))}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data?.total ?? 0}
            onPageChange={setPage}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}

function Row({
  row,
  now,
  selection,
}: {
  readonly row: AwaitingConfirmationRow;
  readonly now: number;
  readonly selection: ReturnType<typeof useRowSelection>;
}): ReactElement {
  const t = useT();
  const locale = useLocale();
  const rem = remainingUntil(row.confirmationDeadlineAt, now);
  const Icon = LEVEL_ICON[rem.level];
  const absolute = formatDateTime(row.confirmationDeadlineAt, locale);
  const text = rem.overdue
    ? t('awaiting.overdue')
    : rem.hours >= 48
      ? t('awaiting.autoConfirmsInDays', { d: Math.floor(rem.hours / 24), h: rem.hours % 24 })
      : rem.hours === 0
        ? t('awaiting.autoConfirmsInMin', { m: rem.minutes })
        : t('awaiting.autoConfirmsIn', { h: rem.hours, m: rem.minutes });
  return (
    <Tr selected={selection.isSelected(row.orderId)} className="aw-row">
      <SelectTd
        selection={selection}
        id={row.orderId}
        label={t('awaiting.selectRow', { order: row.orderNumber })}
      />
      <Td>
        <Link href={`/orders/${row.orderId}`} className="oo-link sk-ident">
          {row.orderNumber}
        </Link>
        <div className="aw-sub">{formatDateTime(row.createdAt, locale)}</div>
      </Td>
      <Td>
        <span className="aw-client">{row.clientName}</span>
        {row.callsRequired && (
          <div>
            <StatusChip
              size="sm"
              kind="pending"
              label={t('awaiting.callsBackOn')}
              title={t('awaiting.callsBackOnTitle')}
            />
          </div>
        )}
      </Td>
      <Td>
        <span>{row.recipientName ?? '—'}</span>
        {row.recipientCity !== null && <div className="aw-sub">{row.recipientCity}</div>}
      </Td>
      <Td align="right">
        {row.codAmount === null ? '—' : <Money amount={row.codAmount} currency="INR" />}
      </Td>
      <Td align="right">{row.itemCount}</Td>
      <Td>
        <div className="aw-remaining" data-level={rem.level}>
          <StatusChip
            size="sm"
            kind={LEVEL_KIND[rem.level]}
            label={t(`awaiting.level.${rem.level}`)}
          />
          <span className="aw-remaining__line">
            <Icon size={14} aria-hidden className="aw-remaining__icon" />
            <time dateTime={row.confirmationDeadlineAt} title={absolute}>
              {text}
            </time>
          </span>
          <span className="aw-sub">{t('awaiting.at', { when: absolute })}</span>
        </div>
      </Td>
    </Tr>
  );
}
