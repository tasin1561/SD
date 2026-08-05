'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  StatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
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

export function LeadsIndex(): ReactElement {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InviteLead | null>(null);

  const active = TABS[tab] ?? TABS[0]!;
  const q = useInviteLeads({
    ...(active.status ? { status: active.status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  const items = q.data?.items ?? [];

  return (
    // No max-width. `<main>` is flex-1 with no cap of its own, so a
    // capped page leaves the rest of the display empty — which on a wide
    // screen is most of it. Other admin pages cap at 6xl and are right
    // to: a form or a detail view gets unreadable past ~75 characters.
    // A dense table is the opposite — every extra pixel goes into the
    // columns, and the contact column in particular was truncating names
    // while a third of the screen sat unused.
    <div>
      <PageHeader
        title="Invite requests"
        subtitle="People who asked to be let into the beta from the landing page. Newest first — a lead goes cold fast."
      />

      <Toolbar>
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t, i) => {
            const count = t.status ? (q.data?.counts[t.status] ?? 0) : undefined;
            return (
              <Button
                key={t.label}
                variant={i === tab ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setTab(i)}
              >
                {t.label}
                {count !== undefined && count > 0 ? ` (${count})` : ''}
              </Button>
            );
          })}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Company, name, email or phone"
          className="sm:w-72"
        />
      </Toolbar>

      {q.isLoading ? (
        <LoadingState label="Loading requests…" />
      ) : q.isError ? (
        <ErrorState
          message={q.error?.message ?? 'Could not load requests.'}
          retry={() => void q.refetch()}
        />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={search ? 'Nothing matches that' : 'No requests here'}
            description={
              search
                ? 'Try a shorter search — it matches company, name, email and phone.'
                : 'New requests from the landing page appear here the moment someone submits the form, and every super-admin is emailed.'
            }
          />
        </Card>
      ) : (
        <Table wrapperClassName="rounded-t-none border-t-0">
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
                    <span className="text-text-bright">{lead.companyName}</span>
                    {lead.submissionCount > 1 && (
                      <span className="ml-2 text-[var(--status-pending-fg)] text-xs">
                        ×{lead.submissionCount}
                      </span>
                    )}
                  </Td>
                  <Td className="text-text-muted">
                    <div className="truncate">{lead.fullName}</div>
                    <div className="text-text-faint truncate text-xs">{lead.email}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {dir === undefined || dir === null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <span className={dir.unserved ? 'text-[var(--status-rto-fg)]' : ''}>
                        {dir.text}
                      </span>
                    )}
                  </Td>
                  <Td className="text-text-muted whitespace-nowrap">{lead.monthlyOrders ?? '—'}</Td>
                  <Td>
                    <StatusBadge
                      kind={inviteLeadStatusKind(lead.status as InviteLeadStatus)}
                      label={lead.status.toLowerCase()}
                    />
                  </Td>
                  <Td align="right" className="text-text-muted tabular-nums whitespace-nowrap">
                    {waited(lead.createdAt)}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <LeadDrawer lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
