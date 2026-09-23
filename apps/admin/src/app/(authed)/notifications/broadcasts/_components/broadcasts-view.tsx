'use client';

import { useState, type ReactElement } from 'react';
import { Megaphone, Send, Users } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import {
  AcAlert,
  AcCallout,
  AcCard,
  AcHeader,
  AcPage,
  AcSection,
} from '../../../settings/_components/ac-parts';
import {
  useBroadcastPreview,
  useBroadcasts,
  useSendBroadcast,
  type AudienceSelector,
} from '@/lib/notification-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Sending a message to an audience.
 *
 * The shape of this screen is the point: you cannot reach the Send
 * button without having asked how many people it reaches. The count
 * that comes back is carried into the send, and the server refuses if
 * the population moved in between — so the number on screen when
 * somebody decides is the number that is true when they commit.
 *
 * FE-2: the count guard, the empty audience and the category refusal
 * are all the SERVER's calls. This surfaces its verdict verbatim and
 * does not try to predict any of them.
 */

/**
 * Every audience the API can resolve, and how a person names one.
 *
 * `fields` rather than one optional box: a role or a permission at a
 * seller needs BOTH the company and the thing, and an option that
 * silently resolved to nobody because half of it was missing is worse
 * than not offering it. Two of these were left out of the first version
 * for exactly that reason — the capability existed and no person could
 * reach it.
 */
const AUDIENCES: ReadonlyArray<{
  readonly label: string;
  readonly hint: string;
  readonly fields: readonly string[];
  readonly build: (v: readonly string[]) => AudienceSelector;
}> = [
  {
    label: 'Every seller',
    hint: 'every active user at every company',
    fields: [],
    build: () => ({ kind: 'ALL_SELLERS' }),
  },
  {
    label: 'One company',
    hint: 'everyone at that seller',
    fields: ['Seller id'],
    build: (v) => ({ kind: 'SELLER_ORG', sellerId: v[0] ?? '' }),
  },
  {
    label: 'A role at one company',
    hint: 'a company can rename its own roles, so prefer a permission where one fits',
    fields: ['Seller id', 'Role key, e.g. finance'],
    build: (v) => ({ kind: 'SELLER_ROLE', sellerId: v[0] ?? '', roleKey: v[1] ?? '' }),
  },
  {
    label: 'Whoever holds a permission at one company',
    hint: 'the durable way to say "whoever handles orders there"',
    fields: ['Seller id', 'Permission key, e.g. orders.view'],
    build: (v) => ({ kind: 'SELLER_PERMISSION', sellerId: v[0] ?? '', permission: v[1] ?? '' }),
  },
  {
    label: 'One person at a seller',
    hint: 'a single seller user',
    fields: ['Seller user id'],
    build: (v) => ({ kind: 'SELLER_USER', sellerUserId: v[0] ?? '' }),
  },
  {
    label: 'Every staff member',
    hint: 'everyone with an admin login',
    fields: [],
    build: () => ({ kind: 'ALL_STAFF' }),
  },
  {
    label: 'A staff role',
    hint: 'roles can be invented and renamed; a permission survives that',
    fields: ['Role key, e.g. warehouse_supervisor'],
    build: (v) => ({ kind: 'STAFF_ROLE', roleKey: v[0] ?? '' }),
  },
  {
    label: 'Whoever holds a staff permission',
    hint: 'the durable fact about what somebody does here',
    fields: ['Permission key, e.g. warehouse.pack'],
    build: (v) => ({ kind: 'STAFF_PERMISSION', permission: v[0] ?? '' }),
  },
  {
    label: 'One staff member',
    hint: 'a single admin user',
    fields: ['Staff id'],
    build: (v) => ({ kind: 'STAFF_USER', staffId: v[0] ?? '' }),
  },
  // RS-2's third identity (2026-09-19). Scoped to ONE store by
  // construction — there is deliberately no "every reseller store",
  // because such a message would cross seller boundaries.
  {
    label: 'Everyone at one reseller store',
    hint: 'every login at that store',
    fields: ['Store id'],
    build: (v) => ({ kind: 'STORE_ORG', storeId: v[0] ?? '' }),
  },
  {
    label: 'Everyone at a reseller store with a permission',
    hint: 'preferred over a role: a store can rename its own roles, and what somebody may DO is the durable fact',
    fields: ['Store id', 'Permission key, e.g. orders.actions'],
    build: (v) => ({ kind: 'STORE_PERMISSION', storeId: v[0] ?? '', permission: v[1] ?? '' }),
  },
  {
    label: 'One reseller store user',
    hint: 'a single person at a store',
    fields: ['Store user id'],
    build: (v) => ({ kind: 'STORE_USER', storeUserId: v[0] ?? '' }),
  },
  {
    label: 'Everyone subscribed to a topic',
    hint: 'people who opted IN to this topic on their own notifications page',
    fields: ['Topic key, e.g. seller.order_dispatched'],
    build: (v) => ({ kind: 'SUBSCRIBERS', topic: v[0] ?? '' }),
  },
];

/** "1 person", not "1 people". A count is read aloud in the head. */
function people(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

export function BroadcastsView(): ReactElement {
  const [audienceIdx, setAudienceIdx] = useState(0);
  const [audienceValues, setAudienceValues] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const preview = useBroadcastPreview();
  const send = useSendBroadcast();
  const history = useBroadcasts();

  const pick = AUDIENCES[audienceIdx] ?? AUDIENCES[0]!;
  const audience: AudienceSelector[] = [pick.build(audienceValues.map((v) => v.trim()))];
  // Every named field has to be filled: a selector missing half of
  // itself resolves to nobody, and "0 people" is a confusing way to
  // learn you left a box empty.
  const audienceComplete = pick.fields.every((_, i) => (audienceValues[i] ?? '').trim() !== '');
  const previewed = preview.data ?? null;
  const ready =
    previewed !== null && title.trim().length >= 3 && body.trim().length >= 3 && !send.isPending;

  function toggleChannel(c: string): void {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
    preview.reset();
  }

  return (
    <AcPage width="narrow">
      <AcHeader
        crumbs={[{ label: 'Notifications', href: '/notifications' }, { label: 'Broadcast' }]}
        title="Broadcast"
        subtitle="A message you choose to send. It cannot be recalled, so the count comes first."
      />

      {error !== null && <AcAlert message={error} />}

      {sent !== null && (
        <AcCallout tone="good" icon={<Send size={15} />} role="status">
          {sent}
        </AcCallout>
      )}

      <AcCard>
        <div className="ac-form">
          <div className="ac-card__body">
            <Select
              label="Who it reaches"
              id="bc-audience"
              hint={pick.hint}
              value={audienceIdx}
              onChange={(e) => {
                setAudienceIdx(Number(e.target.value));
                setAudienceValues([]);
                preview.reset();
              }}
            >
              {AUDIENCES.map((a, i) => (
                <option key={a.label} value={i}>
                  {a.label}
                </option>
              ))}
            </Select>
            {pick.fields.length > 0 && (
              <div className="ac-form-grid" data-cols={pick.fields.length > 1 ? '2' : undefined}>
                {pick.fields.map((field, i) => (
                  <TextField
                    key={field}
                    aria-label={field}
                    inputClassName="sk-ident"
                    placeholder={field}
                    value={audienceValues[i] ?? ''}
                    onChange={(e) => {
                      const next = [...audienceValues];
                      next[i] = e.target.value;
                      setAudienceValues(next);
                      preview.reset();
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <fieldset className="ac-fieldset">
            <legend>Channels</legend>
            <div className="ac-buttons" data-align="start">
              {['IN_APP', 'EMAIL'].map((c) => (
                <Checkbox
                  key={c}
                  label={c === 'IN_APP' ? 'In app' : 'Email'}
                  checked={channels.includes(c)}
                  onChange={() => toggleChannel(c)}
                />
              ))}
            </div>
          </fieldset>

          <TextField
            label="Title"
            id="bc-title"
            requiredMark
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <TextArea
            label="Message"
            id="bc-body"
            requiredMark
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <div className="ac-buttons" data-align="start">
            <AsyncButton
              variant="secondary"
              icon={<Users size={15} />}
              state={preview.isPending ? 'busy' : 'idle'}
              labels={{ idle: 'How many is that?', busy: 'Counting…' }}
              disabled={preview.isPending || channels.length === 0 || !audienceComplete}
              onClick={() => {
                setError(null);
                setSent(null);
                preview.mutate(
                  { audience, category: 'ANNOUNCEMENT', channels },
                  { onError: (e) => setError(serverVerdict(e)) },
                );
              }}
            />

            {previewed !== null && (
              <span className="ac-text" role="status">
                <strong className="sk-figure">{people(previewed.recipientCount)}</strong>
                {previewed.sample.length > 0 && (
                  <span className="ac-faint"> — {previewed.sample.join(', ')}…</span>
                )}
              </span>
            )}
          </div>

          {previewed !== null && (
            <AcCallout tone="critical" icon={<Megaphone size={15} />}>
              <div className="ac-buttons" data-align="start">
                <AsyncButton
                  variant="destructive"
                  icon={<Send size={15} />}
                  state={send.isPending ? 'busy' : 'idle'}
                  labels={{
                    idle: `Send to ${people(previewed.recipientCount)}`,
                    busy: 'Sending…',
                  }}
                  disabled={!ready}
                  onClick={() => {
                    setError(null);
                    send.mutate(
                      {
                        audience,
                        category: 'ANNOUNCEMENT',
                        channels,
                        title: title.trim(),
                        body: body.trim(),
                        expectedRecipientCount: previewed.recipientCount,
                      },
                      {
                        onSuccess: (r) => {
                          setSent(
                            `Sent to ${people(r.recipientCount)} (${r.delivered} delivered).`,
                          );
                          setTitle('');
                          setBody('');
                          preview.reset();
                        },
                        onError: (e) => setError(serverVerdict(e)),
                      },
                    );
                  }}
                />
              </div>
              <p className="ac-muted">
                This cannot be recalled. If anyone joined or left that audience since the count
                above, the server refuses rather than sending to a number you were not shown.
              </p>
            </AcCallout>
          )}
        </div>
      </AcCard>

      <AcSection title="What has been sent" flush>
        {(history.data ?? []).length === 0 ? (
          <EmptyState bare title="Nothing sent yet." />
        ) : (
          <Table caption="Broadcasts sent">
            <THead>
              <Tr>
                <Th>Sent</Th>
                <Th>Title</Th>
                <Th align="right">Reached</Th>
                <Th align="right">Delivered</Th>
                <Th align="right">Failed</Th>
                <Th>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {(history.data ?? []).map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <span className="sk-figure ac-faint">
                      {new Date(b.createdAt).toLocaleString()}
                    </span>
                  </Td>
                  <Td>
                    <span className="ac-cell-main">{b.title}</span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{b.recipientCount}</span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{b.sentCount}</span>
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">{b.failedCount}</span>
                  </Td>
                  <Td>
                    <StatusChip
                      kind={
                        b.status === 'SENT'
                          ? 'delivered'
                          : b.status === 'FAILED'
                            ? 'failed'
                            : 'pending'
                      }
                      label={b.status.toLowerCase()}
                      size="sm"
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AcSection>
    </AcPage>
  );
}
