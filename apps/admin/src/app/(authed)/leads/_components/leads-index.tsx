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

const TABS: ReadonlyArray<{ label: string; status?: LeadStatus }> = [
  { label: 'New', status: 'NEW' },
  { label: 'Contacted', status: 'CONTACTED' },
  { label: 'Qualified', status: 'QUALIFIED' },
  { label: 'Converted', status: 'CONVERTED' },
  { label: 'Declined', status: 'DECLINED' },
  { label: 'Spam', status: 'SPAM' },
  { label: 'All' },
];

/** Short enough for a column. The full label lives in the drawer. */
const DIRECTION_SHORT: Record<string, { text: string; unserved: boolean }> = {
  BD_TO_IN: { text: 'BD → IN', unserved: false },
  IN_TO_BD: { text: 'IN → BD', unserved: true },
  BOTH: { text: 'Both', unserved: true },
};

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

  const active = TABS[tab] ?? TABS[0]!;
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
        title="Invite requests"
        subtitle="People who asked to be let into the beta from the landing page. Newest first — a lead goes cold fast."
      />

      <div className="ac-toolbar">
        <Tabs
          label="Invite request status"
          size="sm"
          value={String(tab)}
          onChange={(id) => {
            setTab(Number(id));
            setPage(1);
          }}
          items={TABS.map((t, i) => {
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
          aria-label="Search requests"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (page > 1) setPage(1);
          }}
          placeholder="Company, name, email or phone"
        />
      </div>

      {q.isLoading ? (
        <SkeletonRows rows={6} cols={6} label="Loading requests…" />
      ) : q.isError ? (
        <ErrorState
          message={q.error?.message ?? 'Could not load requests.'}
          retry={() => void q.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={search ? 'Nothing matches that' : 'No requests here'}
          description={
            search
              ? 'Try a shorter search — it matches company, name, email and phone.'
              : 'New requests from the landing page appear here the moment someone submits the form, and every super-admin is emailed.'
          }
        />
      ) : (
        <AcCard flush>
          <Table caption="Invite requests">
            <THead>
              <Tr>
                <Th>Company</Th>
                <Th>Contact</Th>
                <Th>Route</Th>
                <Th>Volume</Th>
                <Th>Status</Th>
                <Th align="right">Waiting</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((lead) => {
                const dir =
                  lead.shippingDirection === null ? null : DIRECTION_SHORT[lead.shippingDirection];
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
          label="Invite request pages"
        />
      )}

      <LeadDrawer lead={selected} onClose={() => setSelected(null)} />
    </AcPage>
  );
}
