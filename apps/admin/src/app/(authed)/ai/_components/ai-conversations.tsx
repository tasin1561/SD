'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Paperclip, ThumbsDown, ThumbsUp } from 'lucide-react';
import { DateRangeField } from '@skydrop/ui/app/date-range';
import { FilterBar, FilterField } from '@skydrop/ui/app/filter-bar';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Pagination } from '@skydrop/ui/app/pagination';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { useT } from '@/i18n/client';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcAlert, AcSection } from '../../settings/_components/ac-parts';
import { useAiConversations } from '../_lib/ai-hooks';
import { MonitorChips } from './ai-monitor-parts';

const PAGE = 25;

interface Filters {
  portal: string;
  language: string;
  rating: string;
  hadNotice: string;
  hasAttachment: string;
  monitor: string;
  from: string;
  to: string;
}
const EMPTY: Filters = {
  portal: '',
  language: '',
  rating: '',
  hadNotice: '',
  hasAttachment: '',
  monitor: '',
  from: '',
  to: '',
};

/** The conversation explorer list. Server-enforced behind `assistant.conversations.read`; phones are masked in previews. */
export function AiConversations(): ReactElement {
  const t = useT();
  const may = usePermission('assistant.conversations.read');
  const [f, setF] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);
  const active = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const q = useAiConversations(active, offset);
  const set = (k: keyof Filters, v: string): void => {
    setF((o) => ({ ...o, [k]: v }));
    setOffset(0);
  };

  if (!may) return <AcAlert tone="warn" message={t('ai.conv.noAccess')} />;

  const opt = (v: string, l: string): ReactElement => (
    <option key={v} value={v}>
      {l}
    </option>
  );

  return (
    <>
      <AcAlert tone="warn" message={t('ai.conv.audited')} />
      <FilterBar
        title={t('ai.conv.filters')}
        activeCount={Object.keys(active).length - (f.from !== '' && f.to !== '' ? 1 : 0)}
        onReset={() => {
          setF(EMPTY);
          setOffset(0);
        }}
      >
        <FilterField>
          <Select
            label={t('ai.conv.portal')}
            value={f.portal}
            onChange={(e) => set('portal', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {(['staff', 'seller', 'store', 'associate', 'public'] as const).map((p) =>
              opt(p, t(`ai.portal.${p}`)),
            )}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label={t('ai.conv.language')}
            value={f.language}
            onChange={(e) => set('language', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {opt('en', t('ai.lang.en'))}
            {opt('bn', t('ai.lang.bn'))}
            {opt('hi', t('ai.lang.hi'))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label={t('ai.conv.rating')}
            value={f.rating}
            onChange={(e) => set('rating', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {opt('up', t('ai.conv.thumbsUp'))}
            {opt('down', t('ai.conv.thumbsDown'))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label={t('ai.conv.notice')}
            value={f.hadNotice}
            onChange={(e) => set('hadNotice', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {opt('error', t('ai.conv.hadError'))}
            {opt('any', t('ai.conv.hadAnyNotice'))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label={t('ai.conv.attachment')}
            value={f.hasAttachment}
            onChange={(e) => set('hasAttachment', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {opt('true', t('ai.conv.withAttachment'))}
          </Select>
        </FilterField>
        <FilterField>
          <Select
            label={t('ai.mon.filter')}
            value={f.monitor}
            onChange={(e) => set('monitor', e.target.value)}
          >
            {opt('', t('ai.any'))}
            {opt('flagged', t('ai.mon.flaggedOnly'))}
          </Select>
        </FilterField>
        <FilterField>
          <DateRangeField
            label={t('ai.dash.range')}
            from={f.from}
            to={f.to}
            fromLabel={t('ai.dash.from')}
            toLabel={t('ai.dash.to')}
            onChange={(r) => {
              setF((o) => ({ ...o, from: r.from, to: r.to }));
              setOffset(0);
            }}
          />
        </FilterField>
      </FilterBar>

      {q.isError ? (
        <ErrorState
          title={t('ai.error')}
          message={serverVerdict(q.error)}
          retry={() => void q.refetch()}
        />
      ) : q.data === undefined ? (
        <Skeleton height={300} />
      ) : (
        <AcSection title={t('ai.conv.list', { n: q.data.total })} flush>
          <Table caption={t('ai.tab.conversations')}>
            <THead>
              <Tr>
                <Th>{t('ai.conv.when')}</Th>
                <Th>{t('ai.conv.portal')}</Th>
                <Th>{t('ai.conv.who')}</Th>
                <Th>{t('ai.conv.firstQuestion')}</Th>
                <Th align="right">{t('ai.conv.qs')}</Th>
                <Th>{''}</Th>
              </Tr>
            </THead>
            <TBody>
              {q.data.items.length === 0 && <TableEmpty colSpan={6}>{t('ai.empty')}</TableEmpty>}
              {q.data.items.map((r) => (
                <Tr key={r.id}>
                  <Td>{new Date(r.updatedAt).toLocaleString()}</Td>
                  <Td>
                    <StatusChip kind="neutral" label={t(`ai.portal.${r.portal}`)} size="sm" />
                  </Td>
                  <Td>
                    <div className="ai-who">
                      <strong>{r.user ?? '—'}</strong>
                      {r.account !== null && <small>{r.account}</small>}
                    </div>
                  </Td>
                  <Td>
                    <Link href={`/ai/conversations/${r.id}`} className="ai-link">
                      {r.anonymised ? t('ai.conv.anonymised') : r.preview || r.title || '—'}
                    </Link>
                  </Td>
                  <Td align="right">{r.questions}</Td>
                  <Td>
                    <span className="ai-flags">
                      {r.attachments > 0 && (
                        <Paperclip size={14} aria-label={t('ai.conv.withAttachment')} />
                      )}
                      {r.up > 0 && <ThumbsUp size={14} aria-label={t('ai.conv.thumbsUp')} />}
                      {r.down > 0 && <ThumbsDown size={14} aria-label={t('ai.conv.thumbsDown')} />}
                      {r.monitor !== null && <MonitorChips m={r.monitor} />}
                      {r.notices > 0 && (
                        <StatusChip
                          kind="pending"
                          label={String(r.notices)}
                          size="sm"
                          title={t('ai.conv.notice')}
                        />
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={Math.floor(offset / PAGE) + 1}
            pageSize={PAGE}
            total={q.data.total}
            onPageChange={(p) => setOffset((p - 1) * PAGE)}
            showJump={false}
            pageSizes={[PAGE]}
          />
        </AcSection>
      )}
    </>
  );
}
