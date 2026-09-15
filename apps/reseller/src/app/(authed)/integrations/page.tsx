'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Section,
  Select,
  Switch,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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

/** A secret shown ONCE, with a way to copy it before it is gone. */
function OneTimeSecret({ label, value }: { label: string; value: string }): ReactElement {
  const toast = useToast();
  return (
    <div className="border-border bg-surface-raised rounded-lg border p-3 text-sm">
      <p className="text-text-body mb-1 font-medium">{label}</p>
      <p className="text-text-muted mb-2 text-xs">
        Copy it now — it is shown only this once. We keep only a fingerprint of it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="bg-surface rounded px-2 py-1 font-mono text-xs break-all">{value}</code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => toast.success('Copied.'));
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

/**
 * RS-5 — connect the store's own systems: API keys that place and read
 * this store's orders (`/store-api/v1/orders`), and webhooks that tell
 * those systems when an order moves. Both reach THIS store only, never
 * the seller's account.
 */
export default function IntegrationsPage(): ReactElement {
  return (
    <div className="space-y-6">
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
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
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
    <Section
      title="API keys"
      subtitle="A key places and reads this store’s orders — POST /store-api/v1/orders with “Authorization: Bearer sks_…”. Every rule the portal applies (your catalogue, the retail range, what is available) applies to it too."
    >
      <Card>
        <CardBody>
          <form
            onSubmit={(e) => void add(e)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px_auto] sm:items-end"
          >
            <FormField label="Name the key" htmlFor="key-name">
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shopify connector"
                maxLength={80}
              />
            </FormField>
            <FormField label="Works for" htmlFor="key-expiry">
              <Select id="key-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={create.isPending || name.trim() === ''}
            >
              Create key
            </Button>
          </form>
          {shown !== null ? (
            <div className="mt-3">
              <OneTimeSecret label="Your new API key" value={shown} />
            </div>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-critical mt-2 text-sm">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>
      <div className="mt-3">
        {keys.isPending ? (
          <LoadingState label="Loading keys" rows={2} />
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
                <Th />
              </Tr>
            </THead>
            <TBody>
              {keys.data.map((k) => {
                const expired =
                  k.expiresAt !== null && new Date(k.expiresAt).getTime() < Date.now();
                return (
                  <Tr key={k.id}>
                    <Td>{k.name}</Td>
                    <Td className="font-mono text-xs">{k.keyPrefix}…</Td>
                    <Td className="text-text-muted text-xs">{when(k.lastUsedAt)}</Td>
                    <Td className="text-text-muted text-xs">
                      {k.expiresAt === null ? 'Never' : when(k.expiresAt)}
                    </Td>
                    <Td className="text-xs">
                      {k.revokedAt !== null
                        ? `Revoked ${when(k.revokedAt)}`
                        : expired
                          ? 'Expired'
                          : 'Live'}
                    </Td>
                    <Td align="right">
                      {k.revokedAt === null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevoking({ id: k.id, name: k.name })}
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
      </div>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        description="Anything still using this key stops working at once. This cannot be undone."
        confirmLabel="Revoke"
        confirmVariant="destructive"
        disabled={revoke.isPending}
        onConfirm={async () => {
          if (revoking === null) return;
          try {
            await revoke.mutateAsync({ id: revoking.id });
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRevoking(null);
        }}
      />
    </Section>
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
  const [rotating, setRotating] = useState<StoreWebhook | null>(null);
  const [removing, setRemoving] = useState<StoreWebhook | null>(null);

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

  function toggle(h: StoreWebhook, next: boolean): void {
    setError(null);
    update.mutate(
      { id: h.id, isActive: next },
      {
        onSuccess: () => toast.success(next ? 'Webhook switched on.' : 'Webhook switched off.'),
        onError: (err) => setError(serverVerdict(err)),
      },
    );
  }

  return (
    <Section
      title="Webhooks"
      subtitle="We POST a signed message (HMAC-SHA256 with the endpoint’s secret) to your URL when one of your orders moves. Only your store’s orders are sent."
    >
      <Card>
        <CardBody>
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Your https URL" htmlFor="wh-url" required>
                <Input
                  id="wh-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/skydrop"
                  inputMode="url"
                />
              </FormField>
              <FormField label="Name (optional)" htmlFor="wh-name">
                <Input
                  id="wh-name"
                  value={name}
                  maxLength={160}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Order sync"
                />
              </FormField>
            </div>
            <FormField label="Description (optional)" htmlFor="wh-description">
              <Textarea
                id="wh-description"
                value={description}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <EventPicker value={events} onChange={setEvents} />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={create.isPending || url.trim() === '' || events.length === 0}
            >
              Add webhook
            </Button>
          </form>
          {secret !== null ? (
            <div className="mt-3">
              <OneTimeSecret label="Signing secret" value={secret} />
            </div>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-critical mt-2 text-sm">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>
      <div className="mt-3">
        {hooks.isPending ? (
          <LoadingState label="Loading webhooks" rows={2} />
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
                <Th />
              </Tr>
            </THead>
            <TBody>
              {hooks.data.map((h) => (
                <Tr key={h.id}>
                  <Td>
                    {h.name !== null && h.name !== '' ? (
                      <div className="text-text-body text-sm">{h.name}</div>
                    ) : null}
                    <div className="font-mono text-xs break-all">{h.url}</div>
                  </Td>
                  <Td className="text-xs">{h.subscribedEvents.join(', ')}</Td>
                  <Td className="text-text-muted text-xs">
                    {h.autoDisabledAt !== null ? (
                      <span className="text-critical">
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
                      onChange={(next) => toggle(h, next)}
                      label={`Deliver to ${h.name ?? h.url}`}
                      disabled={update.isPending}
                    />
                  </Td>
                  <Td align="right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(h)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRotating(h)}>
                        New secret
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(h)}>
                        Remove
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      {editing !== null ? (
        <EditWebhookModal webhook={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => {
          if (!open) setRotating(null);
        }}
        title="Make a new signing secret?"
        description="The old secret keeps working for 24 hours, then only the new one does. Update your system before then."
        confirmLabel="Make a new secret"
        disabled={rotate.isPending}
        onConfirm={async () => {
          if (rotating === null) return;
          setError(null);
          try {
            const r = await rotate.mutateAsync({ id: rotating.id });
            setSecret(r.secretKey);
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRotating(null);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this webhook?"
        description={`Nothing more is sent to ${removing?.url ?? ''}. This cannot be undone — add it again to start over.`}
        confirmLabel="Remove"
        confirmVariant="destructive"
        disabled={remove.isPending}
        onConfirm={async () => {
          if (removing === null) return;
          setError(null);
          try {
            await remove.mutateAsync({ id: removing.id });
          } catch (err) {
            setError(serverVerdict(err));
          }
          setRemoving(null);
        }}
      />
    </Section>
  );
}
