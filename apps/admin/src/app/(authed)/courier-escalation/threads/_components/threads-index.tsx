'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Send } from 'lucide-react';
import { Ident } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useCourierEscalations,
  useCourierThread,
  useReplyToCourierAsStaff,
  useRecordCourierReply,
  type CourierThreadMessage,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AfCard } from '@/app/(authed)/system/_components/af-parts';
import { EscalationTabs } from '../../_components/escalation-tabs';
import '../../_components/escalation.css';

/**
 * Every courier conversation, and the operator's side of one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The read pipeline has been storing courier replies since Phase 2 and
 * nothing displayed them. The ops console shows the SEND queue — what we
 * owe the courier — which is a different question from what the courier
 * has been saying. An operator who can only see the queue is answering
 * blind.
 *
 * ── THE TEXT IS VERBATIM ─────────────────────────────────────────────
 * Both directions, whitespace preserved, no truncation. The classifier's
 * label sits BESIDE a message and never replaces it: the label is a guess
 * from a regex, the text is what happened.
 *
 * ── REVIEW IS SURFACED, NOT SILENT ───────────────────────────────────
 * A message the classifier was unsure about carries a review marker, and
 * the row it belongs to is sorted to the top. That is the whole point of
 * the confidence gate — a low-confidence label nobody looks at is just a
 * wrong label with extra steps.
 */
export function CourierThreadsIndex(): ReactElement {
  const list = useCourierEscalations();
  const [selected, setSelected] = useState<string | null>(null);

  const rows = list.data ?? [];

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Courier escalation' }]}
        Link={Link}
        title="Courier conversations"
        subtitle="What each courier has told us, per parcel, in their words. Replies you send here queue for a person to send — no courier has a reply API."
      />
      <EscalationTabs />

      {list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={5} cols={6} label="Loading conversations" />
        </AfCard>
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="One opens when a ticket needs the courier — either a seller raises an issue, or a failed re-attempt request escalates one automatically."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Seller</Th>
              <Th>AWB</Th>
              <Th>Their ticket</Th>
              <Th>State</Th>
              <Th align="right">Messages</Th>
              <Th>Last heard</Th>
              <Th> </Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id} selected={selected === r.id}>
                <Td>
                  <div className="af-stack af-stack--tight">
                    <span>{r.sellerName ?? <span className="af-faint">—</span>}</span>
                    <span className="af-small">{r.courierName}</span>
                  </div>
                </Td>
                <Td>
                  {r.awbNumber === null ? (
                    <span className="af-faint">—</span>
                  ) : (
                    <Ident value={r.awbNumber} />
                  )}
                </Td>
                <Td>
                  {r.externalTicketId === null ? (
                    // No courier ticket id means nothing has been
                    // delivered to them yet, or the operator marked an
                    // item sent without pasting one back.
                    <span className="af-faint">not yet raised</span>
                  ) : (
                    <Ident value={r.externalTicketId} />
                  )}
                </Td>
                <Td>
                  <div className="af-row">
                    {r.state === null ? (
                      <span className="af-faint">—</span>
                    ) : (
                      <StatusChip size="sm" kind={stateKind(r.state)} label={humanise(r.state)} />
                    )}
                    {r.needsReviewAt !== null ? (
                      <span
                        className="ce-review"
                        title="A message here was classified with low confidence."
                      >
                        <AlertTriangle size={12} aria-hidden /> review
                      </span>
                    ) : null}
                  </div>
                </Td>
                <Td align="right">
                  <span className="sk-figure">{r.messageCount}</span>
                </Td>
                <Td>
                  <span className="af-small af-nowrap">
                    {r.lastMessageAt === null
                      ? '—'
                      : new Date(r.lastMessageAt).toLocaleString('en-IN')}
                  </span>
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={selected === r.id}
                    onClick={() => setSelected(selected === r.id ? null : r.id)}
                  >
                    {selected === r.id ? 'Close' : 'Open'}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {selected !== null ? <ThreadPanel escalationId={selected} /> : null}
    </div>
  );
}

function ThreadPanel({ escalationId }: { readonly escalationId: string }): ReactElement {
  const toast = useToast();
  const thread = useCourierThread(escalationId);
  const reply = useReplyToCourierAsStaff();
  const recordInbound = useRecordCourierReply();
  const [inbound, setInbound] = useState('');
  // FE-2: cosmetic only. The server refuses regardless.
  const canWrite = usePermission('courier.ops.write');
  const [draft, setDraft] = useState('');

  if (thread.isLoading) return <SkeletonRows rows={4} cols={1} label="Loading the thread" />;
  if (thread.isError) {
    return <ErrorState message={serverVerdict(thread.error)} retry={() => void thread.refetch()} />;
  }

  const data = thread.data;
  if (data === undefined) return <div />;

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (body === '') return;
    try {
      await reply.mutateAsync({ escalationId, body });
      setDraft('');
      // Queued, not sent: it lands in the outbox and a human or the
      // portal worker delivers it. Saying "sent" here would be a lie
      // the operator finds out about on the next reconciliation.
      toast.success('Queued in the send queue');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  const saveInbound = async (): Promise<void> => {
    const body = inbound.trim();
    if (body === '') return;
    try {
      await recordInbound.mutateAsync({ escalationId, body });
      setInbound('');
      toast.success('Recorded — the seller can see it now');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  return (
    <AfCard>
      <div className="af-row">
        <h3 className="af-card__title">Thread</h3>
        {data.awbNumber !== null ? (
          <span className="af-small">
            AWB <Ident value={data.awbNumber} />
          </span>
        ) : null}
        <Link href={`/tickets?ticketId=${data.ticketId}`} className="af-link af-small">
          the ticket this hangs off
        </Link>
        {data.pendingOutbound > 0 ? (
          <span className="af-small">{data.pendingOutbound} awaiting delivery to the courier</span>
        ) : null}
      </div>

      <div className="af-stack">
        {data.messages.length === 0 ? (
          <p className="af-muted">Open, nothing said yet.</p>
        ) : (
          data.messages.map((m) => <Message key={m.id} message={m} />)
        )}
      </div>

      {canWrite ? (
        <div className="af-divider af-form">
          <TextArea
            id={`reply-${escalationId}`}
            label="Reply to the courier"
            hint="Stored and sent exactly as typed — never rewritten or translated."
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="af-row">
            <AsyncButton
              variant="primary"
              size="sm"
              icon={<Send size={14} />}
              labels={{
                idle: 'Queue reply',
                busy: 'Queueing…',
                done: 'Queued',
                error: 'Not queued',
              }}
              disabled={draft.trim() === ''}
              onAction={send}
            />
            <span className="af-small">
              Goes to the send queue. Nothing reaches Delhivery until it is delivered from there.
            </span>
          </div>

          {/*
            The other half of the manual channel. Outbound is drafted
            above and sent by hand in Delhivery's own portal; their
            answer has to be typed back in here or the seller never
            hears it — the conversation would be one-way, and they
            would be left asking into silence.
          */}
          <TextArea
            id={`inbound-${escalationId}`}
            label="Record what the courier told us"
            hint="Paste their reply rather than paraphrasing — the seller reads this as the courier's own words."
            rows={3}
            value={inbound}
            onChange={(e) => setInbound(e.target.value)}
          />
          <div className="af-row">
            <AsyncButton
              variant="secondary"
              size="sm"
              labels={{
                idle: 'Save their reply',
                busy: 'Saving…',
                done: 'Recorded',
                error: 'Not saved',
              }}
              disabled={inbound.trim() === ''}
              onAction={saveInbound}
            />
            <span className="af-small">Shown to the seller on their ticket. Sends nothing.</span>
          </div>
        </div>
      ) : null}
    </AfCard>
  );
}

function Message({ message }: { readonly message: CourierThreadMessage }): ReactElement {
  const fromCourier = message.direction === 'INBOUND';
  return (
    <div className="ce-msg" data-side={fromCourier ? 'in' : 'out'}>
      <div className="ce-msg__meta">
        <span className="ce-msg__who">{fromCourier ? 'Delhivery' : 'Skydrop'}</span>
        <span className="af-small">{new Date(message.occurredAt).toLocaleString('en-IN')}</span>
        <span className="af-faint">{message.channel.toLowerCase()}</span>
        {message.state !== null ? (
          <StatusChip size="sm" kind={stateKind(message.state)} label={humanise(message.state)} />
        ) : null}
        {message.templateCode !== null ? (
          <span className="af-faint sk-ident">{message.templateCode}</span>
        ) : null}
        {message.needsReview ? (
          <span className="ce-review">
            <AlertTriangle size={12} aria-hidden /> low confidence
          </span>
        ) : null}
      </div>
      {/* VERBATIM. No truncation, no tidying, no translation. */}
      <pre className="af-pre" data-side={fromCourier ? 'in' : undefined}>
        {message.body}
      </pre>
    </div>
  );
}

/** A classifier label → a semantic colour. The label is data; this is ours. */
function stateKind(state: string): 'pending' | 'in-transit' | 'delivered' | 'failed' | 'draft' {
  switch (state) {
    case 'OUT_FOR_DELIVERY':
      return 'in-transit';
    case 'ACKNOWLEDGED':
      return 'pending';
    case 'RESOLVED':
      return 'delivered';
    case 'ACTION_REQUIRED':
      return 'failed';
    default:
      // Shown rather than hidden: a label the library learned recently
      // should be visible even before it has a colour of its own.
      return 'draft';
  }
}

function humanise(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}
