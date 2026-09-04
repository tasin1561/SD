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

const AUDIENCES: ReadonlyArray<{
  readonly label: string;
  readonly hint: string;
  readonly build: (v: string) => AudienceSelector;
  readonly field: string | null;
}> = [
  {
    label: 'Every seller',
    hint: 'every active user at every company',
    build: () => ({ kind: 'ALL_SELLERS' }),
    field: null,
  },
  {
    label: 'One company',
    hint: 'seller id',
    build: (v) => ({ kind: 'SELLER_ORG', sellerId: v }),
    field: 'Seller id',
  },
  {
    label: 'Every staff member',
    hint: 'everyone with an admin login',
    build: () => ({ kind: 'ALL_STAFF' }),
    field: null,
  },
  {
    label: 'A staff role',
    hint: 'role key, e.g. warehouse_supervisor',
    build: (v) => ({ kind: 'STAFF_ROLE', roleKey: v }),
    field: 'Role key',
  },
  {
    label: 'Whoever holds a permission',
    hint: 'survives an admin inventing a new role — the permission is the durable fact',
    build: (v) => ({ kind: 'STAFF_PERMISSION', permission: v }),
    field: 'Permission key',
  },
];

export function BroadcastsView(): ReactElement {
  const [audienceIdx, setAudienceIdx] = useState(0);
  const [audienceValue, setAudienceValue] = useState('');
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const preview = useBroadcastPreview();
  const send = useSendBroadcast();
  const history = useBroadcasts();

  const pick = AUDIENCES[audienceIdx] ?? AUDIENCES[0]!;
  const audience: AudienceSelector[] = [pick.build(audienceValue.trim())];
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
                setAudienceValue('');
                preview.reset();
              }}
            >
              {AUDIENCES.map((a, i) => (
                <option key={a.label} value={i}>
                  {a.label}
                </option>
              ))}
            </Select>
            {pick.field !== null && (
              <Input
                aria-label={pick.field}
                className="font-mono"
                placeholder={pick.field}
                value={audienceValue}
                onChange={(e) => {
                  setAudienceValue(e.target.value);
                  preview.reset();
                }}
              />
            )}
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
              disabled={preview.isPending || channels.length === 0}
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
