'use client';

import { useState, type ReactElement } from 'react';
import { Mail, Phone } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
  Toolbar,
} from '@skydrop/ui/components';
import { inviteLeadStatusKind } from '@skydrop/ui/status';
import { InviteLeadStatus } from '@skydrop/db';
import {
  useInviteLeads,
  useUpdateInviteLead,
  type InviteLead,
  type InviteLeadStatus as LeadStatus,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * People who asked to be let in.
 *
 * This is a call list, not a CRM. Everything on screen serves one
 * question — who do I contact next — so the newest sit at the top, the
 * phone number and email are one click each, and the status control is
 * on the row rather than behind a detail page. A queue that costs three
 * navigations per lead is a queue that stops being worked by Thursday.
 *
 * The tab counts come from ALL leads, not the filtered set: a tab
 * showing the size of what you are already looking at tells you nothing,
 * and the number that matters is how many are still unanswered.
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

const NEXT_STATUS: ReadonlyArray<LeadStatus> = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'CONVERTED',
  'DECLINED',
  'SPAM',
];

/**
 * How a direction reads to whoever is about to call.
 *
 * The reverse corridor is called out rather than shown neutrally: we do
 * not run India → Bangladesh, so that lead needs a different
 * conversation, and finding that out on the call wastes both people's
 * time.
 */
const DIRECTION: Record<string, { label: string; unserved: boolean }> = {
  BD_TO_IN: { label: 'BD → IN', unserved: false },
  IN_TO_BD: { label: 'IN → BD — not served yet', unserved: true },
  BOTH: { label: 'Both directions — reverse not served yet', unserved: true },
};

function howLongAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function LeadCard({ lead }: { readonly lead: InviteLead }): ReactElement {
  const update = useUpdateInviteLead();
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const dirty = notes !== (lead.notes ?? '');

  async function apply(patch: { status?: LeadStatus; notes?: string }): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({ id: lead.id, ...patch });
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-text-bright font-medium">{lead.companyName}</span>
              <span className="text-text-muted text-sm">{lead.fullName}</span>
              {lead.submissionCount > 1 && (
                <span className="text-[var(--status-pending-fg)] text-xs">
                  asked {lead.submissionCount}×
                </span>
              )}
            </div>
            {/* One click to act. An operator working a list should not
                have to select-and-copy a phone number. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <a
                href={`mailto:${lead.email}`}
                className="text-accent inline-flex items-center gap-1 hover:underline"
              >
                <Mail size={12} /> {lead.email}
              </a>
              <a
                href={`tel:${lead.phone.replace(/\s+/g, '')}`}
                className="text-accent inline-flex items-center gap-1 hover:underline"
              >
                <Phone size={12} /> {lead.phone}
              </a>
              {lead.altPhone !== null && lead.altPhone !== '' && (
                <a
                  href={`tel:${lead.altPhone.replace(/\s+/g, '')}`}
                  className="text-accent inline-flex items-center gap-1 hover:underline"
                >
                  <Phone size={12} /> {lead.altPhone}
                </a>
              )}
              <span className="text-text-faint">{howLongAgo(lead.createdAt)}</span>
            </div>
          </div>
          <StatusBadge
            kind={inviteLeadStatusKind(lead.status as InviteLeadStatus)}
            label={lead.status.toLowerCase()}
          />
        </div>

        {(lead.productTypes || lead.monthlyOrders || lead.shippingDirection) && (
          <div className="text-text-muted flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {lead.shippingDirection !== null && DIRECTION[lead.shippingDirection] && (
              <span
                className={
                  DIRECTION[lead.shippingDirection]!.unserved ? 'text-[var(--status-rto-fg)]' : ''
                }
              >
                {DIRECTION[lead.shippingDirection]!.label}
              </span>
            )}
            {lead.productTypes && <span>Sells: {lead.productTypes}</span>}
            {lead.monthlyOrders && <span>Volume: {lead.monthlyOrders}</span>}
          </div>
        )}

        {lead.message && (
          <p className="border-border text-text-body border-l-2 pl-3 text-sm whitespace-pre-wrap">
            {lead.message}
          </p>
        )}

        {error !== null && <div className="text-critical text-xs">{error}</div>}

        <div className="flex flex-wrap items-center gap-1.5">
          {NEXT_STATUS.filter((s) => s !== lead.status).map((s) => (
            <Button
              key={s}
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => void apply({ status: s })}
            >
              {s.toLowerCase()}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor={`notes-${lead.id}`} className="text-text-muted mb-1 block text-[11px]">
              Internal notes — never shown to the lead
            </label>
            <textarea
              id={`notes-${lead.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="sd-field border-border bg-surface-2 text-text-body w-full rounded-[5px] border px-2.5 py-2 text-sm"
              placeholder="What was said, what they need, when to call back."
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty || update.isPending}
            onClick={() => void apply({ notes })}
          >
            Save note
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function LeadsIndex(): ReactElement {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const active = TABS[tab] ?? TABS[0]!;
  const q = useInviteLeads({
    ...(active.status ? { status: active.status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });

  return (
    <div className="max-w-4xl space-y-4">
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Company, name, email or phone"
          className="sd-field border-border bg-surface-2 text-text-body rounded-[5px] border px-2.5 py-1.5 text-sm"
        />
      </Toolbar>

      {q.isLoading ? (
        <LoadingState label="Loading leads…" />
      ) : q.isError ? (
        <ErrorState
          message={q.error?.message ?? 'Could not load leads.'}
          retry={() => void q.refetch()}
        />
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={search ? 'Nothing matches that' : 'No requests here'}
          description={
            search
              ? 'Try a shorter search — it matches company, name, email and phone.'
              : 'New invite requests from the landing page land here the moment someone submits the form.'
          }
        />
      ) : (
        q.data?.items.map((lead) => <LeadCard key={lead.id} lead={lead} />)
      )}
    </div>
  );
}
