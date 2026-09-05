'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  FormField,
  Input,
  Label,
  PageHeader,
  Section,
  Select,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Textarea,
  Tr,
} from '@skydrop/ui/components';
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
  {
    label: 'Everyone subscribed to a topic',
    hint: 'people who opted IN to this topic on their own notifications page',
    fields: ['Topic key, e.g. seller.order_dispatched'],
    build: (v) => ({ kind: 'SUBSCRIBERS', topic: v[0] ?? '' }),
  },
];

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
    <Section>
      <PageHeader
        title="Broadcast"
        subtitle="A message you choose to send. It cannot be recalled, so the count comes first."
      />

      {error !== null && (
        <Card>
          <CardBody>
            <p className="text-status-failed-fg text-sm">{error}</p>
          </CardBody>
        </Card>
      )}

      {sent !== null && (
        <Card>
          <CardBody>
            <p className="text-status-delivered-fg text-sm">{sent}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <FormField label="Who it reaches" htmlFor="bc-audience" hint={pick.hint}>
            <Select
              id="bc-audience"
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
            {pick.fields.map((field, i) => (
              <Input
                key={field}
                aria-label={field}
                className="font-mono"
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
          </FormField>

          <div>
            <Label>Channels</Label>
            <div className="mt-1 flex gap-4">
              {['IN_APP', 'EMAIL'].map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={() => toggleChannel(c)}
                  />
                  {c === 'IN_APP' ? 'In app' : 'Email'}
                </label>
              ))}
            </div>
          </div>

          <FormField label="Title" htmlFor="bc-title" required>
            <Input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>

          <FormField label="Message" htmlFor="bc-body" required>
            <Textarea
              id="bc-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={preview.isPending || channels.length === 0 || !audienceComplete}
              onClick={() => {
                setError(null);
                setSent(null);
                preview.mutate(
                  { audience, category: 'ANNOUNCEMENT', channels },
                  { onError: (e) => setError(serverVerdict(e)) },
                );
              }}
            >
              How many is that?
            </Button>

            {previewed !== null && (
              <span className="text-sm">
                <strong className="tabular-nums">{previewed.recipientCount}</strong> people
                {previewed.sample.length > 0 && (
                  <span className="text-text-muted"> — {previewed.sample.join(', ')}…</span>
                )}
              </span>
            )}
          </div>

          {previewed !== null && (
            <div className="border-border-subtle border-t pt-4">
              <Button
                variant="destructive"
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
                        setSent(`Sent to ${r.recipientCount} people (${r.delivered} delivered).`);
                        setTitle('');
                        setBody('');
                        preview.reset();
                      },
                      onError: (e) => setError(serverVerdict(e)),
                    },
                  );
                }}
              >
                Send to {previewed.recipientCount} people
              </Button>
              <p className="text-text-faint mt-2 text-xs">
                This cannot be recalled. If anyone joined or left that audience since the count
                above, the server refuses rather than sending to a number you were not shown.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="text-sm font-semibold">What has been sent</h2>
          {(history.data ?? []).length === 0 ? (
            <p className="text-text-muted mt-2 text-sm">Nothing sent yet.</p>
          ) : (
            <Table className="mt-2">
              <THead>
                <Tr>
                  <Th>Sent</Th>
                  <Th>Title</Th>
                  <Th>Reached</Th>
                  <Th>Delivered</Th>
                  <Th>Failed</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {(history.data ?? []).map((b) => (
                  <Tr key={b.id}>
                    <Td>{new Date(b.createdAt).toLocaleString()}</Td>
                    <Td>{b.title}</Td>
                    <Td className="tabular-nums">{b.recipientCount}</Td>
                    <Td className="tabular-nums">{b.sentCount}</Td>
                    <Td className="tabular-nums">{b.failedCount}</Td>
                    <Td>
                      <StatusBadge
                        kind={
                          b.status === 'SENT'
                            ? 'delivered'
                            : b.status === 'FAILED'
                              ? 'failed'
                              : 'pending'
                        }
                        label={b.status.toLowerCase()}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
