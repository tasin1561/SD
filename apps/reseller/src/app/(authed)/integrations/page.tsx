'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  CircleAlert,
  Clock,
  FileText,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
} from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Switch } from '@skydrop/ui/app/switch';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCreateStoreApiKey,
  useCreateStoreWebhook,
  useDeleteStoreWebhook,
  useRevokeStoreApiKey,
  useRotateStoreWebhook,
  useStoreApiKeys,
  useStoreWebhooks,
  useUpdateStoreWebhook,
  type StoreWebhook,
} from '@/lib/order-hooks';
import {
  RdCallout,
  RdCard,
  RdOneTimeSecret,
  RdSection,
  phaseOf,
} from '../settings/_components/rd-parts';
import { DEFAULT_EVENTS, EditWebhookModal, EventPicker } from './_components/webhook-form';

function when(iso: string | null): string {
  return iso === null
    ? 'never'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Choices for how long a new key works. `''` = until revoked. */
const EXPIRY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Until I revoke it' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
];

/**
 * RS-5 — connect the store's own systems: API keys that place and read
 * this store's orders (`/store-api/v1/orders`), and webhooks that tell
 * those systems when an order moves. Both reach THIS store only, never
 * the seller's account.
 */
export default function IntegrationsPage(): ReactElement {
  return (
    <div className="rd-page">
      <PageHeader
        title="Integrations"
        subtitle="Let your own systems place orders and hear when they move."
      />
      <ApiKeysSection />
      <WebhooksSection />
    </div>
  );
}

function ApiKeysSection(): ReactElement {
  const keys = useStoreApiKeys();
  const create = useCreateStoreApiKey();
  const revoke = useRevokeStoreApiKey();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // What the confirmation restates, fixed when it opens.
  const [asked, setAsked] = useState({ name: '', works: '' });
  const [error, setError] = useState<string | null>(null);
  const expiryLabel = EXPIRY_CHOICES.find((c) => c.value === expiry)?.label ?? '';

  // The form submit only ASKS; the key is made from the confirmation.
  function add(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    setAsked({
      name: name.trim(),
      works: expiry === '' ? 'until you revoke it' : `for ${expiryLabel}`,
    });
    setCreating(true);
  }

  async function createKey(): Promise<void> {
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        ...(expiry === '' ? {} : { expiresInDays: Number(expiry) }),
      });
      setShown(created.plaintext);
      setName('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <RdSection
      title="API keys"
      note="A key places and reads this store’s orders — POST /store-api/v1/orders with “Authorization: Bearer sks_…”. Every rule the portal applies (your catalogue, the retail range, what is available) applies to it too."
    >
      <RdCard>
        <form onSubmit={add} className="rd-form-grid" data-cols="key">
          <TextField
            id="key-name"
            label="Name the key"
            icon={<Tag size={15} />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shopify connector"
            maxLength={80}
            showCount
          />
          <Select
            id="key-expiry"
            label="Works for"
            icon={<Clock size={15} />}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            icon={<KeyRound size={15} />}
            labels={{ idle: 'Create key', busy: 'Creating…', error: 'Not created' }}
            state={phaseOf(create.isPending, create.isError ? error : null)}
            disabled={create.isPending || name.trim() === ''}
          />
        </form>
        {shown !== null ? <RdOneTimeSecret label="Your new API key" value={shown} /> : null}
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
      </RdCard>
      {keys.isPending ? (
        <SkeletonRows label="Loading keys" rows={2} cols={6} />
      ) : keys.isError ? (
        <ErrorState message={serverVerdict(keys.error)} retry={() => void keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <EmptyState title="No keys yet" description="Create one when you connect a system." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Last used</Th>
              <Th>Expires</Th>
              <Th>State</Th>
              <Th align="right">
                <span className="rd-sr">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {keys.data.map((k) => {
              const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() < Date.now();
              return (
                <Tr key={k.id}>
                  <Td>
                    <span className="rd-cell-strong">{k.name}</span>
                  </Td>
                  <Td className="rd-cell-ident sk-ident">{k.keyPrefix}…</Td>
                  <Td className="rd-cell-muted">{when(k.lastUsedAt)}</Td>
                  <Td className="rd-cell-muted">
                    {k.expiresAt === null ? 'Never' : when(k.expiresAt)}
                  </Td>
                  <Td>
                    {k.revokedAt !== null ? (
                      <>
                        <StatusChip kind="cancelled" size="sm" label="Revoked" />{' '}
                        <span className="rd-cell-sub">{when(k.revokedAt)}</span>
                      </>
                    ) : expired ? (
                      <StatusChip kind="failed" size="sm" label="Expired" />
                    ) : (
                      <StatusChip kind="delivered" size="sm" label="Live" />
                    )}
                  </Td>
                  <Td align="right">
                    {k.revokedAt === null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        onClick={() => {
                          setRevoking({ id: k.id, name: k.name });
                          setRevokeOpen(true);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create this API key?"
        entity={asked.name}
        consequence={`It works ${asked.works} and can place and read this store’s orders. The key is shown once, straight after — copy it then.`}
        confirmLabel="Create key"
        onConfirm={async () => {
          await createKey();
          setCreating(false);
        }}
      />
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        entity={revoking?.name ?? ''}
        consequence="Anything still using this key stops working at once. This cannot be undone."
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          if (revoking === null) return;
          try {
            await revoke.mutateAsync({ id: revoking.id });
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRevokeOpen(false);
        }}
      />
    </RdSection>
  );
}

function WebhooksSection(): ReactElement {
  const toast = useToast();
  const hooks = useStoreWebhooks();
  const create = useCreateStoreWebhook();
  const update = useUpdateStoreWebhook();
  const rotate = useRotateStoreWebhook();
  const remove = useDeleteStoreWebhook();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([...DEFAULT_EVENTS]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoreWebhook | null>(null);
  // Each confirmation keeps the endpoint it names after closing, so its
  // words do not blank while it animates out; `open` is separate.
  const [rotating, setRotating] = useState<StoreWebhook | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [removing, setRemoving] = useState<StoreWebhook | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [switching, setSwitching] = useState<{ hook: StoreWebhook; next: boolean } | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        url: url.trim(),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        subscribedEvents: events,
      });
      setSecret(created.secretKey);
      setUrl('');
      setName('');
      setDescription('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  // The switch only ASKS; the change is sent from the confirmation.
  function toggle(h: StoreWebhook, next: boolean): void {
    setSwitching({ hook: h, next });
    setSwitchOpen(true);
  }

  async function applyToggle(h: StoreWebhook, next: boolean): Promise<void> {
    setError(null);
    try {
      await update.mutateAsync({ id: h.id, isActive: next });
      toast.success(next ? 'Webhook switched on.' : 'Webhook switched off.');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  const label = (h: StoreWebhook): string => h.name ?? h.url;

  return (
    <RdSection
      title="Webhooks"
      note="We POST a signed message (HMAC-SHA256 with the endpoint’s secret) to your URL when one of your orders moves. Only your store’s orders are sent."
    >
      <RdCard>
        <form onSubmit={(e) => void add(e)} className="rd-form">
          <div className="rd-form-grid" data-cols="2">
            <TextField
              id="wh-url"
              label="Your https URL"
              icon={<Link2 size={15} />}
              requiredMark
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/skydrop"
              inputMode="url"
              inputClassName="sk-ident"
            />
            <TextField
              id="wh-name"
              label="Name (optional)"
              icon={<Tag size={15} />}
              value={name}
              maxLength={160}
              showCount
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Order sync"
            />
          </div>
          <TextArea
            id="wh-description"
            label="Description (optional)"
            icon={<FileText size={15} />}
            value={description}
            maxLength={2000}
            showCount
            onChange={(e) => setDescription(e.target.value)}
          />
          <EventPicker value={events} onChange={setEvents} />
          <div className="rd-buttons" data-align="start">
            <AsyncButton
              type="submit"
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              labels={{ idle: 'Add webhook', busy: 'Adding…', error: 'Not added' }}
              state={phaseOf(create.isPending, create.isError ? error : null)}
              disabled={create.isPending || url.trim() === '' || events.length === 0}
            />
          </div>
        </form>
        {secret !== null ? <RdOneTimeSecret label="Signing secret" value={secret} /> : null}
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
      </RdCard>
      {hooks.isPending ? (
        <SkeletonRows label="Loading webhooks" rows={2} cols={5} />
      ) : hooks.isError ? (
        <ErrorState message={serverVerdict(hooks.error)} retry={() => void hooks.refetch()} />
      ) : hooks.data.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Add one to hear about your orders as they move."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Endpoint</Th>
              <Th>Events</Th>
              <Th>Last delivered</Th>
              <Th>On</Th>
              <Th align="right">
                <span className="rd-sr">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {hooks.data.map((h) => (
              <Tr key={h.id}>
                <Td>
                  {h.name !== null && h.name !== '' ? (
                    <span className="rd-cell-strong">{h.name}</span>
                  ) : null}
                  <span className="rd-cell-sub rd-cell-ident sk-ident">{h.url}</span>
                </Td>
                <Td className="rd-cell-ident sk-ident">{h.subscribedEvents.join(', ')}</Td>
                <Td className="rd-cell-muted">
                  {h.autoDisabledAt !== null ? (
                    <span className="rd-cell-warn">
                      Switched off after repeated failures
                      {h.autoDisabledReason !== null ? ` — ${h.autoDisabledReason}` : ''}. Fix the
                      endpoint, then switch it back on.
                    </span>
                  ) : (
                    when(h.lastSuccessAt)
                  )}
                </Td>
                <Td>
                  <Switch
                    checked={h.isActive && h.autoDisabledAt === null}
                    onCheckedChange={(next) => toggle(h, next)}
                    aria-label={`Deliver to ${h.name ?? h.url}`}
                    disabled={update.isPending}
                  />
                </Td>
                <Td align="right">
                  <div className="rd-row-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil size={14} />}
                      onClick={() => setEditing(h)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RefreshCw size={14} />}
                      onClick={() => {
                        setRotating(h);
                        setRotateOpen(true);
                      }}
                    >
                      New secret
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => {
                        setRemoving(h);
                        setRemoveOpen(true);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {editing !== null ? (
        <EditWebhookModal webhook={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        title={switching?.next === true ? 'Switch this webhook on?' : 'Switch this webhook off?'}
        entity={switching === null ? '' : label(switching.hook)}
        entityIsIdentifier={switching !== null && switching.hook.name === null}
        consequence={
          switching?.next === true
            ? `Your order updates are sent to ${switching.hook.url} again.`
            : `Nothing more is sent to ${switching?.hook.url ?? ''} until you switch it back on.`
        }
        confirmLabel={switching?.next === true ? 'Switch on' : 'Switch off'}
        destructive={switching?.next === false}
        onConfirm={async () => {
          if (switching === null) return;
          await applyToggle(switching.hook, switching.next);
          setSwitchOpen(false);
        }}
      />
      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Make a new signing secret?"
        entity={rotating === null ? '' : label(rotating)}
        entityIsIdentifier={rotating !== null && rotating.name === null}
        consequence="The old secret keeps working for 24 hours, then only the new one does. Update your system before then."
        confirmLabel="Make a new secret"
        onConfirm={async () => {
          if (rotating === null) return;
          setError(null);
          try {
            const r = await rotate.mutateAsync({ id: rotating.id });
            setSecret(r.secretKey);
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRotateOpen(false);
        }}
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove this webhook?"
        entity={removing === null ? '' : label(removing)}
        entityIsIdentifier={removing !== null && removing.name === null}
        consequence={`Nothing more is sent to ${removing?.url ?? ''}. This cannot be undone — add it again to start over.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removing === null) return;
          setError(null);
          try {
            await remove.mutateAsync({ id: removing.id });
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRemoveOpen(false);
        }}
      />
    </RdSection>
  );
}
