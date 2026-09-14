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
  TBody,
  THead,
  Table,
  Td,
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
} from '@/lib/order-hooks';

function when(iso: string | null): string {
  return iso === null
    ? 'never'
    : new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

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
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({ name: name.trim() });
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
          <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-2">
            <FormField label="Name the key">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shopify connector"
                maxLength={80}
                className="w-[260px]"
              />
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
                <Th>State</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {keys.data.map((k) => (
                <Tr key={k.id}>
                  <Td>{k.name}</Td>
                  <Td className="font-mono text-xs">{k.keyPrefix}…</Td>
                  <Td className="text-text-muted text-xs">{when(k.lastUsedAt)}</Td>
                  <Td className="text-xs">
                    {k.revokedAt === null ? 'Live' : `Revoked ${when(k.revokedAt)}`}
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
              ))}
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
  const hooks = useStoreWebhooks();
  const create = useCreateStoreWebhook();
  const rotate = useRotateStoreWebhook();
  const remove = useDeleteStoreWebhook();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState('order.confirmed, shipment.dispatched, shipment.delivered');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        url: url.trim(),
        subscribedEvents: events
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      });
      setSecret(created.secretKey);
      setUrl('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Section
      title="Webhooks"
      subtitle="We POST a signed message (HMAC-SHA256 with the endpoint’s secret) to your URL when one of your orders moves. Only your store’s orders are sent."
    >
      <Card>
        <CardBody>
          <form
            onSubmit={(e) => void add(e)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <FormField label="Your https URL">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/skydrop"
                inputMode="url"
              />
            </FormField>
            <FormField label="Events (comma separated)">
              <Input value={events} onChange={(e) => setEvents(e.target.value)} />
            </FormField>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={create.isPending || url.trim() === ''}
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
                <Th>URL</Th>
                <Th>Events</Th>
                <Th>Last delivered</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {hooks.data.map((h) => (
                <Tr key={h.id}>
                  <Td className="font-mono text-xs break-all">{h.url}</Td>
                  <Td className="text-xs">{h.subscribedEvents.join(', ')}</Td>
                  <Td className="text-text-muted text-xs">
                    {h.autoDisabledAt !== null
                      ? 'Switched off after repeated failures'
                      : when(h.lastSuccessAt)}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            const r = await rotate.mutateAsync({ id: h.id });
                            setSecret(r.secretKey);
                          } catch (err) {
                            setError(serverVerdict(err));
                          }
                        }}
                      >
                        New secret
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            await remove.mutateAsync({ id: h.id });
                          } catch (err) {
                            setError(serverVerdict(err));
                          }
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
      </div>
    </Section>
  );
}
