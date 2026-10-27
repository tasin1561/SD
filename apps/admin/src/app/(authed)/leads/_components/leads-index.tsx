'use client';

import { useState, type ReactElement } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TextField } from '@skydrop/ui/app/text-field';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { AcCard, AcFact, AcHeader, AcPage, type AcTone } from '../../settings/_components/ac-parts';
import { inviteLeadStatusKind } from '@skydrop/ui/status';
import { InviteLeadStatus } from '@skydrop/db';
import {
  useInviteLeads,
  type InviteLead,
  type InviteLeadStatus as LeadStatus,
} from '@/lib/api-hooks';
import { LeadDrawer } from './lead-drawer';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * People who asked to be let in.
 *
 * A table, using the full width, because that is what this is. The
 * first version rendered each lead as a full-width card with an
 * always-open notes textarea and a row of status buttons — so one screen
 * showed one lead, every card was mostly empty space, and the whole page
 * sat in a narrow column with half the display unused.
 *
 * The list answers "who is waiting, and how long have they been
 * waiting"; acting on one is a click into the drawer. That split is what
 * lets the queue be READ, which is the thing you do far more often than
 * editing.
 *
 * The tab counts come from ALL leads rather than the filtered set — a
 * tab showing the size of what you are already looking at tells you
 * nothing, and the number that matters is how many are still unanswered.
 */

const TABS = (tr: Translate<MessageKey>): ReadonlyArray<{ label: string; status?: LeadStatus }> => [
  { label: tr('leadsLeadsIndex.new'), status: 'NEW' },
  { label: tr('leadsLeadsIndex.contacted'), status: 'CONTACTED' },
  { label: tr('leadsLeadsIndex.qualified'), status: 'QUALIFIED' },
  { label: tr('leadsLeadsIndex.converted'), status: 'CONVERTED' },
  { label: tr('leadsLeadsIndex.declined'), status: 'DECLINED' },
  { label: tr('leadsLeadsIndex.spam'), status: 'SPAM' },
  { label: tr('leadsLeadsIndex.all') },
];

/** Short enough for a column. The full label lives in the drawer. */
const DIRECTION_SHORT = (
  tr: Translate<MessageKey>,
): Record<string, { text: string; unserved: boolean }> => ({
  BD_TO_IN: { text: tr('leadsLeadsIndex.bdIn'), unserved: false },
  IN_TO_BD: { text: tr('leadsLeadsIndex.inBd'), unserved: true },
  BOTH: { text: tr('leadsLeadsIndex.both'), unserved: true },
});

/** "6m", "3h", "2d" — relative, because the only question a queue asks
 *  is how long somebody has been waiting. */
function waited(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** How loud the wait reads: a lead goes cold fast. Colour only — the words carry it too. */
function waitTone(iso: string): AcTone {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours >= 72) return 'bad';
  if (hours >= 24) return 'warn';
  return undefined;
}

export function LeadsIndex(): ReactElement {
  const tr = useT();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InviteLead | null>(null);
  // The page lives in the URL, so a reload or a shared link lands on the
  // same slice. The list is served 50 at a time; without a page the
  // 51st request was unreachable.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pageParam = Number(params.get('page') ?? '1');
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const setPage = (next: number): void => {
    const sp = new URLSearchParams(params.toString());
    if (next <= 1) sp.delete('page');
    else sp.set('page', String(next));
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const active = TABS(tr)[tab] ?? TABS(tr)[0]!;
  const q = useInviteLeads({
    ...(active.status ? { status: active.status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(page > 1 ? { page } : {}),
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pageSize = q.data?.pageSize ?? 50;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    // No max-width. `<main>` is flex-1 with no cap of its own, so a
    // capped page leaves the rest of the display empty — which on a wide
    // screen is most of it. Other admin pages cap at 6xl and are right
    // to: a form or a detail view gets unreadable past ~75 characters.
    // A dense table is the opposite — every extra pixel goes into the
    // columns, and the contact column in particular was truncating names
    // while a third of the screen sat unused.
    <AcPage>
      <AcHeader
        title={tr('leadsLeadsIndex.inviteRequests')}
        subtitle={tr('leadsLeadsIndex.peopleWhoAskedToBe')}
      />

      <div className="ac-toolbar">
        <Tabs
          label={tr('leadsLeadsIndex.inviteRequestStatus')}
          size="sm"
          value={String(tab)}
          onChange={(id) => {
            setTab(Number(id));
            setPage(1);
          }}
          items={TABS(tr).map((t, i) => {
            const count = t.status ? (q.data?.counts[t.status] ?? 0) : undefined;
            return {
              id: String(i),
              label: t.label,
              ...(count !== undefined && count > 0 ? { count } : {}),
            };
          })}
        />
        <TextField
          icon={<Search size={15} />}
          aria-label={tr('leadsLeadsIndex.searchRequests')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (page > 1) setPage(1);
          }}
          placeholder={tr('leadsLeadsIndex.companyNameEmailOrPhone')}
        />
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={6} cols={6} label={tr('leadsLeadsIndex.loadingRequests')} />
      ) : q.isError ? (
        <ErrorState
          message={q.error?.message ?? tr('leadsLeadsIndex.couldNotLoadRequests')}
          retry={() => void q.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            search ? tr('leadsLeadsIndex.nothingMatchesThat') : tr('leadsLeadsIndex.noRequestsHere')
          }
          description={
            search
              ? tr('leadsLeadsIndex.tryAShorterSearchIt')
              : tr('leadsLeadsIndex.newRequestsFromTheLanding')
          }
        />
      ) : (
        <AcCard flush>
          <Table caption={tr('leadsLeadsIndex.inviteRequests')}>
            <THead>
              <Tr>
                <Th>{tr('leadsLeadsIndex.company')}</Th>
                <Th>{tr('leadsLeadsIndex.contact')}</Th>
                <Th>{tr('leadsLeadsIndex.route')}</Th>
                <Th>{tr('leadsLeadsIndex.volume')}</Th>
                <Th>{tr('leadsLeadsIndex.status')}</Th>
                <Th align="right">{tr('leadsLeadsIndex.waiting')}</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((lead) => {
                const dir =
                  lead.shippingDirection === null
                    ? null
                    : DIRECTION_SHORT(tr)[lead.shippingDirection];
                return (
                  <Tr key={lead.id} onActivate={() => setSelected(lead)}>
                    <Td>
                      <span className="ac-cell-main">{lead.companyName}</span>
                      {lead.submissionCount > 1 && (
                        <>
                          {' '}
                          <AcFact tone="warn">×{lead.submissionCount}</AcFact>
                        </>
                      )}
                    </Td>
                    <Td>
                      <span className="ac-text">{lead.fullName}</span>
                      <span className="ac-cell-sub">{lead.email}</span>
                    </Td>
                    <Td>
                      {dir === undefined || dir === null ? (
                        <span className="ac-faint">—</span>
                      ) : dir.unserved ? (
                        <AcFact tone="bad">{dir.text}</AcFact>
                      ) : (
                        <span>{dir.text}</span>
                      )}
                    </Td>
                    <Td>
                      <span className="ac-muted">{lead.monthlyOrders ?? '—'}</span>
                    </Td>
                    <Td>
                      <StatusChip
                        kind={inviteLeadStatusKind(lead.status as InviteLeadStatus)}
                        label={lead.status.toLowerCase()}
                        size="sm"
                      />
                    </Td>
                    <Td align="right">
                      <AcFact tone={waitTone(lead.createdAt)}>
                        <span className="sk-figure">{waited(lead.createdAt)}</span>
                      </AcFact>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </AcCard>
      )}

      {total > pageSize && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(next) => setPage(Math.min(Math.max(1, next), lastPage))}
          label={tr('leadsLeadsIndex.inviteRequestPages')}
        />
      )}

      <LeadDrawer lead={selected} onClose={() => setSelected(null)} />
    </AcPage>
  );
}
