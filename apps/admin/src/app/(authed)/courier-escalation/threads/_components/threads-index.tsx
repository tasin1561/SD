'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Send } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  Ident,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import {
  useCourierEscalations,
  useCourierThread,
  useReplyToCourierAsStaff,
  type CourierThreadMessage,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { EscalationTabs } from '../../_components/escalation-tabs';

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
    <div>
      <PageHeader
        title="Courier conversations"
        subtitle="What Delhivery has told us, per parcel, in their words. Replies you send here queue for delivery — Delhivery has no reply API."
      />
      <EscalationTabs />

      {list.isLoading ? (
        <SkeletonRows rows={5} cols={6} />
      ) : list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No conversations yet"
            description="One opens when a ticket needs the courier — either a seller raises an issue, or a failed re-attempt request escalates one automatically."
          />
        </Card>
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
              <Tr key={r.id}>
                <Td>{r.sellerName ?? <span className="text-text-faint">—</span>}</Td>
                <Td>
                  {r.awbNumber === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Ident value={r.awbNumber} />
                  )}
                </Td>
                <Td>
                  {r.externalTicketId === null ? (
                    // No courier ticket id means nothing has been
                    // delivered to them yet, or the operator marked an
                    // item sent without pasting one back.
                    <span className="text-text-faint">not yet raised</span>
                  ) : (
                    <Ident value={r.externalTicketId} />
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {r.state === null ? (
                      <span className="text-text-faint">—</span>
                    ) : (
                      <StatusBadge kind={stateKind(r.state)} label={humanise(r.state)} />
                    )}
                    {r.needsReviewAt !== null ? (
                      <span
                        className="text-warning inline-flex items-center gap-1 text-xs"
                        title="A message here was classified with low confidence."
                      >
                        <AlertTriangle size={12} /> review
                      </span>
                    ) : null}
                  </div>
                </Td>
                <Td align="right">{r.messageCount}</Td>
                <Td className="text-text-muted whitespace-nowrap">
                  {r.lastMessageAt === null
                    ? '—'
                    : new Date(r.lastMessageAt).toLocaleString('en-IN')}
                </Td>
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
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
  // FE-2: cosmetic only. The server refuses regardless.
  const canWrite = usePermission('courier.ops.write');
  const [draft, setDraft] = useState('');

  if (thread.isLoading) return <SkeletonRows rows={4} cols={1} />;
  if (thread.isError) {
    return (
      <div className="mt-4">
        <ErrorNote message={serverVerdict(thread.error)} retry={() => void thread.refetch()} />
      </div>
    );
  }

  const data = thread.data;
  if (data === undefined) return <div />;

  const send = (): void => {
    const body = draft.trim();
    if (body === '') return;
    void (async () => {
      try {
        await reply.mutateAsync({ escalationId, body });
        setDraft('');
        // Queued, not sent: it lands in the outbox and a human or the
        // portal worker delivers it. Saying "sent" here would be a lie
        // the operator finds out about on the next reconciliation.
        toast.success('Queued in the send queue');
      } catch (err) {
        toast.error(serverVerdict(err));
      }
    })();
  };

  return (
    <Card className="mt-4">
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">Thread</h3>
          {data.awbNumber !== null ? (
            <span className="text-text-muted text-xs">
              AWB <Ident value={data.awbNumber} />
            </span>
          ) : null}
          <Link
            href={`/tickets?ticketId=${data.ticketId}`}
            className="text-accent text-xs hover:underline"
          >
            the ticket this hangs off
          </Link>
          {data.pendingOutbound > 0 ? (
            <span className="text-text-muted text-xs">
              {data.pendingOutbound} awaiting delivery to the courier
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {data.messages.length === 0 ? (
            <p className="text-text-muted text-sm">Open, nothing said yet.</p>
          ) : (
            data.messages.map((m) => <Message key={m.id} message={m} />)
          )}
        </div>

        {canWrite ? (
          <div className="border-border mt-4 flex flex-col gap-2 border-t pt-3">
            <Textarea
              rows={3}
              placeholder="Write to the courier. Stored and sent exactly as typed."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={send} disabled={draft.trim() === ''}>
                <Send size={14} /> Queue reply
              </Button>
              <span className="text-text-muted text-xs">
                Goes to the send queue. Nothing reaches Delhivery until it is delivered from there.
              </span>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Message({ message }: { readonly message: CourierThreadMessage }): ReactElement {
  const fromCourier = message.direction === 'INBOUND';
  return (
    <div className={fromCourier ? '' : 'sm:pl-8'}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{fromCourier ? 'Delhivery' : 'Skydrop'}</span>
        <span className="text-text-muted text-xs">
          {new Date(message.occurredAt).toLocaleString('en-IN')}
        </span>
        <span className="text-text-faint text-xs">{message.channel.toLowerCase()}</span>
        {message.state !== null ? (
          <StatusBadge kind={stateKind(message.state)} label={humanise(message.state)} />
        ) : null}
        {message.templateCode !== null ? (
          <span className="text-text-faint text-xs">{message.templateCode}</span>
        ) : null}
        {message.needsReview ? (
          <span className="text-warning inline-flex items-center gap-1 text-xs">
            <AlertTriangle size={12} /> low confidence
          </span>
        ) : null}
      </div>
      {/* VERBATIM. No truncation, no tidying, no translation. */}
      <pre
        className={`whitespace-pre-wrap rounded p-3 text-sm ${
          fromCourier ? 'bg-surface-2' : 'bg-surface-3'
        }`}
      >
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
